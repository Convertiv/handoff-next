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
  const resolve = (block: unknown, field: unknown, fields = HERO) =>
    resolveImageTarget({ blocks, block, field, fields });

  it('resolves a valid block and field', () => {
    const t = resolve(1, 'desktopImageSlot');
    assert.ok(t.ok);
    assert.equal(t.componentId, 'hero-background');
    assert.equal(t.encoding, 'image-object');
  });

  it('rejects `src`, and says what the fields actually are', () => {
    // The exact failure. A model told only "no such field" guesses a second time.
    const t = resolve(1, 'src');
    assert.ok(!t.ok);
    assert.match(t.error, /no image field called `src`/);
    assert.match(t.error, /desktopImageSlot, mobileImageSlot/);
  });

  it('rejects a missing field the same way, rather than picking one', () => {
    // Choosing for the model would place the image somewhere it never asked for, which is a worse
    // failure than a rejection: it looks like it worked.
    const t = resolve(1, undefined);
    assert.ok(!t.ok);
    assert.match(t.error, /\(none given\)/);
  });

  it('rejects an out-of-range block and names the range', () => {
    for (const bad of [0, 3, -1, 'two', null, 1.5]) {
      const t = resolve(bad, 'desktopImageSlot');
      assert.ok(!t.ok, `${JSON.stringify(bad)} should not resolve`);
      assert.match(t.error, /must be one of 1–2/);
    }
  });

  it('says so when the block has no image field, instead of failing on the field name', () => {
    const t = resolve(1, 'desktopImageSlot', { titleSlot: { encoding: 'html-string' } } as typeof HERO);
    assert.ok(!t.ok);
    assert.match(t.error, /has no image field/);
  });

  it('refuses when the canvas is empty — there is nowhere for an image to land', () => {
    const t = resolveImageTarget({ blocks: [], block: 1, field: 'x', fields: HERO });
    assert.ok(!t.ok);
    assert.match(t.error, /no blocks on the canvas/);
  });

  it('tolerates a field name with stray whitespace', () => {
    assert.ok(resolve(1, ' desktopImageSlot ').ok);
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
      index: 2,
      field: 'desktopImageSlot',
      encoding: 'image-object',
    });
    assert.match(note, /propose_edits/);
    assert.match(note, /"index": 2|index: 2/);
    assert.match(note, /expect: "hero-background"/);
    assert.match(note, /desktopImageSlot/);
    assert.match(note, /does NOT place/);
  });
});
