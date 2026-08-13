import { NextResponse, type NextRequest } from 'next/server';
import { canGuestEditPattern, isAuthorizationError, isGuestOwnPage } from '@/lib/authz/policy';
import { createGuestSubmission, patchGuestSubmission } from '@/lib/db/pattern-write';
import { getDbPatternById } from '@/lib/db/queries';
import { guardrailsFromPatternData } from '@/lib/authoring-guardrails';
import { readGuestContext, type GuestContext } from '@/lib/server/guest-context';
import { GUEST_LIMITS, isRateLimited } from '@/lib/rate-limit';
import { guestCookieName, guestCookieOptions, issueGuestSession } from '@/lib/server/guest-session';

/**
 * A guest's own submission: create it from the template, then keep editing it until they submit.
 *
 * Every handler reads the pattern id from the **signed session cookie**, never from the body. See
 * `ownSubmissionId` for why: a body-supplied id would let a link holder name any pattern in the
 * deployment and rely on a second check to catch it.
 *
 * The link id *is* taken from the query string, because it selects which cookie to verify — and
 * `readGuestSession` checks it against the signed payload, so naming a different link buys nothing.
 */

/** One 401 for every session failure — see `readGuestContext`. */
function unauthorized() {
  return NextResponse.json({ error: 'This session is no longer valid. Open the link again.' }, { status: 401 });
}

