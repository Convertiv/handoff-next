import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildProvenance,
  completeProvenance,
  pageEditedSinceSubmission,
  readProvenance,
  templateHasMovedOn,
} from '../src/app/lib/page-provenance';

/**
 * The two-moment provenance record (reflow R.2).
 *
 * The fork half is written when a guest is handed the template; the submit half when they let go of it. The
 * property that matters is that **the second write cannot damage the first** — the fork copy is the evidence,
 * and a submit that overwrote it would leave a record that agrees with whatever the template says today.
 */

const template = {
  id: 'tpl_1',
  updatedAt: new Date('2026-08-01T10:00:00Z'),
  components: [{ id: 'hero' }, { id: 'cta' }],
};

describe('provenance across fork and submit', () => {
  it('keeps the fork copy through submission', () => {
    const forked = buildProvenance({
      template,
      forkedAt: new Date('2026-08-02T09:00:00Z'),
      shareLinkToken: 'tok_a',
    });
    const submitted = completeProvenance(forked, {
      submittedAt: new Date('2026-08-02T11:00:00Z'),
      submittedByEmail: 'rep@example.com',
      findings: [{ category: 'content', code: 'missing-alt', message: 'Image has no alt text.' }],
    });

    assert.deepEqual(submitted.blocks, template.components, 'the copy they were handed survives');
    assert.equal(submitted.templateId, 'tpl_1');
    assert.equal(submitted.templateUpdatedAt, '2026-08-01T10:00:00.000Z');
    assert.equal(submitted.forkedAt, '2026-08-02T09:00:00.000Z');
    assert.equal(submitted.shareLinkToken, 'tok_a');
    assert.equal(submitted.submittedAt, '2026-08-02T11:00:00.000Z');
    assert.equal(submitted.submittedByEmail, 'rep@example.com');
    assert.equal(submitted.findings?.length, 1);
  });

  it('does not blank a fork value when the submit half has nothing to say', () => {
    const forked = buildProvenance({ template, submittedByEmail: 'given-at-entry@example.com' });
    const submitted = completeProvenance(forked, { submittedByEmail: '   ' });
    assert.equal(submitted.submittedByEmail, 'given-at-entry@example.com');
  });

  it('survives a page whose fork record never happened', () => {
    // A page from before R.2, submitted after it. Half a record is still worth keeping.
    const submitted = completeProvenance(null, { submittedByEmail: 'x@example.com' });
    assert.ok(submitted.submittedAt);
    assert.equal(submitted.blocks, undefined);
    assert.equal(submitted.templateId, undefined);
  });

  it('notices when the template moved after the fork', () => {
    const forked = readProvenance(buildProvenance({ template, forkedAt: new Date('2026-08-02T09:00:00Z') }));
    // The owner edits the template the next day. The submission's diff must not silently re-base onto it.
    assert.equal(templateHasMovedOn(forked, new Date('2026-08-03T10:00:00Z')), true);
    assert.equal(templateHasMovedOn(forked, template.updatedAt), false);
  });

  it('round-trips through storage after both writes', () => {
    const submitted = completeProvenance(buildProvenance({ template }), { submittedByEmail: 'a@b.c' });
    assert.deepEqual(readProvenance(JSON.parse(JSON.stringify(submitted))), submitted);
  });
});

describe('pageEditedSinceSubmission — the cost of editing in place', () => {
  const submitted = (iso: string) => readProvenance({ submittedAt: iso });

  it('says nothing about a page nobody has touched since', () => {
    // Submitting IS a write: the status and the provenance land in one UPDATE, so `updatedAt` is always a hair
    // later than `submittedAt`. Without the second of slack, every submission would claim to have been edited.
    assert.equal(pageEditedSinceSubmission(submitted('2026-08-02T11:00:00Z'), new Date('2026-08-02T11:00:00.400Z')), false);
    assert.equal(pageEditedSinceSubmission(submitted('2026-08-02T11:00:00Z'), new Date('2026-08-02T11:00:01Z')), false);
  });

  it('reports a real edit afterwards', () => {
    assert.equal(pageEditedSinceSubmission(submitted('2026-08-02T11:00:00Z'), new Date('2026-08-02T11:05:00Z')), true);
  });

  it('is null when it cannot tell — never a confident “untouched”', () => {
    assert.equal(pageEditedSinceSubmission(null, new Date()), null);
    assert.equal(pageEditedSinceSubmission(submitted('2026-08-02T11:00:00Z'), null), null);
    assert.equal(pageEditedSinceSubmission(readProvenance({ forkedAt: '2026-08-02T09:00:00Z' }), new Date()), null);
    assert.equal(pageEditedSinceSubmission(submitted('not a date'), new Date()), null);
  });
});
