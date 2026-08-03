import assert from 'node:assert';
import { describe, it } from 'node:test';
import { applyOps, describeOp, describeOpVisually, parseEditEntries, type EditOp, type PageBlock, verifyOps } from '../src/app/lib/edit-operations';

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

/**
 * "For any sort of component swaps, can you preview at all or just have to accept to see changes?"
 *
 * The answer was accept-to-see: a fresh proposal renders a thumbnail per block, a changeset rendered one
 * line of text per op. The operation where seeing the result matters most had nothing to look at.
 */
describe('describeOpVisually', () => {
  it('gives a swap both components, so the pictures answer "is this right"', () => {
    const v = describeOpVisually({ op: 'replace', index: 2, expect: 'hero-split', componentId: 'content-split', values: {} });
    assert.deepEqual(v, { action: 'Swap', position: 3, before: 'hero-split', after: 'content-split' });
  });

  it('gives an update its field list and no incoming component', () => {
    // The block is the same block; a thumbnail would say nothing. What changed is the fields.
    const v = describeOpVisually({ op: 'update', index: 0, expect: 'hero-background', values: { titleSlot: 'x', bodySlot: 'y' } });
    assert.deepEqual(v.fields, ['titleSlot', 'bodySlot']);
    assert.equal(v.after, undefined);
    assert.equal(v.before, 'hero-background');
  });

  it('gives an insert only the arriving component', () => {
    const v = describeOpVisually({ op: 'insert', index: 4, componentId: 'stats', values: {} });
    assert.equal(v.after, 'stats');
    assert.equal(v.before, undefined);
    assert.equal(v.position, 5);
  });

  it('gives a remove only the departing one', () => {
    const v = describeOpVisually({ op: 'remove', index: 1, expect: 'faq' });
    assert.equal(v.before, 'faq');
    assert.equal(v.after, undefined);
  });

  it('reports 1-based positions, matching what the chat showed the user', () => {
    // Ops are zero-based on the wire; every number a person has seen is one-based. Mixing them is how
    // an edit lands on the wrong block.
    for (const index of [0, 1, 7]) {
      assert.equal(describeOpVisually({ op: 'remove', index, expect: 'x' }).position, index + 1);
    }
  });

  it('has an empty field list rather than undefined for an update that names none', () => {
    // Such an update is rejected upstream, but the card must not crash rendering one.
    assert.deepEqual(describeOpVisually({ op: 'update', index: 0, expect: 'x', values: {} }).fields, []);
  });
});

/**
 * `parsed.edits` was cast — `as Record<string, unknown>[]` — and then dereferenced. One `null` in that
 * array threw `Cannot read properties of null (reading 'op')` and killed the whole turn: no changeset, no
 * reply, a failed request. The eval suite caught it as a thrown run.
 */
describe('parseEditEntries', () => {
  it('drops a null without taking the turn down', () => {
    const { entries, discarded } = parseEditEntries([{ op: 'update' }, null, { op: 'remove' }]);
    assert.equal(entries.length, 2);
    assert.equal(discarded, 1);
  });

  it('reports how many were unreadable, so they are not silently gone', () => {
    assert.equal(parseEditEntries([null, undefined, 'update', 42, []]).discarded, 5);
  });

  it('keeps every well-formed entry untouched', () => {
    const ops = [{ op: 'update', index: 0 }, { op: 'insert', index: 2 }];
    assert.deepEqual(parseEditEntries(ops), { entries: ops, discarded: 0 });
  });

  it('rejects an array as an entry — it would dereference to undefined, not throw', () => {
    // The quieter half of the same bug: `[].op` is undefined, so an array entry becomes an op named "",
    // gets no branch, and disappears without a word.
    assert.deepEqual(parseEditEntries([[]]), { entries: [], discarded: 1 });
  });

  it('handles a non-array, which is what a malformed tool call sends', () => {
    for (const bad of [null, undefined, {}, 'edits', 7]) {
      assert.deepEqual(parseEditEntries(bad), { entries: [], discarded: 0 });
    }
  });
});