function failed(e: unknown, fallback: string) {
  if (isAuthorizationError(e)) return NextResponse.json({ error: e.message }, { status: 403 });
  console.error('[guest/submission]', e);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

async function context(request: NextRequest): Promise<GuestContext | null> {
  const linkId = request.nextUrl.searchParams.get('link')?.trim() ?? '';
  return linkId ? readGuestContext(linkId) : null;
}

/** Start the draft: a copy of the template, owned by the link's creator, `draft` and private. */
export async function POST(request: NextRequest) {
  const ctx = await context(request);
  if (!ctx) return unauthorized();

  if (ctx.link.resourceType !== 'pattern') {
    return NextResponse.json({ error: 'This link does not point at a template.' }, { status: 400 });
  }
  /**
   * Burst protection on the one endpoint that writes a row for an unauthenticated caller. The durable ceiling
   * is `MAX_PAGES_PER_SHARE_LINK`, counted in the database — see `lib/rate-limit.ts` on why this is not it.
   */
  if (isRateLimited(`guest:create:${ctx.link.token}`, GUEST_LIMITS.create.limit, GUEST_LIMITS.create.windowMs)) {
    return NextResponse.json({ error: 'Too many pages started; try again in a minute.' }, { status: 429 });
  }
  if (ctx.session.submissionId) {
    const current = await getDbPatternById(ctx.session.submissionId);
    const owned =
      current &&
      isGuestOwnPage(ctx.guest, { id: current.id, shareLinkId: current.shareLinkToken, status: current.status });
    /**
     * **A return-link holder always resumes.** Their link points at one page; going back to it is the only
     * thing it is for, and its status is `review` by definition.
     *
     * ⚠️ This is what R.3 got wrong. The rule was `status === 'draft' && shareLinkToken === guest.shareLinkId`,
     * and a returning author fails *both* halves — their page was submitted, and it carries the **template**
     * link's token rather than the one they hold. So the request fell through to "create a page from the
     * template", which a return link has no capability to do, and the visitor was told
     * *"This link does not allow creating a page from this template."* on the way back to their own work.
     *
     * For a **template**-link holder the old reasoning still stands: once their draft is submitted it is
     * locked, and a session still pointing at it would be a dead end — so they fall through and start a fresh
     * page, with the cookie repointed. The submitted page is untouched.
     */
    if (owned && (ctx.guest.resourceId === current!.id || current!.status === 'draft')) {
      return NextResponse.json({ id: current!.id, created: false });
    }
  }

  const template = await getDbPatternById(ctx.link.resourceId);
  if (!template) return NextResponse.json({ error: 'This link is no longer available.' }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { title?: unknown };
  const title =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : `${template.title || 'Untitled'} — ${ctx.guest.name}`;

  /**
   * Server-generated id. A client-supplied one could collide with an existing pattern, and the insert
   * would either fail or be an attempt to claim a row that already exists.
   */
  const id = `guest-${crypto.randomUUID()}`;

  try {
    await createGuestSubmission(
      {
        id,
        templateId: template.id,
        title,
        // Seeded from the template so the guest starts from the real page, not an empty canvas.
        components: (template.components as unknown[]) ?? [],
        data: (template.data as Record<string, unknown>) ?? {},
        // From the signed cookie, not the body — same rule as the submission id.
        submittedByEmail: ctx.session.email ?? null,
      },
      ctx.guest,
      ctx.ownerUserId
    );
  } catch (e) {
    return failed(e, 'Could not start the page.');
  }

  // Re-issue the cookie so the session now points at the draft — this is what makes it resumable.
  const { token, session } = issueGuestSession(
    // `email` carried through: re-issuing without it would silently drop the address on the first save.
    { linkId: ctx.link.token, submissionId: id, name: ctx.guest.name, email: ctx.session.email ?? null },
    { maxExp: ctx.link.expiresAt ? ctx.link.expiresAt.getTime() : null }
  );
  const res = NextResponse.json({ id, created: true });
  res.cookies.set(guestCookieName(ctx.link.token), token, guestCookieOptions(session.exp));
  return res;
}

/** Edit the draft. Only content fields; the write core drops everything else. */
export async function PATCH(request: NextRequest) {
  const ctx = await context(request);
  if (!ctx) return unauthorized();

  const id = ctx.session.submissionId;
  if (!id) return NextResponse.json({ error: 'There is no page to edit yet.' }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as {
    title?: unknown;
    description?: unknown;
    components?: unknown;
    data?: unknown;
  };

  /**
   * Assembled explicitly rather than forwarded. `patchGuestSubmission` also rebuilds its UPDATE field by
   * field, so this is the second of two independent places that refuse to carry `status` or `userId` —
   * deliberate, because this one is reached directly by an unauthenticated request.
   */
  const edit: Parameters<typeof patchGuestSubmission>[1] = {};
  if (typeof body.title === 'string') edit.title = body.title.slice(0, 200);
  if (typeof body.description === 'string') edit.description = body.description.slice(0, 2000);
  if (Array.isArray(body.components)) edit.components = body.components;
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    edit.data = body.data as Record<string, unknown>;
  }
  if (!Object.keys(edit).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 });

  try {
    await patchGuestSubmission(id, edit, ctx.guest);
  } catch (e) {
    return failed(e, 'Could not save the page.');
  }
  return NextResponse.json({ ok: true, id });
}

/** Read back the draft, so a resumed session can rehydrate the canvas. */
export async function GET(request: NextRequest) {
  const ctx = await context(request);
  if (!ctx) return unauthorized();

  const id = ctx.session.submissionId;
  if (!id) return NextResponse.json({ submission: null });

  const row = await getDbPatternById(id);
  /**
   * Ownership is re-checked on read too: a cookie naming a page this session has no claim to must not read it
   * back, even though only a signed cookie could have named it.
   *
   * ⚠️ The shared predicate, not an inline token comparison. The inline version — `row.shareLinkToken ===
   * ctx.guest.shareLinkId` — refused a **return-link** holder, whose page was created through a different token.
   * Two copies of one rule, and only one of them learned about R.3.
   */
  if (!row || !isGuestOwnPage(ctx.guest, { id: row.id, shareLinkId: row.shareLinkToken, status: row.status })) {
    return NextResponse.json({ submission: null });
  }

  /**
   * The guardrail config travels with the submission so the editor enforces exactly what the server will
   * at submit — resolved from the **template**, which is where limits are authored. Sending the resolved
   * config rather than letting the client find it means one resolution rule, not two.
   */
  const template = row.templateId ? await getDbPatternById(row.templateId) : null;
  const fromTemplate = guardrailsFromPatternData(template?.data);
  const guardrails = Object.keys(fromTemplate).length ? fromTemplate : guardrailsFromPatternData(row.data);

  return NextResponse.json({
    submission: {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      components: row.components,
      data: row.data,
      updatedAt: row.updatedAt,
    },
    capabilities: ctx.guest.capabilities,
    /**
     * Whether this session may still edit, answered **here** rather than derived in the browser from `status`.
     *
     * The client used to read "status === 'draft' ? editing : submitted", which is a second copy of a rule that
     * now differs by link kind — a returning author on a page in `review` may edit, and that client-side copy
     * would have shown them a read-only screen. `canGuestEditPattern` is the only thing that knows.
     */
    canEdit: canGuestEditPattern(ctx.guest, { id: row.id, shareLinkId: row.shareLinkToken, status: row.status }),
    guardrails,
  });
}
