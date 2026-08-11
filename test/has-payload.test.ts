import assert from 'node:assert';
import { describe, it } from 'node:test';
import { hasDataPayload } from '../src/app/lib/data/has-payload';
import { patternListFromRow, mergePatternLists } from '../src/app/lib/data/pattern-merge';

/**
 * The predicate behind the worst MCP bug: every page composed through `handoff_create_page` read back as
 * `{ id }` with `blocks: 0` (found 2026-08-10 composing the ALPS archetype).
 *
 * The write was always correct. Six copies of `r.data && typeof r.data === 'object'` accepted an empty `{}` as
 * a payload and returned it *as* the record, shadowing the real columns.
 */
describe('hasDataPayload', () => {
  it('rejects the empty object that caused the bug', () => {
    assert.equal(hasDataPayload({ data: {} }), false);
  });

  it('accepts a real payload', () => {
    assert.equal(hasDataPayload({ data: { id: 'p', title: 'T' } }), true);
  });

  it('rejects absent, null and non-object data', () => {
    assert.equal(hasDataPayload({}), false);
    assert.equal(hasDataPayload({ data: null }), false);
    assert.equal(hasDataPayload({ data: 'nope' }), false);
    assert.equal(hasDataPayload(null), false);
    assert.equal(hasDataPayload(undefined), false);
  });

  /** An array is an object to `typeof`, and is never a page payload. */
  it('rejects an array', () => {
    assert.equal(hasDataPayload({ data: [] }), false);
    assert.equal(hasDataPayload({ data: [{ id: 'x' }] }), false);
  });
});

describe('patternListFromRow — an MCP-written row', () => {
  /** `components` set, `data` empty: exactly what `handoff_create_page` stores. */
  const mcpRow = {
    id: 'alps-parity',
    title: 'ALPS parity',
    description: 'd',
    group: 'g',
    data: {},
    components: [{ id: 'blog_header', args: {} }, { id: 'blog_body', args: {} }],
  };

  it('reads the blocks from the row instead of returning nothing', () => {
    const entry = patternListFromRow(mcpRow as never);
    assert.equal(entry.id, 'alps-parity');
    assert.equal(entry.title, 'ALPS parity');
    // The count `handoff_list_pages` reports — 0 before the fix.
    assert.equal(entry.components?.length, 2);
  });

  it('still prefers a real payload when there is one', () => {
    const entry = patternListFromRow({
      ...mcpRow,
      data: { id: 'alps-parity', title: 'From payload', components: [{ id: 'only-one', args: {} }] },
    } as never);
    assert.equal(entry.title, 'From payload');
    assert.equal(entry.components?.length, 1);
  });

  it('surfaces an MCP-written row through the list merge', () => {
    const merged = mergePatternLists([], [mcpRow as never]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].components?.length, 2);
  });
});
