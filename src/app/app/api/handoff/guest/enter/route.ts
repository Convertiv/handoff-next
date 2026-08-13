import { NextResponse, type NextRequest } from 'next/server';
import {
  clearPassphraseFailures,
  consumeShareLink,
  getActiveShareLinkById,
  recordPassphraseFailure,
  shareLinkCapabilities,
} from '@/lib/db/grant-queries';
import { parseShareToken } from '@/lib/server/share-link-token';
import { GUEST_LIMITS, isRateLimited } from '@/lib/rate-limit';
import { isLocked, lockRemainingMinutes, verifyPassphrase } from '@/lib/server/passphrase';
import { getDbPatternById } from '@/lib/db/queries';
import { canGuestView, canGuestCreateFromTemplate } from '@/lib/authz/policy';
import { patternKind } from '@/lib/authz/vocab';
import {
  guestCookieName,
  guestCookieOptions,
  issueGuestSession,
  readGuestSession,
  sanitizeGuestName,
} from '@/lib/server/guest-session';

/**
 * Start (or resume) a guest authoring session from a share link.
 *
 * The one place the link secret is presented. `consumeShareLink` verifies it, enforces `maxUses` in the
 * UPDATE's own WHERE clause, and counts the visit; everything after this point runs on the signed
 * session cookie, which is why the secret never has to be stored client-side or re-sent.
 *
 * Resuming is the same call: a caller that already holds a valid cookie for this link keeps its
 * `submissionId`, so returning to the URL returns to the draft. See `docs/GUEST-AUTHORING.md`.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    token?: unknown;
    name?: unknown;
    passphrase?: unknown;
    email?: unknown;
  };
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token.trim()) return NextResponse.json({ error: 'A link token is required.' }, { status: 400 });

  /**
   * Keyed on the **public id**, not the secret — a secret must not become a map key that outlives the request.
   * The passphrase lockout below is the per-link defence against guessing; this is the outer bound on hammering
   * the endpoint at all, including with tokens that do not resolve.
   */
  const publicId = parseShareToken(token)?.id ?? token.trim();
  if (isRateLimited(`guest:enter:${publicId}`, GUEST_LIMITS.enter.limit, GUEST_LIMITS.enter.windowMs)) {
    return NextResponse.json({ error: 'Too many attempts; try again in a minute.' }, { status: 429 });
  }

  const name = sanitizeGuestName(body.name);
  if (!name) return NextResponse.json({ error: 'Please give a name so reviewers know who submitted.' }, { status: 400 });

  /**
   * Resume *before* consuming, so a page refresh doesn't spend a use. `maxUses` is meant to cap how many
   * people a link admits, not how many times one of them reloads.
   */
  const existingId = token.includes('.') ? token.slice(0, token.indexOf('.')) : token.trim();
  const jar = request.cookies;
  const resumed = readGuestSession(jar.get(guestCookieName(existingId))?.value, existingId);

  /**
   * The link row is fetched before the secret is spent, because a passphrase failure must not consume a use —
   * otherwise ten wrong guesses would burn a ten-use invitation.
   */
  const candidate = await getActiveShareLinkById(existingId);

  if (candidate?.passphraseHash && !resumed) {
    /**
     * Passphrase gate. Only on a first visit: a resumed session already proved possession, and re-asking on
     * every reload would be theatre that trains people to keep the phrase in a sticky note.
     */
    if (isLocked(candidate.lockedUntil)) {
      const mins = lockRemainingMinutes(candidate.lockedUntil);
      return NextResponse.json(
        { error: `Too many incorrect attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, locked: true },
        { status: 429 }
      );
    }

    const supplied = typeof body.passphrase === 'string' ? body.passphrase : '';
    if (!supplied.trim()) {
      // Distinguished from a wrong one so the UI can ask for it without accusing the visitor of an error.
      return NextResponse.json({ error: 'This invitation needs a passphrase.', passphraseRequired: true }, { status: 401 });
    }
    if (!verifyPassphrase(supplied, { hash: candidate.passphraseHash, salt: candidate.passphraseSalt })) {
      const next = await recordPassphraseFailure(candidate.token);
      const mins = lockRemainingMinutes(next.lockedUntil);
      return NextResponse.json(
        {
          error: mins
            ? `That passphrase is not right. Too many attempts — try again in ${mins} minute${mins === 1 ? '' : 's'}.`
            : 'That passphrase is not right.',
          passphraseRequired: true,
          locked: mins > 0,
        },
        { status: mins ? 429 : 401 }
      );
    }
    await clearPassphraseFailures(candidate.token);
  }

  // Resuming re-reads the link (active checks, no use spent); a first visit verifies the secret and counts it.
  const link = resumed ? candidate : await consumeShareLink(token);
  if (!link) {
    // One message for every cause: expired, revoked, used up, wrong secret. Distinguishing them tells a
    // token holder about links they do not hold.
    return NextResponse.json({ error: 'This link is no longer available.' }, { status: 404 });
  }

  const capabilities = shareLinkCapabilities(link);
  const guest = { shareLinkId: link.token, capabilities, name };
  if (!canGuestView(guest) && !canGuestCreateFromTemplate(guest, link.resourceId)) {
    return NextResponse.json({ error: 'This link does not grant access.' }, { status: 403 });
  }

  if (link.resourceType !== 'pattern') {
    return NextResponse.json({ error: 'This link does not point at a template.' }, { status: 400 });
  }

  const template = await getDbPatternById(link.resourceId);
  if (!template) return NextResponse.json({ error: 'This link is no longer available.' }, { status: 404 });

  const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';

  /**
   * **A return link binds the session to the page it points at** (R.3 follow-up).
   *
   * Without this, R.3's link resolved, admitted the visitor, and then stranded them: the session carried no
   * `submissionId`, so the editor had no page to load and would try to *create* one — which a return link has no
   * capability to do. The link worked and the flow did not, which is the worst shape a bug can take.
   *
   * The kind is what distinguishes the two link types: a template link points at a `template`, a return link at
   * a `page`. Read from the row rather than inferred from capabilities, because capabilities are a list someone
   * can compose and `kind` is what the object *is*.
   */
  const pointsAtAPage = patternKind(template.kind) === 'page';
  const boundSubmissionId = pointsAtAPage ? template.id : (resumed?.submissionId ?? null);

  const { token: sessionToken, session } = issueGuestSession(
    { linkId: link.token, submissionId: boundSubmissionId, name, email: email || resumed?.email || null },
    { maxExp: link.expiresAt ? link.expiresAt.getTime() : null }
  );

  const res = NextResponse.json({
    linkId: link.token,
    capabilities,
    submissionId: session.submissionId,
    resumed: Boolean(resumed),
    /**
     * Which kind of link this is, so the UI can say the right thing rather than guess from capabilities.
     * `return` means "your page, come back to it"; `build` means "make one from this template".
     */
    mode: pointsAtAPage ? 'return' : 'build',
    // A safe subset, matching the read-only viewer's precedent — never the whole row.
    template: {
      id: template.id,
      title: template.title,
      description: template.description,
      components: template.components,
      data: template.data,
    },
    expiresAt: link.expiresAt,
  });
  res.cookies.set(guestCookieName(link.token), sessionToken, guestCookieOptions(session.exp));
  return res;
}
