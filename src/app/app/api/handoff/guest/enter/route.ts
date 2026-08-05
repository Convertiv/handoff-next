import { NextResponse, type NextRequest } from 'next/server';
import { consumeShareLink, getActiveShareLinkById, shareLinkCapabilities } from '@/lib/db/grant-queries';
import { getDbPatternById } from '@/lib/db/queries';
import { canGuestView, canGuestCreateFromTemplate } from '@/lib/authz/policy';
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
  const body = (await request.json().catch(() => ({}))) as { token?: unknown; name?: unknown };
  const token = typeof body.token === 'string' ? body.token : '';
  if (!token.trim()) return NextResponse.json({ error: 'A link token is required.' }, { status: 400 });

  const name = sanitizeGuestName(body.name);
  if (!name) return NextResponse.json({ error: 'Please give a name so reviewers know who submitted.' }, { status: 400 });

  /**
   * Resume *before* consuming, so a page refresh doesn't spend a use. `maxUses` is meant to cap how many
   * people a link admits, not how many times one of them reloads.
   */
  const existingId = token.includes('.') ? token.slice(0, token.indexOf('.')) : token.trim();
  const jar = request.cookies;
  const resumed = readGuestSession(jar.get(guestCookieName(existingId))?.value, existingId);

  // Resuming re-reads the link (active checks, no use spent); a first visit verifies the secret and counts it.
  const link = resumed ? await getActiveShareLinkById(existingId) : await consumeShareLink(token);
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

  const { token: sessionToken, session } = issueGuestSession(
    { linkId: link.token, submissionId: resumed?.submissionId ?? null, name },
    { maxExp: link.expiresAt ? link.expiresAt.getTime() : null }
  );

  const res = NextResponse.json({
    linkId: link.token,
    capabilities,
    submissionId: session.submissionId,
    resumed: Boolean(resumed),
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
