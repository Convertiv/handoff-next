import { NextResponse, type NextRequest } from 'next/server';
import { isAuthorizationError } from '@/lib/authz/policy';
import { createGuestSubmission, patchGuestSubmission } from '@/lib/db/pattern-write';
import { getDbPatternById } from '@/lib/db/queries';
import { readGuestContext, type GuestContext } from '@/lib/server/guest-context';
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
  if (ctx.session.submissionId) {
    const current = await getDbPatternById(ctx.session.submissionId);
    /**
     * Idempotent while the draft is still open: a double-submitted form should return that draft, not a
     * second one.
     *
     * But once it has been submitted it is locked (`canGuestEditPattern` requires `draft`), and a
     * session still pointing at it would be a dead end — the guest could neither edit it nor start
     * anything new. So a non-draft submission falls through and a fresh page is created below, with the
     * cookie repointed. The submitted page is untouched and stays in the review queue.
     */
    if (current && current.status === 'draft' && current.shareLinkToken === ctx.guest.shareLinkId) {
      return NextResponse.json({ id: current.id, created: false });
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
      },
      ctx.guest,
      ctx.ownerUserId
    );
  } catch (e) {
    return failed(e, 'Could not start the page.');
  }

  // Re-issue the cookie so the session now points at the draft — this is what makes it resumable.
  const { token, session } = issueGuestSession(
    { linkId: ctx.link.token, submissionId: id, name: ctx.guest.name },
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
  // Provenance is re-checked on read too: a cookie naming a page that this link did not create must not
  // be able to read it back, even though only a signed cookie could have named it.
  if (!row || row.shareLinkToken !== ctx.guest.shareLinkId) {
    return NextResponse.json({ submission: null });
  }

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
  });
}
