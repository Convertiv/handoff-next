import assert from 'node:assert';
import { describe, it } from 'node:test';
import { mergePatternLists, patternListFromRow } from '../src/app/lib/data/pattern-merge';

/**
 * A single malformed pattern row made `handoff_list_pages` throw
 * `Cannot read properties of undefined (reading 'localeCompare')` — so one bad page rendered every
 * page unlistable, over MCP and in the UI alike.
 */
const row = (over: Record<string, unknown> = {}) =>
  ({ id: 'p1', path: null, title: 'Page One', description: '', group: '', tags: [], components: [], data: null, ...over }) as never;

describe('patternListFromRow', () => {
  it('backfills id and title when the data blob omits them', () => {
    const out = patternListFromRow(row({ data: { components: [] } }));
    assert.equal(out.id, 'p1');
    assert.equal(out.title, 'Page One');
  });

  it('falls back to the id when the row has no title either', () => {
    const out = patternListFromRow(row({ title: null, data: { components: [] } }));
    assert.equal(out.title, 'p1');
  });

  it('does not clobber values the blob does provide', () => {
    const out = patternListFromRow(row({ data: { id: 'from-blob', title: 'From Blob', components: [] } }));
    assert.equal(out.id, 'from-blob');
    assert.equal(out.title, 'From Blob');
  });
});

describe('mergePatternLists', () => {
  it('survives a row whose data blob has neither id nor title', () => {
    // The exact shape that took down the live list.
    assert.doesNotThrow(() => mergePatternLists([], [row({ data: { components: [] } })]));
  });

  it('still sorts by display name', () => {
    const merged = mergePatternLists([], [
      row({ id: 'b', title: 'Zebra', data: null }),
      row({ id: 'a', title: 'Apple', data: null }),
    ]);
    assert.deepEqual(merged.map((p) => p.title), ['Apple', 'Zebra']);
  });

  it('keeps every row rather than dropping the odd one', () => {
    const merged = mergePatternLists([], [row({ id: 'a', data: { components: [] } }), row({ id: 'b', title: 'B', data: null })]);
    assert.equal(merged.length, 2);
  });
});
