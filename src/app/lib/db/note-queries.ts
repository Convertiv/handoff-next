import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { getDb } from './index';
import { handoffPageNotes, handoffPatterns, users } from './schema';
import { AuthorizationError, computePermissions, toVisibility, type MutateActor, type ResourceGrant } from '../authz/policy';
import { decideNoteAccess, noteAuthorLabel, type NoteActor as NoteDecisionActor } from '../authz/notes';
import type { GuestPrincipal } from '../authz/guest';

/**
 * Reading and writing the notes on a page (reflow R.4).
 *
 * **This module holds no rules.** It fetches the row, asks `authz/notes.ts` what the caller may do, and obeys.
 * The decisions are pure and unit-tested there; keeping them out of here is what stops a second, subtly
 * different copy growing next to the query that needed it — which is exactly how the return link ended up
 * excluded from two routes in R.3.
 */

export interface PageNote {
  id: number;
  parentId: number | null;
  body: string;
  createdAt: string | null;
  resolvedAt: string | null;
  authorName: string;
  /** True when written by the page's anonymous author, so the UI can say whose word it is. */
  fromGuest: boolean;
}

/** Who is asking, with what the DB layer needs in order to resolve their permissions. */
export type NoteActor =
  | { kind: 'user'; actor: MutateActor; grant?: ResourceGrant | null }
  | { kind: 'guest'; guest: GuestPrincipal; email: string | null };

async function access(pageId: string, who: NoteActor) {
  const db = getDb();
  const [row] = await db
    .select({
      id: handoffPatterns.id,
      userId: handoffPatterns.userId,
      visibility: handoffPatterns.visibility,
      status: handoffPatterns.status,
      shareLinkToken: handoffPatterns.shareLinkToken,
    })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, pageId))
    .limit(1);
  if (!row) throw new AuthorizationError('Page not found.');

  const decisionActor: NoteDecisionActor =
    who.kind === 'guest'
      ? { kind: 'guest', guest: who.guest }
      : {
          kind: 'user',
          permissions: computePermissions(
            who.actor,
            { ownerUserId: row.userId ?? null, visibility: toVisibility(row.visibility) },
            who.grant ?? null
          ),
        };

  return decideNoteAccess(
    { id: row.id, status: row.status, shareLinkId: row.shareLinkToken },
    decisionActor
  );
}

/** The thread, oldest first. Attribution follows `noteAuthorLabel` — a guest is never shown another's address. */
export async function listPageNotes(pageId: string, who: NoteActor): Promise<PageNote[]> {
  const decision = await access(pageId, who);
  if (!decision.canRead) throw new AuthorizationError('You cannot see this page’s notes.');

  const db = getDb();
  const rows = await db
    .select({
      id: handoffPageNotes.id,
      parentId: handoffPageNotes.parentId,
      body: handoffPageNotes.body,
      createdAt: handoffPageNotes.createdAt,
      resolvedAt: handoffPageNotes.resolvedAt,
      authorUserId: handoffPageNotes.authorUserId,
      authorGuestEmail: handoffPageNotes.authorGuestEmail,
      userName: users.name,
      userEmail: users.email,
    })
    .from(handoffPageNotes)
    .leftJoin(users, eq(users.id, handoffPageNotes.authorUserId))
    .where(eq(handoffPageNotes.patternId, pageId))
    .orderBy(asc(handoffPageNotes.createdAt), asc(handoffPageNotes.id));

  return rows.map((r) => ({
    id: r.id,
    parentId: r.parentId ?? null,
    body: r.body,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    resolvedAt: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    ...noteAuthorLabel(r, decision),
  }));
}

export async function addPageNote(
  pageId: string,
  input: { body: string; parentId?: number | null },
  who: NoteActor
): Promise<PageNote[]> {
  const decision = await access(pageId, who);
  if (!decision.canWrite) throw new AuthorizationError('You cannot add a note to this page.');

  const body = input.body.trim().slice(0, 4000);
  if (!body) throw new Error('A note needs something in it.');

  const db = getDb();

  /**
   * A reply must belong to **this page's** thread.
   *
   * Checked rather than trusted: `parentId` arrives in a request body, and without this a caller could attach a
   * note to a thread on a page they cannot see — which leaks that the page exists, and eventually leaks the
   * reply itself to whoever can read that other thread.
   */
  let parentId: number | null = null;
  if (input.parentId != null) {
    const [parent] = await db
      .select({ id: handoffPageNotes.id, patternId: handoffPageNotes.patternId, parentId: handoffPageNotes.parentId })
      .from(handoffPageNotes)
      .where(eq(handoffPageNotes.id, input.parentId))
      .limit(1);
    if (!parent || parent.patternId !== pageId) throw new AuthorizationError('That note is not on this page.');
    // One level deep. A reply to a reply attaches to the top of that thread rather than erroring, because the
    // person typing did nothing wrong.
    parentId = parent.parentId ?? parent.id;
  }

  await db.insert(handoffPageNotes).values({
    patternId: pageId,
    parentId,
    body,
    ...(who.kind === 'user'
      ? { authorUserId: who.actor.userId }
      : // The address they gave, which is all a guest has. Unverified by nature — see `PageProvenance`.
        { authorGuestEmail: who.email?.trim() || 'anonymous@guest' }),
  });

  return listPageNotes(pageId, who);
}

/**
 * Mark a note handled, or un-mark it.
 *
 * A toggle rather than a delete: a resolved note is still part of what happened to this page, and deleting the
 * request that caused a change makes the change unexplainable later.
 */
export async function resolvePageNote(
  pageId: string,
  noteId: number,
  resolved: boolean,
  who: NoteActor
): Promise<PageNote[]> {
  const decision = await access(pageId, who);
  if (!decision.canResolve) throw new AuthorizationError('You cannot resolve notes on this page.');

  const db = getDb();
  await db
    .update(handoffPageNotes)
    .set({
      resolvedAt: resolved ? new Date() : null,
      resolvedByUserId: resolved && who.kind === 'user' ? who.actor.userId : null,
      updatedAt: new Date(),
    })
    // Scoped to the page as well as the note: a note id from another page must not be resolvable through a
    // page the caller happens to have rights on.
    .where(and(eq(handoffPageNotes.id, noteId), eq(handoffPageNotes.patternId, pageId)));

  return listPageNotes(pageId, who);
}

/** How many notes are still open, for a badge. */
export async function openNoteCount(pageId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: handoffPageNotes.id })
    .from(handoffPageNotes)
    .where(and(eq(handoffPageNotes.patternId, pageId), isNull(handoffPageNotes.resolvedAt)));
  return rows.length;
}
