import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  buildProvenance,
  patternKind,
  readProvenance,
  templateHasMovedOn,
} from '../src/app/lib/page-provenance';

describe('patternKind', () => {
  it('reads the three kinds and defaults everything else to page', () => {
    assert.equal(patternKind('template'), 'template');
    assert.equal(patternKind('brief'), 'brief');
    // Rows written before the column existed, and anything unrecognised: a library that refuses to render is
    // a worse answer than a page in the wrong lane.
    for (const junk of [undefined, null, '', 'design', 42]) assert.equal(patternKind(junk), 'page');
  });
});

describe('readProvenance', () => {
  it('returns null for a page that was simply authored', () => {
    for (const v of [null, undefined, '', 42, [], {}]) assert.equal(readProvenance(v), null);
  });

  it('keeps what is there and drops what is not a string', () => {
    const p = readProvenance({ templateId: 'tpl_1', forkedAt: '2026-08-01T00:00:00Z', templateUpdatedAt: 7 });
    assert.equal(p?.templateId, 'tpl_1');
    assert.equal(p?.forkedAt, '2026-08-01T00:00:00Z');
    assert.equal(p?.templateUpdatedAt, undefined);
  });

  it('marks a reconstructed record as legacy, and only when it says so', () => {
    // The difference between "what they were handed" and "our best reconstruction of it" is a reviewer's to
    // know, so it must survive the read.
    assert.equal(readProvenance({ templateId: 't', legacy: true })?.legacy, true);
    assert.equal(readProvenance({ templateId: 't', legacy: 'yes' })?.legacy, undefined);
  });

  it('carries the fork-time blocks through', () => {
    const blocks = [{ id: 'hero' }, { id: 'cta' }];
    assert.deepEqual(readProvenance({ blocks })?.blocks, blocks);
    assert.equal(readProvenance({ blocks: 'nope' })?.blocks, undefined);
  });
});

describe('templateHasMovedOn', () => {
  const at = (iso: string) => readProvenance({ templateUpdatedAt: iso });

  it('is null when either side is unknown — three states, not two', () => {
    // "We cannot tell" must never render as "no changes".
    assert.equal(templateHasMovedOn(null, new Date()), null);
    assert.equal(templateHasMovedOn(at('2026-08-01T00:00:00Z'), null), null);
    assert.equal(templateHasMovedOn(readProvenance({ templateId: 't' }), new Date()), null);
    assert.equal(templateHasMovedOn(at('not a date'), new Date()), null);
  });

  it('reports an edit after the fork', () => {
    assert.equal(templateHasMovedOn(at('2026-08-01T00:00:00Z'), new Date('2026-08-02T00:00:00Z')), true);
    assert.equal(templateHasMovedOn(at('2026-08-01T00:00:00Z'), new Date('2026-07-31T00:00:00Z')), false);
  });

  it('ignores sub-second differences', () => {
    // The migration stores whole seconds. Without this, every reconstructed page reports "moved on" from the
    // moment it is read.
    assert.equal(templateHasMovedOn(at('2026-08-01T00:00:00Z'), new Date('2026-08-01T00:00:00.750Z')), false);
  });
});

describe('buildProvenance', () => {
  const template = {
    id: 'tpl_1',
    updatedAt: new Date('2026-08-01T10:00:00Z'),
    components: [{ id: 'hero' }],
  };

  it('records the template, the copy, and the moment', () => {
    const p = buildProvenance({
      template,
      forkedAt: new Date('2026-08-02T09:00:00Z'),
      submittedAt: new Date('2026-08-02T09:30:00Z'),
      submittedByEmail: '  someone@example.com ',
      shareLinkToken: 'tok_1',
    });
    assert.equal(p.templateId, 'tpl_1');
    assert.equal(p.templateUpdatedAt, '2026-08-01T10:00:00.000Z');
    assert.equal(p.forkedAt, '2026-08-02T09:00:00.000Z');
    assert.equal(p.submittedAt, '2026-08-02T09:30:00.000Z');
    assert.equal(p.submittedByEmail, 'someone@example.com');
    assert.deepEqual(p.blocks, [{ id: 'hero' }]);
    // Written at submit, so it is the real thing rather than a reconstruction.
    assert.equal(p.legacy, undefined);
  });

  it('omits what it does not have instead of inventing it', () => {
    const p = buildProvenance({ template: { id: 'tpl_1' }, submittedByEmail: '   ' });
    assert.equal(p.templateUpdatedAt, undefined);
    assert.equal(p.forkedAt, undefined);
    assert.equal(p.submittedByEmail, undefined);
    assert.equal(p.blocks, undefined);
    // Not even `submittedAt`: a fork record must not claim a submission that has not happened. Only
    // `completeProvenance` sets it — see the note there about the record being written in two moments.
    assert.equal(p.submittedAt, undefined);
  });

  it('round-trips through storage', () => {
    const p = buildProvenance({ template, forkedAt: new Date('2026-08-02T09:00:00Z') });
    assert.deepEqual(readProvenance(JSON.parse(JSON.stringify(p))), p);
  });
});
