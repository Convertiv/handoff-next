import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  canGuestCreateFromTemplate,
  canGuestEditPattern,
  canGuestSubmitPattern,
  isGuestOwnPage,
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

describe('the return link — coming back to your own page', () => {
  /**
   * The case R.3 shipped broken: the page was created through the *template* link, and its author holds a
   * *return* link pointing at that page. The token on the row is not the token they hold, so any rule that
   * compares the two refuses the person it was issued to.
   */
  const page = { id: 'page_a', shareLinkId: 'tok_template', status: 'review' };
  const returning = {
    shareLinkId: 'tok_return',
    resourceId: 'page_a',
    capabilities: ['view', 'edit_own_submission'] as const,
    name: 'Rep A',
  };

  it('recognises the page as theirs even though a different link created it', () => {
    assert.equal(isGuestOwnPage(returning, page), true);
  });

  it('lets them edit a page already in review — the whole point of the link', () => {
    assert.equal(canGuestEditPattern(returning, page), true);
    assert.equal(canGuestEditPattern(returning, { ...page, status: 'draft' }), true);
  });

  it('stops at a decision', () => {
    // Approved or archived means someone acted on it; editing under that rewrites what was decided.
    for (const status of ['approved', 'archived']) {
      assert.equal(canGuestEditPattern(returning, { ...page, status }), false, status);
    }
  });

  it('does NOT let them re-submit', () => {
    // Editing a submitted page is what a return link is for. Re-submitting would fire the owner's notification
    // again and rewrite the submit half of the provenance record.
    assert.equal(
      canGuestSubmitPattern({ ...returning, capabilities: ['submit_for_review', 'edit_own_submission'] }, page),
      false
    );
  });

  it('claims nothing about a page its link does not point at', () => {
    const other = { id: 'page_b', shareLinkId: 'tok_template', status: 'draft' };
    assert.equal(isGuestOwnPage(returning, other), false);
    assert.equal(canGuestEditPattern(returning, other), false);
  });

  it('leaves a template-link holder locked at draft', () => {
    // The relaxation is per link kind: a guest mid-build must not keep editing what a reviewer is looking at.
    const building = { shareLinkId: 'tok_template', capabilities: ['edit_own_submission'] as const, name: 'Rep' };
    assert.equal(canGuestEditPattern(building, page), false);
    assert.equal(canGuestEditPattern(building, { ...page, status: 'draft' }), true);
  });

  it('does not treat two absent ids as a match', () => {
    assert.equal(isGuestOwnPage({ ...returning, resourceId: undefined }, { ...page, id: undefined }), false);
  });
});
