import assert from 'node:assert';
import { describe, it } from 'node:test';
import { applyOps, describeOp, verifyOps, type EditOp, type PageBlock } from '../src/app/lib/edit-operations';

const page = (): PageBlock[] => [
  { componentId: 'header', args: {} },
  { componentId: 'hero-split', args: { titleSlot: 'Old headline', bodySlot: 'Body' } },
  { componentId: 'stats', args: { title: 'Numbers' } },
  { componentId: 'faq', args: { title: 'FAQ' } },
  { componentId: 'footer', args: {} },
];

describe('verifyOps', () => {
  it('accepts an operation whose expectation matches', () => {
    const { valid, rejected } = verifyOps(
      [{ op: 'update', index: 1, expect: 'hero-split', values: { titleSlot: 'New' } }],
      page()
    );
    assert.equal(valid.length, 1);
    assert.deepEqual(rejected, []);
  });

  it('rejects an operation aimed at the wrong block rather than editing it', () => {
    // The whole reason `expect` exists: indices drift when someone drags a block, and silently
    // editing the wrong one is far worse than refusing.
    const { valid, rejected } = verifyOps(
      [{ op: 'update', index: 3, expect: 'stats', values: { title: 'X' } }],
      page()
    );
    assert.equal(valid.length, 0);
    assert.match(rejected[0].reason, /block 4 is faq, not stats/);
  });

  it('rejects an index past the end of the page', () => {
    const { rejected } = verifyOps([{ op: 'remove', index: 9, expect: 'faq' }], page());
    assert.match(rejected[0].reason, /no block 10/);
  });

  it('allows inserting at the end, which is appending', () => {
    const { valid } = verifyOps([{ op: 'insert', index: 5, componentId: 'callout-cta', values: {} }], page());
    assert.equal(valid.length, 1);
  });

  it('rejects inserting beyond the end', () => {
    const { rejected } = verifyOps([{ op: 'insert', index: 12, componentId: 'x', values: {} }], page());
    assert.match(rejected[0].reason, /cannot insert/);
  });

  it('accepts the good operations and drops only the bad one', () => {
    // One stale index must not throw away four good edits.
    const ops: EditOp[] = [
      { op: 'update', index: 1, expect: 'hero-split', values: { titleSlot: 'A' } },
      { op: 'update', index: 2, expect: 'WRONG', values: { title: 'B' } },
      { op: 'remove', index: 3, expect: 'faq' },
    ];
    const { valid, rejected } = verifyOps(ops, page());
    assert.equal(valid.length, 2);
    assert.equal(rejected.length, 1);
  });

  it('rejects a nonsense index without throwing', () => {
    const { rejected } = verifyOps([{ op: 'remove', index: -1, expect: 'x' }], page());
    assert.match(rejected[0].reason, /not a position/);
  });
});

describe('applyOps', () => {
  it('merges an update over existing args rather than replacing them', () => {
    // This is what makes update cheaper than replace: only the changed field travels.
    const out = applyOps(page(), [{ op: 'update', index: 1, expect: 'hero-split', values: { titleSlot: 'New' } }]);
    assert.equal(out[1].args.titleSlot, 'New');
    assert.equal(out[1].args.bodySlot, 'Body', 'untouched fields survive');
  });

  it('replaces a block wholesale, component and all', () => {
    const out = applyOps(page(), [
      { op: 'replace', index: 1, expect: 'hero-split', componentId: 'hero-background', values: { titleSlot: 'X' } },
    ]);
    assert.equal(out[1].componentId, 'hero-background');
    assert.equal(out[1].args.bodySlot, undefined, 'the old block args do not linger');
  });

  it('inserts at a position', () => {
    const out = applyOps(page(), [{ op: 'insert', index: 3, componentId: 'pricing', values: {} }]);
    assert.deepEqual(out.map((b) => b.componentId), ['header', 'hero-split', 'stats', 'pricing', 'faq', 'footer']);
  });

  it('removes a block', () => {
    const out = applyOps(page(), [{ op: 'remove', index: 3, expect: 'faq' }]);
    assert.deepEqual(out.map((b) => b.componentId), ['header', 'hero-split', 'stats', 'footer']);
  });

  it('applies in descending order so an insert cannot shift a later operation', () => {
    // Applied in written order, the remove at 3 would hit the wrong block after the insert at 1.
    const out = applyOps(page(), [
      { op: 'insert', index: 1, componentId: 'banner', values: {} },
      { op: 'remove', index: 3, expect: 'faq' },
    ]);
    assert.deepEqual(out.map((b) => b.componentId), ['header', 'banner', 'hero-split', 'stats', 'footer']);
  });

  it('handles several removes without the indices sliding', () => {
    const out = applyOps(page(), [
      { op: 'remove', index: 1, expect: 'hero-split' },
      { op: 'remove', index: 3, expect: 'faq' },
    ]);
    assert.deepEqual(out.map((b) => b.componentId), ['header', 'stats', 'footer']);
  });

  it('never mutates the input, so undo has something to restore', () => {
    const before = page();
    applyOps(before, [{ op: 'update', index: 1, expect: 'hero-split', values: { titleSlot: 'Changed' } }]);
    assert.equal(before[1].args.titleSlot, 'Old headline');
  });
});

describe('describeOp', () => {
  it('names the fields an update touches', () => {
    assert.match(
      describeOp({ op: 'update', index: 1, expect: 'hero-split', values: { titleSlot: 'x', bodySlot: 'y' } }),
      /Update block 2 \(hero-split\) — titleSlot, bodySlot/
    );
  });

  it('shows both sides of a replace', () => {
    assert.match(
      describeOp({ op: 'replace', index: 1, expect: 'a', componentId: 'b', values: {} }),
      /Replace block 2: a → b/
    );
  });

  it('counts positions from one, since block 0 means nothing to a person', () => {
    assert.match(describeOp({ op: 'remove', index: 0, expect: 'header' }), /Remove block 1/);
  });
});
