import assert from 'node:assert';
import { describe, it } from 'node:test';
import { packToBudget, purposeLine, truncationNote } from '../src/app/lib/tool-payload';

/**
 * `list_blocks` returned 32,270 characters against a 24,000 cap applied as
 * `JSON.stringify(result).slice(0, 24_000)`. Two silent consequences: 16 of 77 components never reached
 * the model — everything alphabetically after `simple-copy` — and the result was invalid JSON.
 *
 * That is the whole of "the component matchup is a little off". A ten-section brief came back as six
 * consecutive `simple-copy` blocks, because `simple-copy` survives the cut and the alternatives did not.
 */
describe('packToBudget', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `block-${i}`, title: `Block ${i}` }));

  it('keeps whole entries and reports how many went', () => {
    const packed = packToBudget(rows, 200);
    assert.ok(packed.items.length > 0 && packed.items.length < rows.length);
    assert.equal(packed.dropped, rows.length - packed.items.length);
  });

  it('always serializes to valid JSON, which slicing did not', () => {
    for (const budget of [0, 1, 40, 137, 500, 100_000]) {
      const packed = packToBudget(rows, budget);
      assert.doesNotThrow(() => JSON.parse(JSON.stringify(packed.items)), `budget ${budget}`);
    }
  });

  it('stays inside the budget it was given', () => {
    for (const budget of [50, 200, 1000]) {
      const packed = packToBudget(rows, budget);
      assert.ok(JSON.stringify(packed.items).length <= budget, `budget ${budget}`);
    }
  });

  it('keeps everything when it fits, and drops nothing', () => {
    const packed = packToBudget(rows, 100_000);
    assert.equal(packed.items.length, rows.length);
    assert.equal(packed.dropped, 0);
  });

  it('drops everything rather than emitting a fragment when nothing fits', () => {
    const packed = packToBudget(rows, 3);
    assert.deepEqual(packed.items, []);
    assert.equal(packed.dropped, rows.length);
  });

  it('handles an empty list', () => {
    assert.deepEqual(packToBudget([], 100), { items: [], dropped: 0 });
  });
});

describe('truncationNote', () => {
  it('names the counts, so a partial list is not mistaken for the whole catalog', () => {
    const note = truncationNote(16, 77, 'Call list_blocks again with a `group`.')!;
    assert.match(note, /16 of 77/);
    assert.match(note, /Do not assume the list is complete/);
  });

  it('says nothing when nothing was dropped', () => {
    assert.equal(truncationNote(0, 77, 'hint'), null);
    assert.equal(truncationNote(-1, 77, 'hint'), null);
  });
});

describe('purposeLine', () => {
  it('takes the first sentence of an authored description', () => {
    assert.equal(
      purposeLine('Display key statistics in a grid of columns. Supports two to six items.'),
      'Display key statistics in a grid of columns.'
    );
  });

  it('strips markdown the registry descriptions carry', () => {
    assert.equal(purposeLine('**Button alignment:** `left` by default.'), 'Button alignment: left by default.');
  });

  it('is the line that would have prevented the bug', () => {
    // `simple-copy`'s own authored guidance says what it is for, and none of it was being sent.
    const line = purposeLine('A component for simple rich-text copy blocks with optional CTA buttons.');
    assert.match(line, /simple rich-text copy blocks/);
  });

  it('does not cut at an abbreviation, wherever it appears', () => {
    // A plain /\.\s/ split cut `card-rows` at "…in a scannable row format (e.g." — and the example after
    // it is often the part worth reading.
    assert.match(purposeLine('e.g. a hero band with copy over an image, used at the top of a page.'), /hero band/);
    const cardRows = purposeLine('Use for listing content items in a scannable row format (e.g. resources, articles).');
    assert.match(cardRows, /resources, articles/);
    assert.match(purposeLine('Use for stats, i.e. numbers worth showing off, in a row.'), /numbers worth showing off/);
  });

  it('still stops at a genuine sentence end', () => {
    assert.equal(
      purposeLine('Display key statistics in a grid of columns. Supports two to six items.'),
      'Display key statistics in a grid of columns.'
    );
  });

  it('truncates a long single sentence with an ellipsis', () => {
    const line = purposeLine(`${'word '.repeat(60)}end.`, 60);
    assert.ok(line.length <= 60);
    assert.ok(line.endsWith('…'));
  });

  it('returns empty for a component with no description, rather than a stray ellipsis', () => {
    for (const value of [undefined, null, '', '   ']) assert.equal(purposeLine(value), '');
  });
});
