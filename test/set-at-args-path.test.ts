import assert from 'node:assert';
import { describe, it } from 'node:test';
import { fieldIdToArgsPath } from '../src/app/lib/field-marks';
import { setAtArgsPath } from '../src/app/lib/set-at-args-path';

/**
 * Writing an inline edit into a block's args — the second half of the F.2 join.
 *
 * The failure mode this guards is silent: land the value on the wrong shape (an object keyed `"1"` where the
 * template's `{{#each}}` wants an array) and the edit is accepted, saved, and renders nothing.
 */
describe('setAtArgsPath', () => {
  it('sets a top-level field', () => {
    assert.deepEqual(setAtArgsPath({ title: 'Old', theme: 'dark' }, ['title'], 'New'), {
      title: 'New',
      theme: 'dark',
    });
  });

  it('sets a nested object field', () => {
    assert.deepEqual(setAtArgsPath({ author: { name: 'Ada', role: 'Eng' } }, ['author', 'name'], 'Grace'), {
      author: { name: 'Grace', role: 'Eng' },
    });
  });

  it('sets one row of a repeater, leaving the others alone', () => {
    const data = { items: [{ paragraph: 'First' }, { paragraph: 'Second' }] };
    assert.deepEqual(setAtArgsPath(data, ['items', 1, 'paragraph'], 'Edited'), {
      items: [{ paragraph: 'First' }, { paragraph: 'Edited' }],
    });
  });

  it('does not mutate the input', () => {
    const data = { items: [{ paragraph: 'First' }] };
    setAtArgsPath(data, ['items', 0, 'paragraph'], 'Changed');
    assert.equal(data.items[0].paragraph, 'First');
  });

  /**
   * The whole reason this is its own function: a row index must create an array, not an object keyed `"1"`.
   *
   * Indexing past the end leaves a hole, which is fine and unreachable in practice — a mark only exists because
   * the row rendered, so the row is already in the data by the time anything can be committed to it.
   */
  it('creates an array when the next segment is an index', () => {
    const out = setAtArgsPath({}, ['items', 1, 'paragraph'], 'Late arrival') as { items: unknown[] };
    assert.ok(Array.isArray(out.items));
    assert.equal(out.items.length, 2);
    assert.deepEqual(out.items[1], { paragraph: 'Late arrival' });
  });

  it('creates an object when the next segment is a name', () => {
    assert.deepEqual(setAtArgsPath({}, ['author', 'name'], 'Ada'), { author: { name: 'Ada' } });
  });

  /** Descending into a string used to throw "Cannot create property 'name' on string". */
  it('replaces a non-object intermediate rather than descending into it', () => {
    assert.deepEqual(setAtArgsPath({ author: 'Ada' }, ['author', 'name'], 'Grace'), { author: { name: 'Grace' } });
  });

  /** An array where an object is wanted (and the reverse) is the same mistake in the other direction. */
  it('replaces an intermediate of the wrong kind', () => {
    assert.deepEqual(setAtArgsPath({ items: { '0': 'x' } }, ['items', 0, 'p'], 'v'), { items: [{ p: 'v' }] });
    assert.deepEqual(setAtArgsPath({ author: ['x'] }, ['author', 'name'], 'v'), { author: { name: 'v' } });
  });

  it('tolerates missing data and an empty path', () => {
    assert.deepEqual(setAtArgsPath(undefined, ['title'], 'A'), { title: 'A' });
    assert.deepEqual(setAtArgsPath(null, [], 'A'), {});
  });
});

/**
 * The two halves together, from the id the frame actually posts.
 *
 * Tested as a pair because each half can be right while the seam between them is wrong, and the seam is what
 * decides whether a committed edit reaches the value the template reads.
 */
describe('mark id → written value', () => {
  const apply = (data: Record<string, unknown>, id: string, value: string) =>
    setAtArgsPath(data, fieldIdToArgsPath(id), value);

  it('writes a plain field', () => {
    assert.deepEqual(apply({ title: 'Old' }, 'title', 'New'), { title: 'New' });
  });

  it('writes a repeater row from its marked id', () => {
    assert.deepEqual(apply({ items: [{ paragraph: 'a' }, { paragraph: 'b' }] }, 'items.paragraph:1', 'B'), {
      items: [{ paragraph: 'a' }, { paragraph: 'B' }],
    });
  });

  it('writes a dotted nested field', () => {
    assert.deepEqual(apply({ author: { linked_in: '/in/old' } }, 'author.linked_in', '/in/new'), {
      author: { linked_in: '/in/new' },
    });
  });
});
