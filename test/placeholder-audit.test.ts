import assert from 'node:assert';
import { describe, it } from 'node:test';
import { describeMissingImagery, findPlaceholderImages, imageGapInstruction } from '../src/app/lib/placeholder-audit';

const ph = (label: string) => `https://placehold.co/1536x1024?text=${label}`;

describe('findPlaceholderImages', () => {
  it('finds a placeholder in a plain image object', () => {
    const found = findPlaceholderImages([
      { componentId: 'hero-background', args: { desktopImageSlot: { src: ph('Hero'), alt: 'Hero' } } },
    ]);
    assert.deepEqual(found, [{ block: 1, componentId: 'hero-background', field: 'desktopImageSlot' }]);
  });

  it('numbers blocks the way the user sees them', () => {
    const found = findPlaceholderImages([
      { componentId: 'a', args: { title: 'Real copy' } },
      { componentId: 'b', args: { image: { src: ph('X') } } },
    ]);
    assert.equal(found[0]!.block, 2);
  });

  it('finds one nested inside an array of cards', () => {
    const found = findPlaceholderImages([
      { componentId: 'grid', args: { cards: [{ title: 'A' }, { image: { src: ph('C') } }] } },
    ]);
    assert.equal(found.length, 1);
    assert.equal(found[0]!.field, 'cards');
  });

  it('ignores a real asset src', () => {
    const found = findPlaceholderImages([
      { componentId: 'hero', args: { image: { src: '/api/handoff/assets/img_abc/raw', alt: 'A' } } },
    ]);
    assert.deepEqual(found, []);
  });

  it('survives empty and malformed args', () => {
    assert.deepEqual(findPlaceholderImages([]), []);
    assert.deepEqual(findPlaceholderImages([{ componentId: 'a', args: {} }]), []);
    assert.deepEqual(findPlaceholderImages([{ componentId: 'a', args: { n: 1, b: true, z: null } }]), []);
  });
});

/**
 * The point of this half: a model that reports imagery it did not add is worse than one that leaves a
 * visible gap. The note is deterministic and does not depend on the model's wording.
 */
describe('describeMissingImagery', () => {
  it('states the count and where, so the claim cannot stand unchallenged', () => {
    const note = describeMissingImagery([
      { block: 1, componentId: 'hero-background', field: 'desktopImageSlot' },
      { block: 4, componentId: 'image-gallery', field: 'images' },
    ]);
    assert.match(note!, /2 image slots still hold placeholders/);
    assert.match(note!, /block 1 \(hero-background\)/);
    assert.match(note!, /block 4 \(image-gallery\)/);
  });

  it('reads correctly for a single slot', () => {
    const note = describeMissingImagery([{ block: 2, componentId: 'hero', field: 'image' }]);
    assert.match(note!, /1 image slot still holds a placeholder/);
  });

  it('caps the list rather than printing twenty blocks', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ block: i + 1, componentId: `c${i}`, field: 'image' }));
    assert.match(describeMissingImagery(many)!, /and 3 more/);
  });

  it('is null when nothing is missing, so a clean page says nothing', () => {
    assert.equal(describeMissingImagery([]), null);
  });
});

describe('imageGapInstruction', () => {
  it('names the tools, because an image cannot be written like copy', () => {
    const msg = imageGapInstruction([{ block: 1, componentId: 'hero', field: 'imageSlot' }]);
    assert.match(msg, /search_assets/);
    assert.match(msg, /request_image/);
    assert.match(msg, /block 1 hero\.imageSlot/);
  });

  it('tells it to admit a gap rather than describe imagery it did not add', () => {
    assert.match(imageGapInstruction([{ block: 1, componentId: 'h', field: 'i' }]), /do not describe imagery you did not add/);
  });
});
