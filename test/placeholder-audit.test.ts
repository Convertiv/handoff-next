import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  describeMissingImagery,
  findPlaceholderImages,
  findUnplacedImages,
  imageGapInstruction,
  unplacedImageInstruction,
} from '../src/app/lib/placeholder-audit';

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
  it('reads as a call to action, since filling happens after the page is applied', () => {
    const note = describeMissingImagery([{ block: 1, componentId: 'hero', field: 'image' }]);
    assert.match(note!, /Apply the page and ask me to fill them/);
  });

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

/**
 * The gap that let three generated images sit waiting forever: the old placement guard only fired when
 * a turn ended *without* a placement tool, so `propose_page` that omits the srcs slipped past it.
 */
describe('findUnplacedImages', () => {
  const queued = [
    { title: 'Students studying', placeholderSrc: 'https://placehold.co/1536x1024?text=Students' },
    { title: 'Campus quad', placeholderSrc: 'https://placehold.co/1536x1024?text=Quad' },
  ];

  it('flags an image whose src never made it into the blocks', () => {
    const blocks = [{ args: { titleSlot: 'Hello' } }];
    assert.equal(findUnplacedImages(blocks, queued).length, 2);
  });

  it('accepts one placed at any depth', () => {
    const blocks = [
      { args: { imageSlot: { src: queued[0]!.placeholderSrc, alt: 'x' } } },
      { args: { cards: [{ image: { src: queued[1]!.placeholderSrc } }] } },
    ];
    assert.deepEqual(findUnplacedImages(blocks, queued), []);
  });

  it('reports only the ones actually missing', () => {
    const blocks = [{ args: { imageSlot: { src: queued[0]!.placeholderSrc } } }];
    const unplaced = findUnplacedImages(blocks, queued);
    assert.equal(unplaced.length, 1);
    assert.equal(unplaced[0]!.title, 'Campus quad');
  });

  it('matches the whole src, not a prefix', () => {
    const blocks = [{ args: { src: `${queued[0]!.placeholderSrc}&extra=1` } }];
    assert.equal(findUnplacedImages(blocks, queued).length, 2);
  });

  it('ignores a queued entry with no placeholder — a failed enqueue', () => {
    assert.deepEqual(findUnplacedImages([{ args: {} }], [{ title: 'x', placeholderSrc: '' }]), []);
  });
});

describe('unplacedImageInstruction', () => {
  it('gives the exact srcs and forbids regenerating', () => {
    const msg = unplacedImageInstruction([{ title: 'Quad', placeholderSrc: 'https://placehold.co/a' }]);
    assert.match(msg, /https:\/\/placehold\.co\/a/);
    assert.match(msg, /Do NOT request them again/);
  });
});

/**
 * A generated image can land in an edit op as legitimately as in a proposed block.
 *
 * `unplacedImages` was computed against proposal blocks only, so every changeset that generated an
 * image was logged as stranding it however correctly it was placed — `strandedImages` in production
 * logs, on a working path. Found by the eval suite: after the placement fix one image case went green
 * while the other stayed red on the invariant alone, with its own placement check passing.
 */
describe('findUnplacedImages over edit ops', () => {
  const queued = [{ placeholderSrc: 'https://placehold.co/a' }, { placeholderSrc: 'https://placehold.co/b' }];

  it('counts an image written into an op’s values as placed', () => {
    const ops = [{ args: { desktopImageSlot: { src: 'https://placehold.co/a' } } }];
    assert.deepEqual(findUnplacedImages(ops, queued).map((q) => q.placeholderSrc), ['https://placehold.co/b']);
  });

  it('still catches one that reached nothing', () => {
    assert.equal(findUnplacedImages([{ args: {} }], queued).length, 2);
  });
});
