import { canGuestEditPattern, type GuestPatternRef, type GuestPrincipal } from './guest';
import type { ResourcePermissions } from './vocab';

/**
 * Who may read, write and resolve the notes on a page (reflow R.4).
 *
 * **Pure, and separate from the queries that use it**, for the same reason `decidePatternMetaChange` is: these
 * are the decisions standing between two very different callers — a signed-in teammate and an anonymous author
 * holding a link — and they should be assertable without a Postgres connection. The IO half lives in
 * `db/note-queries.ts` and does nothing but fetch the row and obey this.
 *
 * **Why notes need their own decision at all.** The old model had one channel: a reviewer's verdict, written
 * once, at the moment of deciding. Anything short of a decision — "can you shorten the headline?", "the client
 * moved the date" — had nowhere to go, so it went to email, where it is invisible to whoever opens the page next.
 */

/** Just enough of a page to decide. Deliberately not the row: a decision should not be able to read `components`. */
export interface NotePageRef {
  id: string;
  status: string;
  /** `handoff_pattern.share_link_token` — the link the page was created through, if any. */
  shareLinkId: string | null;
}

/** Who is asking. Exactly one shape, mirroring the actor split used everywhere else in this codebase. */
export type NoteActor =
  | { kind: 'user'; permissions: ResourcePermissions }
  | { kind: 'guest'; guest: GuestPrincipal };

export interface NoteAccess {
  canRead: boolean;
  canWrite: boolean;
  /** Closing a note is housekeeping, and it belongs to the side that owns the page. */
  canResolve: boolean;
  /**
   * True for the signed-in side.
   *
   * Drives *attribution*, not permission: an owner sees the address a guest gave, because they are the one who
   * has to know who they are talking to. A guest sees their own notes as "You" and never another guest's
   * address — see `listPageNotes`.
   */
  isOwnerSide: boolean;
}

const NONE: NoteAccess = { canRead: false, canWrite: false, canResolve: false, isOwnerSide: false };

/**
 * **Read and write are the same answer, deliberately.**
 *
 * A thread you can read but not answer is a notice board, and the entire point is that the two people involved
 * can talk to each other. What differs is `canResolve`: a guest marking their own request handled would be
 * marking their own homework.
 */
export function decideNoteAccess(page: NotePageRef, who: NoteActor): NoteAccess {
  if (who.kind === 'guest') {
    /**
     * A guest may talk about a page they may still edit — which, holding a return link, includes a submitted
     * one (R.3).
     *
     * Reusing `canGuestEditPattern` rather than writing a second rule: "may I touch this page" already has one
     * answer, a note is touching it, and a parallel rule here is exactly how the return link got excluded from
     * two places last time.
     */
    const ref: GuestPatternRef = { id: page.id, shareLinkId: page.shareLinkId, status: page.status };
    const allowed = canGuestEditPattern(who.guest, ref);
    return allowed ? { canRead: true, canWrite: true, canResolve: false, isOwnerSide: false } : NONE;
  }

  const { canView, canEdit } = who.permissions;
  if (!canView) return NONE;
  return {
    canRead: true,
    /**
     * `canEdit`, not `canView`. Commenting is not editing the page, but it is writing to its record — and
     * "anyone who can see this can annotate it" is a bigger claim than any existing permission makes, so it is
     * not one to invent here.
     */
    canWrite: canEdit,
    canResolve: canEdit,
    isOwnerSide: true,
  };
}

/**
 * How a note should be attributed when it is shown.
 *
 * Pure so the "never show one guest another guest's address" rule is testable — it is a privacy rule, and those
 * are worth asserting rather than reviewing.
 */
export function noteAuthorLabel(
  note: { authorUserId: string | null; authorGuestEmail: string | null; userName?: string | null; userEmail?: string | null },
  access: Pick<NoteAccess, 'isOwnerSide'>
): { authorName: string; fromGuest: boolean } {
  if (note.authorUserId == null) {
    return {
      // The owner needs the address; the guest reading their own note does not need to be told it back.
      authorName: access.isOwnerSide ? (note.authorGuestEmail ?? 'the author') : 'You',
      fromGuest: true,
    };
  }
  return { authorName: note.userName || note.userEmail || 'A teammate', fromGuest: false };
}
