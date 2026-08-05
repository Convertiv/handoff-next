import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  AUTHORING_SHAPES,
  authoringShapeFor,
  itemFieldsForEncoding,
  preferredEncoding,
  resolveItemFields,
} from '../src/app/lib/authoring-shapes';

/**
 * 39 array fields across 8x8's catalog already declared `of:` and nothing defined what the names meant.
 * This gives them a definition — and, more importantly, refuses to invent the ones that have no universal
 * answer. See `docs/AUTHORING-BRIDGE.md`.
 */
describe('the of: vocabulary', () => {
  it('gives `image` a shape, because every image value in this system is { src, alt }', () => {
    const shape = authoringShapeFor('image')!;
    assert.equal(shape.kind, 'image');
    assert.deepEqual(Object.keys(shape.itemFields!), ['src', 'alt']);
    // `image-url`: the value at `src` is the URL itself. An `image` editor writes an object *into* the
    // path it is given, which at `src` means `src.src` and `<img src="[object Object]">` downstream.
    assert.equal(shape.itemFields!.src!.editorType, 'image-url');
    assert.equal(shape.itemFields!.src!.encoding, undefined);
  });

  it('never describes an item field as taking a whole image object', () => {
    // The guard, stated once for the whole vocabulary rather than per term: an item field holds a scalar
    // or a declared sub-shape, and `image-object` is a *prop* encoding. Any item field claiming it is the
    // nesting bug waiting to happen again.
    for (const [term, shape] of Object.entries(AUTHORING_SHAPES)) {
      for (const [field, def] of Object.entries(shape.itemFields ?? {})) {
        assert.notEqual(def.encoding, 'image-object', `${term}.${field} must not take an image object`);
        assert.notEqual(def.editorType, 'image', `${term}.${field} must use image-url for a URL value`);
      }
    }
  });

  it('refuses to give `button` a shape, because the catalog measures two', () => {
    // `array-of-urltext` and `array-of-labelhref` both appear. Picking one would be wrong about half the
    // components that say `of: "button"`, which is the confident-wrong answer this codebase removes.
    const shape = authoringShapeFor('button')!;
    assert.equal(shape.itemFields, undefined);
    assert.match(String(shape.note), /url, text.*label, href/);
  });

  it('refuses to give the per-component terms a shape', () => {
    // `card` on card-rows is not `card` on media-kit.
    for (const term of ['card', 'slide', 'row', 'location', 'product', 'mediaKitCard', 'object']) {
      const shape = authoringShapeFor(term)!;
      assert.ok(shape, `${term} should be known`);
      assert.equal(shape.itemFields, undefined, `${term} must not carry an invented shape`);
    }
  });

  it('covers every term the catalog actually uses', () => {
    // Measured 2026-08-04 against 8x8: button ×23, object ×4, card ×4, product ×2, image ×2, slide, row,
    // location, mediaKitCard. A term with no entry falls through to no shape, which is safe — but an
    // unknown term is also a signal nobody defined it.
    for (const inUse of ['button', 'object', 'card', 'product', 'image', 'slide', 'row', 'location', 'mediaKitCard']) {
      assert.ok(AUTHORING_SHAPES[inUse], `${inUse} is used in the catalog and should be defined`);
    }
  });

  it('is null for a term it does not know, rather than guessing', () => {
    assert.equal(authoringShapeFor('sparkline'), null);
    assert.equal(authoringShapeFor(''), null);
    assert.equal(authoringShapeFor(undefined), null);
    assert.equal(authoringShapeFor(42), null);
  });
});

/**
 * Where `of:` earns its place, and it is not gap-filling.
 *
 * `logo-cloud-heading.logoSlots` measures **both** `array-of-image-object` and `array-of-labelhref` — both
 * genuinely render — so `accepts[0]` is decided by a specificity ranking that knows nothing about what the
 * field means. `of: "image"` is the intent.
 */
