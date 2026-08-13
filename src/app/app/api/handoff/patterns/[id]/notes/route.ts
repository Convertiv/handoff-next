import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { isAuthorizationError, type MutateActor } from '@/lib/authz/policy';
import { getActorGrant } from '@/lib/db/grant-queries';
import { addPageNote, listPageNotes, resolvePageNote, type NoteActor } from '@/lib/db/note-queries';
import { readGuestContext } from '@/lib/server/guest-context';
import { GUEST_LIMITS, isRateLimited } from '@/lib/rate-limit';

/**
 * The conversation on a page (reflow R.4).
 *
 * **One route for two kinds of caller**, which is the unusual thing here and is deliberate: the owner and the
 * page's anonymous author are talking *to each other*. A separate guest endpoint would mean two places deciding
 * who may say what, and those two drifting is exactly how the return link ended up locked out of its own page in
 * R.3. The `?link=` parameter picks the guest path, a session picks the other, and the rules themselves live in
 * `authz/notes.ts` — once.
 *
 * A guest is identified by the link they hold, never by anything in the body.
 */
async function resolveActor(request: NextRequest): Promise<NoteActor | null> {
  const linkId = request.nextUrl.searchParams.get('link')?.trim();
  if (linkId) {
    const ctx = await readGuestContext(linkId);
    if (!ctx) return null;
    return { kind: 'guest', guest: ctx.guest, email: ctx.session.email ?? null };
  }

  const session = await auth();
  if (!session?.user) return null;
  const userId = typeof session.user.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  return { kind: 'user', actor: { userId, role: session.user.role ?? null } satisfies MutateActor };
}

/** Resolve the caller's grant, which only the signed-in path has. */
async function withGrant(id: string, who: NoteActor): Promise<NoteActor> {
  if (who.kind !== 'user') return who;
  return { ...who, grant: await getActorGrant('pattern', id, who.actor.userId) };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const pageId = (id ?? '').trim();
  if (!pageId) return NextResponse.json({ error: 'A page id is required.' }, { status: 400 });

  const who = await resolveActor(request);
  if (!who) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    return NextResponse.json({ notes: await listPageNotes(pageId, await withGrant(pageId, who)) });
  } catch (e) {
    if (isAuthorizationError(e)) return NextResponse.json({ error: e.message }, { status: 403 });
    console.error('[notes GET]', e);
    return NextResponse.json({ error: 'Could not load the notes.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const pageId = (id ?? '').trim();
  if (!pageId) return NextResponse.json({ error: 'A page id is required.' }, { status: 400 });

  const who = await resolveActor(request);
  if (!who) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // A note from a guest is a write from an unauthenticated caller, so it meets the same limiter as the rest of
  // that surface. Signed-in callers are already accountable.
  if (
    who.kind === 'guest' &&
    isRateLimited(`guest:note:${who.guest.shareLinkId}`, GUEST_LIMITS.submit.limit, GUEST_LIMITS.submit.windowMs)
  ) {
    return NextResponse.json({ error: 'Too many notes; try again in a minute.' }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    body?: unknown;
    parentId?: unknown;
    /** Present instead of `body` to toggle an existing note's resolved state. */
    noteId?: unknown;
    resolved?: unknown;
  };

  try {
    const actor = await withGrant(pageId, who);

    // Resolving is a small state change on an existing note rather than a new resource — same route, explicit
    // fields, and the authz for it is a different answer (`canResolve`) inside one decision.
    if (typeof body.noteId === 'number') {
      return NextResponse.json({ notes: await resolvePageNote(pageId, body.noteId, body.resolved !== false, actor) });
    }

    if (typeof body.body !== 'string' || !body.body.trim()) {
      return NextResponse.json({ error: 'A note needs something in it.' }, { status: 400 });
    }
    const parentId = typeof body.parentId === 'number' ? body.parentId : null;
    return NextResponse.json({ notes: await addPageNote(pageId, { body: body.body, parentId }, actor) });
  } catch (e) {
    if (isAuthorizationError(e)) return NextResponse.json({ error: e.message }, { status: 403 });
    console.error('[notes POST]', e);
    return NextResponse.json({ error: 'Could not save the note.' }, { status: 500 });
  }
}
