import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  canGuestCreateFromTemplate,
  canGuestEditPattern,
  canGuestSubmitPattern,
  canGuestUseAssetLibrary,
  canGuestView,
  type GuestPrincipal,
} from '../src/app/lib/authz/guest';
import { AUTHORING_CAPABILITIES, isWriteCapable, toShareCapabilities } from '../src/app/lib/authz/vocab';

/**
 * These predicates stand between an unauthenticated URL and the pattern table, so the cases that
 * matter are the ones where a guest tries to reach past their own submission.
 */

const guest = (over: Partial<GuestPrincipal> = {}): GuestPrincipal => ({
  shareLinkId: 'link-1',
  capabilities: [...AUTHORING_CAPABILITIES],
  name: 'Casey',
  ...over,
});

describe('canGuestCreateFromTemplate', () => {
  it('allows a full authoring link to start from a template', () => {
    assert.equal(canGuestCreateFromTemplate(guest(), 'tpl-1'), true);
  });

  it('refuses without the capability', () => {
    assert.equal(canGuestCreateFromTemplate(guest({ capabilities: ['view'] }), 'tpl-1'), false);
  });

  it('refuses a blank template id', () => {
    assert.equal(canGuestCreateFromTemplate(guest(), '   '), false);
  });
});

describe('canGuestEditPattern', () => {
  it('allows editing their own draft', () => {
    assert.equal(canGuestEditPattern(guest(), { shareLinkId: 'link-1', status: 'draft' }), true);
  });

  it('refuses a page created through a different link', () => {
    // The core isolation property: two guests on two links must not reach each other's work.
    assert.equal(canGuestEditPattern(guest(), { shareLinkId: 'link-2', status: 'draft' }), false);
  });

  it('refuses a page that no link created', () => {
    // Every pre-existing pattern in the deployment has a null share_link_token. If null matched, one
    // share link would open the whole library for editing.
    assert.equal(canGuestEditPattern(guest(), { shareLinkId: null, status: 'draft' }), false);
  });

  it('refuses when the guest holds no link id', () => {
    assert.equal(canGuestEditPattern(guest({ shareLinkId: '' }), { shareLinkId: '', status: 'draft' }), false);
  });

  it('locks editing once submitted or beyond', () => {
    for (const status of ['review', 'approved', 'archived', 'prototype']) {
      assert.equal(
        canGuestEditPattern(guest(), { shareLinkId: 'link-1', status }),
        false,
        `${status} must not be guest-editable`
      );
    }
  });

  it('refuses without the capability even on their own draft', () => {
    assert.equal(
      canGuestEditPattern(guest({ capabilities: ['view', 'create_from_template'] }), {
        shareLinkId: 'link-1',
        status: 'draft',
      }),
      false
    );
  });
});

describe('canGuestSubmitPattern', () => {
  it('allows submitting their own draft', () => {
    assert.equal(canGuestSubmitPattern(guest(), { shareLinkId: 'link-1', status: 'draft' }), true);
  });

  it('refuses submitting twice', () => {
    assert.equal(canGuestSubmitPattern(guest(), { shareLinkId: 'link-1', status: 'review' }), false);
  });

  it('refuses someone else’s page', () => {
    assert.equal(canGuestSubmitPattern(guest(), { shareLinkId: 'link-2', status: 'draft' }), false);
  });

  it('separates building from submitting', () => {
    // A link may let someone build without letting them hand it to a reviewer.
    const builder = guest({ capabilities: ['view', 'create_from_template', 'edit_own_submission'] });
    assert.equal(canGuestEditPattern(builder, { shareLinkId: 'link-1', status: 'draft' }), true);
    assert.equal(canGuestSubmitPattern(builder, { shareLinkId: 'link-1', status: 'draft' }), false);
  });
});

describe('asset library and view capabilities', () => {
  it('are independent of each other', () => {
    assert.equal(canGuestUseAssetLibrary(guest({ capabilities: ['use_asset_library'] })), true);
    assert.equal(canGuestView(guest({ capabilities: ['use_asset_library'] })), false);
    assert.equal(canGuestUseAssetLibrary(guest({ capabilities: ['view'] })), false);
  });
});

describe('capability vocabulary', () => {
  it('never grants image generation — guests use the existing library only', () => {
    // Pinned as a rule, not a comment: adding generation must be a deliberate change that breaks a
    // test, because it puts metered spend behind an unauthenticated URL.
    assert.equal((AUTHORING_CAPABILITIES as readonly string[]).includes('generate_image'), false);
    assert.deepEqual(toShareCapabilities(['generate_image']), []);
  });

  it('drops unknown capabilities from stored data', () => {
    assert.deepEqual(toShareCapabilities(['view', 'nonsense', 42, null]), ['view']);
    assert.deepEqual(toShareCapabilities('view'), []);
    assert.deepEqual(toShareCapabilities(null), []);
  });

  it('dedupes, so a repeated capability cannot change a length check', () => {
    assert.deepEqual(toShareCapabilities(['view', 'view', 'submit_for_review']), ['view', 'submit_for_review']);
  });

  it('classifies write-capable links', () => {
    assert.equal(isWriteCapable(['view']), false);
    assert.equal(isWriteCapable(['view', 'use_asset_library']), false);
    assert.equal(isWriteCapable(['view', 'create_from_template']), true);
    assert.equal(isWriteCapable([...AUTHORING_CAPABILITIES]), true);
  });
});
