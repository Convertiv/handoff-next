import assert from 'node:assert';
import { describe, it } from 'node:test';
import { canMutatePattern, computePermissions, isGuestActor } from '../../src/app/lib/authz/policy';

/**
 * Server-condition test lane (`test:unit:server`): `policy.ts` is `server-only`, so it can only be
 * imported with `--conditions=react-server`. Until now that meant the authorization layer had no tests
 * at all.
 *
 * These pin the guard that guest authoring depends on. `canMutatePattern` grants access when
 * `ownerUserId == null`, because legacy/unowned patterns are team-editable — and a guest's `userId` is
 * also null. Without an explicit guest denial, handing anyone a share link would hand them every
 * unowned pattern in the deployment, and each individual call site would still look correct.
 */

const guestActor = {
  userId: null,
  guest: { shareLinkId: 'link-1', capabilities: ['view', 'edit_own_submission'] as const, name: 'Casey' },
};

describe('canMutatePattern — guest denial', () => {
  it('denies a guest on an unowned pattern, where an authenticated user would be allowed', () => {
    assert.equal(canMutatePattern({ userId: 'u1' }, null), true, 'baseline: unowned is team-editable');
    assert.equal(canMutatePattern(guestActor, null), false);
  });

  it('denies a guest on an owned pattern', () => {
    assert.equal(canMutatePattern(guestActor, 'someone-else'), false);
  });

  it('denies a guest even when the actor also claims admin', () => {
    // A guest principal must dominate the role field: whatever assembles the actor, presence of a
    // share-link bearer means ownership paths are closed.
    assert.equal(canMutatePattern({ ...guestActor, role: 'admin' }, 'someone-else'), false);
  });

  it('leaves the non-guest paths untouched', () => {
    assert.equal(canMutatePattern({ userId: null, role: 'admin' }, 'owner'), true);
    assert.equal(canMutatePattern({ userId: 'owner' }, 'owner'), true);
    assert.equal(canMutatePattern({ userId: 'other' }, 'owner'), false);
  });
});

describe('computePermissions — guest holds capabilities, not permissions', () => {
  it('grants view from the link and nothing else', () => {
    const perms = computePermissions(guestActor, { ownerUserId: 'u1', visibility: 'private' });
    assert.deepEqual(perms, {
      canView: true,
      canEdit: false,
      canDelete: false,
      canChangeVisibility: false,
      canApprove: false,
    });
  });

  it('does not let team or public visibility leak edit rights to a guest', () => {
    for (const visibility of ['team', 'public'] as const) {
      const perms = computePermissions(guestActor, { ownerUserId: null, visibility });
      assert.equal(perms.canEdit, false, `${visibility} must not grant guest edit`);
      assert.equal(perms.canDelete, false);
      assert.equal(perms.canApprove, false);
    }
  });

  it('ignores a stray edit grant for a guest', () => {
    const perms = computePermissions(guestActor, { ownerUserId: null, visibility: 'private' }, { level: 'edit' });
    assert.equal(perms.canEdit, false);
  });

  it('withholds view when the link does not include it', () => {
    const viewless = { ...guestActor, guest: { ...guestActor.guest, capabilities: [] as const } };
    assert.equal(computePermissions(viewless, { ownerUserId: null, visibility: 'public' }).canView, false);
  });
});

describe('isGuestActor', () => {
  it('distinguishes a share-link bearer from a token/legacy caller', () => {
    assert.equal(isGuestActor(guestActor), true);
    assert.equal(isGuestActor({ userId: null, role: 'admin' }), false);
    assert.equal(isGuestActor({ userId: 'u1' }), false);
  });
});
