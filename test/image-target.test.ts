import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  describeImagePlacement,
  imageFieldsFor,
  resolveImageTarget,
  valueForImageTarget,
} from '../src/app/lib/image-target';

/**
 * The bug these exist for: `request_image` returned a bare `{ src, alt }` and a note saying "write it
 * into the block". The model guessed `src` on a `hero-background`, the edit was rejected for naming no
 * field the component has, and the image it had already paid for reached nothing — 4 of 4 runs across
 * two eval cases.
 *
 * The fix is that a wrong target is caught by code rather than hoped away, so these tests are the fix.
 */

const HERO = {
  theme: { editorType: 'select' },
  titleSlot: { editorType: 'richtext', encoding: 'html-string' },
  desktopImageSlot: { editorType: 'image', encoding: 'image-object' },
  mobileImageSlot: { editorType: 'image', encoding: 'image-object' },
};

describe('imageFieldsFor', () => {
  it('finds the measured image slots and nothing else', () => {
    assert.deepEqual(imageFieldsFor(HERO), ['desktopImageSlot', 'mobileImageSlot']);
  });

  it('includes an array-of-image container — image-gallery.images is exactly this', () => {
    assert.deepEqual(imageFieldsFor({ images: { editorType: 'list', encoding: 'array-of-image-object' } }), ['images']);
  });

  it('trusts the measured encoding over the declared editor type', () => {
    // `shapeNote` asserted `{ src, alt }` for anything whose name matched /image/, which is what made
    // this class of bug possible. A field named for an image that measured as text is not one.
    assert.deepEqual(imageFieldsFor({ imageCaption: { editorType: 'image', encoding: 'plain-text' } }), []);
  });

  it('falls back to the declared type where nothing was measured', () => {
    // A workspace built before probing has no encodings, and must keep working.
    assert.deepEqual(imageFieldsFor({ heroImage: { editorType: 'image' } }), ['heroImage']);
  });

  it('excludes a slot the probe resolved to nothing', () => {
    // Offering it produces an edit that reports success and changes nothing.
    assert.deepEqual(imageFieldsFor({ g2Slot: { editorType: 'image', editable: false } }), []);
  });

  it('copes with a component that has no fields at all', () => {
    assert.deepEqual(imageFieldsFor(undefined), []);
    assert.deepEqual(imageFieldsFor({}), []);
  });
});

describe('resolveImageTarget', () => {
  const blocks = [{ componentId: 'hero-background' }, { componentId: 'image-gallery' }];
  const resolve = (index: unknown, field: unknown, fields = HERO) =>
    resolveImageTarget({ blocks, index, field, fields });

  it('is zero-based, like propose_edits', () => {
    // One-based for a day, and it cost six wasted generation attempts per turn: a model using both tools
    // in one turn sent `0` for the first block — right for propose_edits, refused here — then `1`, which
    // resolved to the first block and was refused on the field name. Nine calls to queue three images.
    const first = resolve(0, 'desktopImageSlot');
    assert.ok(first.ok);
    assert.equal(first.componentId, 'hero-background');
    assert.equal(first.index, 0, 'index stays zero-based for the edit call');
    assert.equal(first.position, 1, 'position is one-based for anything anyone reads');
    assert.equal(first.encoding, 'image-object');

    const second = resolveImageTarget({ blocks, index: 1, field: 'images', fields: { images: { encoding: 'array-of-image-object' } } });
    assert.ok(second.ok);
    assert.equal(second.componentId, 'image-gallery');
  });

  it('rejects `src`, and says what the fields actually are', () => {
    // The exact failure. A model told only "no such field" guesses a second time.
    const t = resolve(0, 'src');
    assert.ok(!t.ok);
    assert.match(t.error, /no image field called `src`/);
    assert.match(t.error, /desktopImageSlot, mobileImageSlot/);
  });

  it('rejects a missing field the same way, rather than picking one', () => {
    // Choosing for the model would place the image somewhere it never asked for, which is a worse
    // failure than a rejection: it looks like it worked.
    const t = resolve(0, undefined);
    assert.ok(!t.ok);
    assert.match(t.error, /\(none given\)/);
  });

  it('rejects an out-of-range index and names the range in the same convention', () => {
    // `null`, `''` and `false` matter more than they look: all three are `Number()`-coercible to 0,
    // which is a *valid* index now, so a missing one would have silently targeted block 1.
    for (const bad of [2, 5, -1, 'two', null, undefined, '', false, 1.5, NaN]) {
      const t = resolve(bad, 'desktopImageSlot');
      assert.ok(!t.ok, `${JSON.stringify(bad)} should not resolve`);
      assert.match(t.error, /must be 0–1 \(zero-based, the same as propose_edits\)/);
    }
  });

  it('says so when the block has no image field, instead of failing on the field name', () => {
    const t = resolve(0, 'desktopImageSlot', { titleSlot: { encoding: 'html-string' } } as typeof HERO);
    assert.ok(!t.ok);
    assert.match(t.error, /has no image field/);
  });

  it('refuses when the canvas is empty — there is nowhere for an image to land', () => {
    const t = resolveImageTarget({ blocks: [], index: 0, field: 'x', fields: HERO });
    assert.ok(!t.ok);
    assert.match(t.error, /no blocks on the canvas/);
  });

  it('tolerates a field name with stray whitespace', () => {
    assert.ok(resolve(0, ' desktopImageSlot ').ok);
  });

  it('accepts a numeric string, which is how a model sometimes sends it', () => {
    assert.ok(resolve('1', 'images', { images: { encoding: 'array-of-image-object' } } as unknown as typeof HERO).ok);
  });
});

describe('valueForImageTarget', () => {
  const image = { src: 'https://placehold.co/1536x1024', alt: 'A' };

  it('writes an object for a single image slot', () => {
    assert.deepEqual(valueForImageTarget('image-object', image), image);
  });

  it('writes a one-item array for a container — an object there is a silent no-op', () => {
    assert.deepEqual(valueForImageTarget('array-of-image-object', image), [image]);
  });

  it('falls back to the object shape when nothing was measured', () => {
    assert.deepEqual(valueForImageTarget(null, image), image);
  });

  it('copies rather than aliasing, so two queued images cannot share one object', () => {
    const a = valueForImageTarget('image-object', image) as Record<string, unknown>;
    a.src = 'changed';
    assert.equal(image.src, 'https://placehold.co/1536x1024');
  });
});

describe('describeImagePlacement', () => {
  it('spells out the whole edit, since "use this src" produced an invented field name', () => {
    const note = describeImagePlacement({
      componentId: 'hero-background',
      index: 1,
      position: 2,
      field: 'desktopImageSlot',
      encoding: 'image-object',
    });
    assert.match(note, /propose_edits/);
    // Prose reads the one-based position; the call carries the zero-based index. Conflating them is how
    // an edit lands on the wrong block.
    assert.match(note, /block 2 \(hero-background\)/);
    assert.match(note, /index: 1/);
    assert.match(note, /expect: "hero-background"/);
    assert.match(note, /desktopImageSlot/);
    assert.match(note, /does NOT place/);
  });
});
