import assert from 'node:assert';
import { describe, it } from 'node:test';
import { containsImageSrc, swapImageSrc } from '../src/app/lib/swap-image-src';

const PLACEHOLDER = 'https://placehold.co/1536x1024?text=Hero%20image';
const REAL = '/api/handoff/assets/img_abc123def456/raw';

/**
 * Runs a minute or two after the page was applied, against args the user may have edited in the
 * meantime. Matching by value rather than by remembered path is what makes that safe.
 */
describe('swapImageSrc', () => {
  it('swaps a top-level src', () => {
    const { value, changed } = swapImageSrc({ src: PLACEHOLDER, alt: 'Hero' }, PLACEHOLDER, REAL);
    assert.ok(changed);
    assert.deepEqual(value, { src: REAL, alt: 'Hero' });
  });

  it('swaps inside a nested image object', () => {
    const { value, changed } = swapImageSrc(
      { imageSlot: { src: PLACEHOLDER, alt: 'Hero', width: 1536 } },
      PLACEHOLDER,
      REAL
    );
    assert.ok(changed);
    assert.deepEqual(value, { imageSlot: { src: REAL, alt: 'Hero', width: 1536 } });
  });

  it('swaps inside an array item, which is where card imagery lives', () => {
    const { value, changed } = swapImageSrc(
      { cards: [{ title: 'A', image: { src: 'other' } }, { title: 'B', image: { src: PLACEHOLDER } }] },
      PLACEHOLDER,
      REAL
    );
    assert.ok(changed);
    assert.deepEqual(value, {
      cards: [{ title: 'A', image: { src: 'other' } }, { title: 'B', image: { src: REAL } }],
    });
  });

  it('swaps every occurrence, since one image can fill several slots', () => {
    const { value } = swapImageSrc({ a: PLACEHOLDER, b: { c: [PLACEHOLDER] } }, PLACEHOLDER, REAL);
    assert.deepEqual(value, { a: REAL, b: { c: [REAL] } });
  });

  it('reaches into a serialized React element tree, where preview values actually live', () => {
    const el = { key: null, type: 'img', props: { src: PLACEHOLDER, alt: 'x' }, _owner: null, _store: {} };
    const { value, changed } = swapImageSrc({ buttonSlot: el }, PLACEHOLDER, REAL);
    assert.ok(changed);
    assert.equal((value.buttonSlot as typeof el).props.src, REAL);
  });

  it('reports no change and keeps identity when the placeholder is gone', () => {
    // The user deleted the block or set their own image while generation ran. Skipping the re-render
    // matters as much as not corrupting anything.
    const args = { src: 'https://example.com/mine.jpg' };
    const { value, changed } = swapImageSrc(args, PLACEHOLDER, REAL);
    assert.equal(changed, false);
    assert.equal(value, args);
  });

  it('leaves every other string alone, including near-misses', () => {
    const args = { src: `${PLACEHOLDER}&extra=1`, title: 'Hero image', note: PLACEHOLDER.slice(0, -1) };
    const { changed } = swapImageSrc(args, PLACEHOLDER, REAL);
    assert.equal(changed, false);
  });

  it('is a no-op for an empty or identical src rather than corrupting every empty string', () => {
    const args = { src: '', alt: '' };
    assert.equal(swapImageSrc(args, '', REAL).changed, false);
    assert.equal(swapImageSrc(args, '', REAL).value, args);
    assert.equal(swapImageSrc({ src: REAL }, REAL, REAL).changed, false);
  });

  it('survives nulls, numbers and booleans in the args', () => {
    const args = { src: PLACEHOLDER, n: 3, b: true, z: null, u: undefined };
    const { value } = swapImageSrc(args, PLACEHOLDER, REAL);
    assert.deepEqual(value, { src: REAL, n: 3, b: true, z: null, u: undefined });
  });

  it('does not mutate the input', () => {
    const args = { image: { src: PLACEHOLDER } };
    swapImageSrc(args, PLACEHOLDER, REAL);
    assert.equal(args.image.src, PLACEHOLDER);
  });
});

describe('containsImageSrc', () => {
  it('finds the placeholder at any depth', () => {
    assert.ok(containsImageSrc({ a: { b: [{ src: PLACEHOLDER }] } }, PLACEHOLDER));
    assert.ok(!containsImageSrc({ a: { b: [{ src: 'other' }] } }, PLACEHOLDER));
  });

  it('is false for an empty needle, so a missing placeholder never matches everything', () => {
    assert.equal(containsImageSrc({ src: '' }, ''), false);
  });
});