describe('preferredEncoding', () => {
  const logoSlots = ['array-of-image-object', 'array-of-labelhref'];

  it('picks the encoding matching the declared kind', () => {
    assert.equal(preferredEncoding(logoSlots, 'image'), 'array-of-image-object');
    assert.equal(preferredEncoding(logoSlots, 'button'), 'array-of-labelhref');
  });

  it('does not depend on specificity order once a kind is declared', () => {
    // The real case happens to agree with the ranking. The point is that it no longer has to.
    assert.equal(preferredEncoding([...logoSlots].reverse(), 'image'), 'array-of-image-object');
  });

  it('falls back to the ranking when the term says nothing useful', () => {
    assert.equal(preferredEncoding(logoSlots), 'array-of-image-object');
    assert.equal(preferredEncoding(logoSlots, 'card'), 'array-of-image-object');
    assert.equal(preferredEncoding(logoSlots, 'nonsense'), 'array-of-image-object');
  });

  it('cannot settle a tie it has no information about, and does not pretend to', () => {
    // Both are `link` kind and both specificity 44, so a field accepting both is still decided by order.
    // Measuring is not the same as disambiguating.
    const both = ['array-of-urltext', 'array-of-labelhref'];
    assert.equal(preferredEncoding(both, 'button'), 'array-of-urltext');
    assert.equal(preferredEncoding([...both].reverse(), 'button'), 'array-of-labelhref');
  });

  it('returns null for nothing accepted', () => {
    assert.equal(preferredEncoding([], 'image'), null);
  });
});

describe('resolveItemFields', () => {
  it('uses the vocabulary when there is no measurement', () => {
    const fields = resolveItemFields({ field: { of: 'image' }, encoding: null })!;
    assert.deepEqual(Object.keys(fields), ['src', 'alt']);
  });

  it('lets measurement win over the vocabulary', () => {
    // A declared `item:` describes what an author supplies; measurement describes what the component
    // accepts. Until projections are wired, a declared shape the props cannot take makes a form that
    // reports success and changes nothing.
    const fields = resolveItemFields({ field: { of: 'image' }, encoding: 'array-of-urltext' })!;
    assert.ok(fields.url, 'measured fields present');
    assert.ok(fields.src, 'vocabulary fields kept as a floor');
  });

  it('lets an explicit item: add fields the vocabulary does not have', () => {
    const fields = resolveItemFields({
      field: { of: 'image', item: { caption: { editorType: 'text' } } },
      encoding: 'array-of-image-object',
    })!;
    assert.deepEqual(Object.keys(fields).sort(), ['alt', 'caption', 'src']);
  });

  it('returns null when nothing says anything — no invention', () => {
    assert.equal(resolveItemFields({ field: { of: 'card' }, encoding: null }), null);
    assert.equal(resolveItemFields({ field: null, encoding: null }), null);
    assert.equal(resolveItemFields({}), null);
  });

  it('ignores a malformed item: declaration rather than throwing', () => {
    assert.equal(resolveItemFields({ field: { item: 'nonsense' }, encoding: null }), null);
    assert.equal(resolveItemFields({ field: { item: { bad: 'string' } }, encoding: null }), null);
  });
});

describe('itemFieldsForEncoding', () => {
  it('maps the container encodings that have item shapes', () => {
    assert.deepEqual(Object.keys(itemFieldsForEncoding('array-of-image-object')!), ['src', 'alt']);
    assert.deepEqual(Object.keys(itemFieldsForEncoding('array-of-urltext')!), ['url', 'text']);
    assert.deepEqual(Object.keys(itemFieldsForEncoding('array-of-labelhref')!), ['label', 'href']);
  });

  it('has none for bare-string items or an unmapped encoding', () => {
    assert.equal(itemFieldsForEncoding('array-of-text'), null);
    assert.equal(itemFieldsForEncoding('html-string'), null);
    assert.equal(itemFieldsForEncoding(null), null);
  });
});
