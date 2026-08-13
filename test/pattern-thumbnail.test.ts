import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  argsSlots,
  patternThumbnailFromBlocks,
  patternThumbnailSvg,
  patternThumbnailUrl,
} from '../src/app/lib/pattern-thumbnail';

const hero = { title: { editorType: 'text' }, body: { editorType: 'richtext' }, image: { editorType: 'image' } };
const cards = { title: { editorType: 'text' }, items: { editorType: 'array' } };
const copy = { title: { editorType: 'text' }, body: { editorType: 'richtext' } };
/** A block whose contract is all configuration — nothing that draws. */
const spacer = { size: { editorType: 'select' }, hidden: { editorType: 'boolean' } };

const bands = (svg: string) => (svg.match(/<rect/g) ?? []).length;

describe('patternThumbnailSvg', () => {
  it('always returns well-formed SVG', () => {
    for (const page of [[], [hero], [hero, copy, cards], [null, undefined]]) {
      const svg = patternThumbnailSvg(page);
      assert.match(svg, /^<svg[^>]+>/);
      assert.match(svg, /<\/svg>$/);
      // A NaN coordinate renders as an invisible shape, which is indistinguishable from a bug in the layout.
      assert.doesNotMatch(svg, /NaN|undefined|Infinity/);
    }
  });

  it('draws the same dashed placeholder as a component with no contract', () => {
    // "Nothing to show" should look like one state everywhere it happens, not like a different failure each time.
    assert.match(patternThumbnailSvg([]), /stroke-dasharray/);
  });

  it('gives a block with no drawable slots a band anyway', () => {
    // The *number* of sections is half of what makes a page recognisable, so a spacer must not vanish.
    assert.ok(bands(patternThumbnailSvg([copy, spacer, copy])) > bands(patternThumbnailSvg([copy, copy])));
  });

  it('draws the picture mark for an image block and a grid for a repeater', () => {
    assert.match(patternThumbnailSvg([hero]), /<circle/); // the picture mark
    assert.doesNotMatch(patternThumbnailSvg([copy]), /<circle/);
    // The background, a heading bar, then three columns.
    assert.equal(bands(patternThumbnailSvg([cards])), 5);
  });

  it('keeps a long page inside the frame and marks that it continues', () => {
    const long = patternThumbnailSvg(Array.from({ length: 20 }, () => copy));
    // Past about six bands every page looks like every other page; the remainder becomes one faded bar.
    assert.match(long, /opacity="0.45"/);
    for (const y of long.matchAll(/<rect[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"/g)) {
      assert.ok(Number(y[1]) + Number(y[2]) <= 180 + 0.5, `band overflows the frame: ${y[0]}`);
    }
  });

  it('an unresolved block still occupies space', () => {
    // A page that has lost a component should look like a page with a gap in it, not like a shorter page.
    assert.ok(bands(patternThumbnailSvg([copy, null, copy])) > bands(patternThumbnailSvg([copy, copy])));
  });
});

describe('patternThumbnailUrl', () => {
  it('is the swap boundary, and escapes the id', () => {
    assert.equal(patternThumbnailUrl('a b/c'), '/api/handoff/patterns/a%20b%2Fc/thumbnail.svg');
    assert.equal(patternThumbnailUrl('p1', '/base'), '/base/api/handoff/patterns/p1/thumbnail.svg');
  });
});

describe('drawn from the page’s own content', () => {
  /**
   * The route used to read each block's *contract*, which cost one component query per distinct block, per
   * card, per library render — the reason the library tab got slow. These assert the replacement reads the
   * same shapes out of the content the page already stores.
   */
  it('reads a hero as media, not as copy', () => {
    const slots = argsSlots({ title: 'A headline', body: 'Some copy', image: { src: 'https://x/y.jpg' } });
    assert.ok(slots.includes('image'));
    assert.equal(slots[slots.indexOf('image') + 1], 'heading');
  });

  it('reads a repeater as a grid', () => {
    // A numeric path segment is what a repeater looks like from here — `items.0.title`.
    assert.ok(argsSlots({ title: 'Cards', items: [{ title: 'One' }, { title: 'Two' }] }).includes('list'));
  });

  it('gives a config-only block no slots, so it still draws as a bar', () => {
    assert.deepEqual(argsSlots({ size: 'lg', theme: 'dark', columns: 3 }), []);
  });

  it('produces a real silhouette from stored blocks', () => {
    const svg = patternThumbnailFromBlocks([
      { id: 'hero', args: { title: 'Hi', image: { src: 'https://x/y.jpg' } } },
      { id: 'cards', args: { items: [{ title: 'a' }, { title: 'b' }] } },
      { id: 'spacer', args: { size: 'lg' } },
    ]);
    assert.match(svg, /^<svg/);
    assert.match(svg, /<circle/, 'the media band draws the picture mark');
    assert.doesNotMatch(svg, /stroke-dasharray/, 'this is not the empty placeholder');
  });

  it('still draws the placeholder for a page with no blocks', () => {
    assert.match(patternThumbnailFromBlocks([]), /stroke-dasharray/);
  });

  it('applies per-block overrides, so the picture matches what renders', () => {
    // An image supplied only by the override layer still makes the band media.
    const svg = patternThumbnailFromBlocks(
      [{ id: 'hero', args: { title: 'Hi' } }],
      [{ image: { src: 'https://x/from-override.jpg' } }]
    );
    assert.match(svg, /<circle/);
  });
});
