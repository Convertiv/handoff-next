import assert from 'node:assert';
import { describe, it } from 'node:test';
import { decidePatternMetaChange, decideReview } from '../src/app/lib/authz/review';
import type { ResourcePermissions } from '../src/app/lib/authz/vocab';

/**
 * The approve gate. It moved out of the `setPatternMeta` server action so MCP and HTTP share one copy —
 * these tests are what keep the moved rules identical to the ones they replaced.
 */

const perms = (over: Partial<ResourcePermissions> = {}): ResourcePermissions => ({
  canView: true,
  canEdit: true,
  canDelete: false,
  canChangeVisibility: false,
  canApprove: false,
  ...over,
});

const draft = { visibility: 'private', status: 'draft' };
const inReview = { visibility: 'private', status: 'review' };

describe('decidePatternMetaChange', () => {
  it('lets an editor move a status that is not "approved"', () => {
    const d = decidePatternMetaChange(draft, { status: 'review' }, perms());
    assert.deepEqual(d, { ok: true, patch: { status: 'review' } });
  });

  it('reserves "approved" for a maintainer', () => {
    const denied = decidePatternMetaChange(inReview, { status: 'approved' }, perms({ canEdit: true }));
    assert.equal(denied.ok, false);
    assert.equal(denied.ok === false && denied.code, 'forbidden');

    const allowed = decidePatternMetaChange(inReview, { status: 'approved' }, perms({ canApprove: true }));
    assert.deepEqual(allowed, { ok: true, patch: { status: 'approved' } });
  });

  it('requires canChangeVisibility for visibility', () => {
    const denied = decidePatternMetaChange(draft, { visibility: 'team' }, perms());
    assert.equal(denied.ok === false && denied.code, 'forbidden');

    const allowed = decidePatternMetaChange(draft, { visibility: 'team' }, perms({ canChangeVisibility: true }));
    assert.deepEqual(allowed, { ok: true, patch: { visibility: 'team' } });
  });

  it('drops no-op fields instead of demanding rights for them', () => {
    // A UI that submits the whole meta object shouldn't need approve rights to leave `approved` alone.
    const d = decidePatternMetaChange({ visibility: 'team', status: 'approved' }, { visibility: 'team', status: 'approved' }, perms());
    assert.deepEqual(d, { ok: true, patch: {} });
  });

  it('rejects values outside the vocabulary', () => {
    for (const bad of [{ status: 'published' }, { visibility: 'world-readable' }]) {
      const d = decidePatternMetaChange(draft, bad, perms({ canApprove: true, canChangeVisibility: true }));
      assert.equal(d.ok, false, `${JSON.stringify(bad)} should be invalid`);
      assert.equal(d.ok === false && d.code, 'invalid');
    }
  });

  it('checks validity before permission, so a typo does not read as a rights problem', () => {
    const d = decidePatternMetaChange(draft, { status: 'aproved' }, perms());
    assert.equal(d.ok === false && d.code, 'invalid');
  });
});

describe('decideReview', () => {
  it('approves a submission in review', () => {
    assert.deepEqual(decideReview(inReview, 'approve', perms({ canApprove: true })), {
      ok: true,
      patch: { status: 'approved' },
    });
  });

  it('sends a rejection back to draft, which is what re-opens guest editing', () => {
    assert.deepEqual(decideReview(inReview, 'reject', perms({ canApprove: true })), {
      ok: true,
      patch: { status: 'draft' },
    });
  });

  it('requires canApprove for rejection too, not merely canEdit', () => {
    // Otherwise the submission's owner — the link creator — could clear the queue without being a maintainer.
    const d = decideReview(inReview, 'reject', perms({ canEdit: true, canChangeVisibility: true }));
    assert.equal(d.ok === false && d.code, 'forbidden');
  });

  it('refuses to decide anything not awaiting review', () => {
    for (const status of ['draft', 'approved', 'archived', 'prototype']) {
      const d = decideReview({ visibility: 'private', status }, 'approve', perms({ canApprove: true }));
      assert.equal(d.ok, false, `${status} should not be decidable`);
      assert.equal(d.ok === false && d.code, 'invalid');
      assert.match(d.ok === false ? d.reason : '', new RegExp(status));
    }
  });

  it('never touches visibility — approving asks for attention, not access', () => {
    const d = decideReview(inReview, 'approve', perms({ canApprove: true, canChangeVisibility: true }));
    assert.equal(d.ok && 'visibility' in d.patch, false);
  });
});
