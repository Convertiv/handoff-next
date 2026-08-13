import assert from 'node:assert';
import { describe, it } from 'node:test';
import { decideNoteAccess, noteAuthorLabel, type NotePageRef } from '../src/app/lib/authz/notes';
import type { ResourcePermissions } from '../src/app/lib/authz/vocab';

/**
 * The notes decision (reflow R.4).
 *
 * Two very different callers reach one thread — a signed-in teammate and an anonymous author holding a link —
 * and the rules that keep them apart are worth asserting rather than reviewing.
 */

const perms = (over: Partial<ResourcePermissions> = {}): ResourcePermissions => ({
  canView: true,
  canEdit: true,
  canDelete: false,
  canChangeVisibility: false,
  canApprove: false,
  ...over,
});

/** A page a guest built through a template link, now submitted. */
const page: NotePageRef = { id: 'page_a', status: 'review', shareLinkId: 'tok_template' };

const author = {
  shareLinkId: 'tok_return',
  resourceId: 'page_a',
  capabilities: ['view', 'edit_own_submission'] as const,
  name: 'Rep A',
};

describe('decideNoteAccess — the signed-in side', () => {
  it('lets someone who can edit the page read, write and resolve', () => {
    assert.deepEqual(decideNoteAccess(page, { kind: 'user', permissions: perms() }), {
      canRead: true,
      canWrite: true,
      canResolve: true,
      isOwnerSide: true,
    });
  });

  it('lets a view-only teammate read but not annotate', () => {
    // "Anyone who can see this can write on it" is a bigger claim than any existing permission makes.
    const access = decideNoteAccess(page, { kind: 'user', permissions: perms({ canEdit: false }) });
    assert.equal(access.canRead, true);
    assert.equal(access.canWrite, false);
    assert.equal(access.canResolve, false);
  });

  it('gives nothing to someone who cannot see the page', () => {
    const access = decideNoteAccess(page, { kind: 'user', permissions: perms({ canView: false, canEdit: false }) });
    assert.deepEqual(access, { canRead: false, canWrite: false, canResolve: false, isOwnerSide: false });
  });
});

describe('decideNoteAccess — the author', () => {
  it('lets the author of a submitted page join the thread', () => {
    // The page is in `review`; their return link is exactly what keeps it open to them (R.3).
    const access = decideNoteAccess(page, { kind: 'guest', guest: author });
    assert.equal(access.canRead, true);
    assert.equal(access.canWrite, true);
  });

  it('never lets them resolve — that would be marking their own homework', () => {
    assert.equal(decideNoteAccess(page, { kind: 'guest', guest: author }).canResolve, false);
  });

  it('gives nothing on a page their link does not point at', () => {
    const other: NotePageRef = { id: 'page_b', status: 'review', shareLinkId: 'tok_template' };
    assert.deepEqual(decideNoteAccess(other, { kind: 'guest', guest: author }), {
      canRead: false,
      canWrite: false,
      canResolve: false,
      isOwnerSide: false,
    });
  });

  it('closes the thread to them once a decision has been made', () => {
    // Same boundary as editing: approved or archived means someone acted, and the record stops moving.
    for (const status of ['approved', 'archived']) {
      assert.equal(decideNoteAccess({ ...page, status }, { kind: 'guest', guest: author }).canRead, false, status);
    }
  });

  it('follows the edit rule rather than restating it', () => {
    // A guest whose link cannot edit cannot comment either — one answer to "may I touch this page".
    const readOnly = { ...author, capabilities: ['view'] as const };
    assert.equal(decideNoteAccess(page, { kind: 'guest', guest: readOnly }).canWrite, false);
  });
});

describe('noteAuthorLabel', () => {
  const guestNote = { authorUserId: null, authorGuestEmail: 'rep@example.com' };

  it('shows the owner who they are talking to', () => {
    assert.deepEqual(noteAuthorLabel(guestNote, { isOwnerSide: true }), {
      authorName: 'rep@example.com',
      fromGuest: true,
    });
  });

  it('never shows an address to the guest side', () => {
    // A privacy rule, not a cosmetic one: the guest reading the thread must not be handed an address back.
    assert.deepEqual(noteAuthorLabel(guestNote, { isOwnerSide: false }), { authorName: 'You', fromGuest: true });
  });

  it('names a signed-in author, falling back through what exists', () => {
    assert.equal(
      noteAuthorLabel({ authorUserId: 'u1', authorGuestEmail: null, userName: 'Ada' }, { isOwnerSide: true }).authorName,
      'Ada'
    );
    assert.equal(
      noteAuthorLabel({ authorUserId: 'u1', authorGuestEmail: null, userEmail: 'ada@x.co' }, { isOwnerSide: true })
        .authorName,
      'ada@x.co'
    );
    assert.equal(
      noteAuthorLabel({ authorUserId: 'u1', authorGuestEmail: null }, { isOwnerSide: true }).authorName,
      'A teammate'
    );
  });

  it('marks which side a note came from', () => {
    assert.equal(noteAuthorLabel(guestNote, { isOwnerSide: true }).fromGuest, true);
    assert.equal(
      noteAuthorLabel({ authorUserId: 'u1', authorGuestEmail: null }, { isOwnerSide: true }).fromGuest,
      false
    );
  });
});
