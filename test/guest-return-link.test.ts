import assert from 'node:assert';
import { describe, it } from 'node:test';
import { canGuestEditPattern, canGuestSubmitPattern } from '../src/app/lib/authz/guest';
import { GUEST_LIMITS, isRateLimited, __resetRateLimits } from '../src/app/lib/rate-limit';

/**
 * The return link (reflow R.3) — an anonymous author's way back to the page they made.
 *
 * Two kinds of link now claim different things, and getting the distinction wrong fails in both directions:
 * too strict and the author cannot reach their own page, too loose and one link opens somebody else's.
 */

const CAPS = ['view', 'edit_own_submission', 'submit_for_review'] as const;

/** Someone holding the **template** link: their claim is the token stamped on what they created. */
const templateHolder = { shareLinkId: 'tok_template', capabilities: CAPS, name: 'Rep', resourceId: 'tpl_1' };
/** Someone holding a **return** link: their claim is the page it points at. */
const returnHolder = { shareLinkId: 'tok_return', capabilities: CAPS, name: 'Rep', resourceId: 'page_a' };

const theirDraft = { id: 'page_a', shareLinkId: 'tok_template', status: 'draft' };
const theirSubmitted = { id: 'page_a', shareLinkId: 'tok_template', status: 'review' };
const someoneElses = { id: 'page_b', shareLinkId: 'tok_other', status: 'draft' };

describe('who may edit what', () => {
  it('lets a template-link holder edit the page they are building', () => {
    assert.equal(canGuestEditPattern(templateHolder, theirDraft), true);
  });

  it('locks a template-link holder out once it is submitted', () => {
    // The original rule, and it still matters: mid-build, editing after submission would change what a
    // reviewer already looked at with nothing in the record to say it moved.
    assert.equal(canGuestEditPattern(templateHolder, theirSubmitted), false);
  });

  it('lets a return-link holder come back to a submitted page', () => {
    // The entire point of issuing the link: "get back and make changes to the page they created".
    assert.equal(canGuestEditPattern(returnHolder, theirSubmitted), true);
    assert.equal(canGuestEditPattern(returnHolder, theirDraft), true);
  });

  it('stops at a decision', () => {
    // Approved or archived means someone acted on it; editing under that rewrites what was decided.
    for (const status of ['approved', 'archived']) {
      assert.equal(canGuestEditPattern(returnHolder, { ...theirSubmitted, status }), false, status);
    }
  });

  it('opens exactly one page, not every page', () => {
    assert.equal(canGuestEditPattern(returnHolder, someoneElses), false);
    // And a link pointing at a template is not a key to a page that happens to share the id space.
    assert.equal(canGuestEditPattern({ ...returnHolder, resourceId: 'tpl_1' }, someoneElses), false);
  });

  it('does not let two absent ids match', () => {
    // Two rows that each "point at nothing" are not pointing at the same thing — the null-match bug the
    // original `isOwnSubmission` guarded against, now with a second way in.
    const noResource = { ...returnHolder, resourceId: undefined };
    const noId = { shareLinkId: null, status: 'draft' };
    assert.equal(canGuestEditPattern(noResource, noId), false);
  });

  it('still requires the capability, whatever the link points at', () => {
    const readOnly = { ...returnHolder, capabilities: ['view'] as const };
    assert.equal(canGuestEditPattern(readOnly, theirSubmitted), false);
  });

  it('leaves submission alone: a returning author does not re-submit a submitted page', () => {
    // `canGuestSubmitPattern` keeps its `draft` rule — coming back to edit is not the same act as submitting,
    // and a second submission of the same page would double the record.
    assert.equal(canGuestSubmitPattern(returnHolder, theirSubmitted), false);
    assert.equal(canGuestSubmitPattern(returnHolder, theirDraft), true);
  });
});

describe('guest rate limits', () => {
  it('allows the limit and refuses the next one', () => {
    __resetRateLimits();
    const { limit, windowMs } = GUEST_LIMITS.submit;
    for (let i = 0; i < limit; i += 1) {
      assert.equal(isRateLimited('k', limit, windowMs, 1000), false, `event ${i + 1} should pass`);
    }
    assert.equal(isRateLimited('k', limit, windowMs, 1000), true);
  });

  it('forgets once the window has passed', () => {
    __resetRateLimits();
    for (let i = 0; i < 6; i += 1) isRateLimited('k', 5, 60_000, 1000);
    assert.equal(isRateLimited('k', 5, 60_000, 62_000), false);
  });

  it('counts each key separately', () => {
    __resetRateLimits();
    for (let i = 0; i < 6; i += 1) isRateLimited('a', 5, 60_000, 1000);
    assert.equal(isRateLimited('b', 5, 60_000, 1000), false);
  });
});
