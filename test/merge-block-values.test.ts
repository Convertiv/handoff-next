import assert from 'node:assert';
import { describe, it } from 'node:test';
import { blankContentValues, extractImageSrc, humanizeFieldName, mergeBlockValues, summarizeFields } from '../src/app/lib/merge-block-values';

/**
 * The template owns the shape; the model owns the content. These rules are what make it impossible for
 * a block to apply cleanly and render empty.
 */
describe('mergeBlockValues', () => {
  it('overlays authored content onto the template', () => {
    const { args } = mergeBlockValues({ headline: 'Text', body: '<p>Placeholder</p>' }, { headline: 'One platform.' });
    assert.equal(args.headline, 'One platform.');
  });

  it('keeps preview-seeded values for fields the model never mentions', () => {
    // The whole point of seeding from a real preview: an unmentioned field still renders.
    const { args } = mergeBlockValues({ headline: 'Text', eyebrow: 'Real eyebrow' }, { headline: 'New' });
    assert.equal(args.eyebrow, 'Real eyebrow');
  });

  it('merges into an object shape rather than replacing it', () => {
    const { args } = mergeBlockValues(
      { cta: { label: 'Button', href: '#', variant: 'primary' } },
      { cta: { label: 'Book a demo' } }
    );
    assert.deepEqual(args.cta, { label: 'Book a demo', href: '#', variant: 'primary' });
  });

  it('promotes a bare string into the obvious key of an object field', () => {
    // The model is told to send objects but sometimes sends a string. Dropping it loses authored copy.
    const { args } = mergeBlockValues({ cta: { label: 'Button', href: '#' } }, { cta: 'See it live' });
    assert.deepEqual(args.cta, { label: 'See it live', href: '#' });
  });

  it('maps an image string onto src, not onto a label', () => {
    // Passing the src as known: this is about shape coercion. Provenance is covered separately, and
    // without it the guard would (correctly) reject the URL before the shape assertion could run.
    const { args } = mergeBlockValues(
      { photo: { src: '', alt: '' } },
      { photo: 'https://cdn/x.jpg' },
      null,
      new Set(['https://cdn/x.jpg'])
    );
    assert.deepEqual(args.photo, { src: 'https://cdn/x.jpg', alt: '' });
  });

  it('takes item COUNT from the model and item SHAPE from the template', () => {
    const { args } = mergeBlockValues(
      { cards: [{ title: 'T', body: 'B', icon: 'star' }] },
      { cards: [{ title: 'Routing' }, { title: 'Assist' }, { title: 'Analytics' }] }
    );
    const cards = args.cards as Record<string, unknown>[];
    assert.equal(cards.length, 3);
    assert.deepEqual(cards[0], { title: 'Routing', body: 'B', icon: 'star' });
    assert.equal(cards[2].title, 'Analytics');
  });

  it('reports invented keys instead of silently dropping them', () => {
    // Silent dropping hides a prompt problem: the model keeps inventing a field and nobody finds out.
    const { args, unknownKeys } = mergeBlockValues({ headline: 'T' }, { headline: 'A', subtitle: 'B' });
    assert.deepEqual(unknownKeys, ['subtitle']);
    assert.equal('subtitle' in args, false);
  });

  it('ignores unknown keys nested inside an object field too', () => {
    const { args } = mergeBlockValues({ cta: { label: 'B', href: '#' } }, { cta: { label: 'Go', target: '_blank' } });
    assert.deepEqual(args.cta, { label: 'Go', href: '#' });
  });

  it('handles empty and missing values without throwing', () => {
    for (const v of [null, undefined, {}]) {
      assert.doesNotThrow(() => mergeBlockValues({ a: 1 }, v));
    }
    assert.deepEqual(mergeBlockValues({ a: 1 }, {}).args, { a: 1 });
  });

  it('never mutates the template', () => {
    const template = { cta: { label: 'Button' } };
    mergeBlockValues(template, { cta: { label: 'Changed' } });
    assert.equal(template.cta.label, 'Button');
  });
});

describe('mergeBlockValues — preview sample content', () => {
  const fields = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { editorType: v }]));

  it('replaces a serialized React element with the authored string', () => {
    // Previews store slot values as rendered trees. Treating one as a normal object found no matching
    // key, so the model's copy was discarded and the preview's own text shipped.
    const template = { bodySlot: { key: null, type: 'p', props: { children: 'Use Simple Copy for…' }, _owner: null } };
    const { args } = mergeBlockValues(template, { bodySlot: 'Real body copy.' });
    assert.equal(args.bodySlot, 'Real body copy.');
  });

  it('reports content fields the model never supplied', () => {
    const { unfilled } = mergeBlockValues(
      { title: 'T', bodySlot: 'Harum consequatur repellendus quaerat.', dark: false },
      { title: 'Real title' },
      fields({ title: 'text', bodySlot: 'richtext', dark: 'boolean' })
    );
    assert.deepEqual(unfilled, ['bodySlot']);
  });

  it('does not report configuration fields — a default theme is a real default', () => {
    const { unfilled } = mergeBlockValues(
      { title: 'T', theme: 'Off White', columns: 3 },
      { title: 'X' },
      fields({ title: 'text', theme: 'select', columns: 'number' })
    );
    assert.deepEqual(unfilled, []);
  });

  it('clears a workspace-relative image path, which 404s in registry mode', () => {
    // `../../images/content/card-image-1.webp` shipped to a live page and rendered broken.
    const { args } = mergeBlockValues(
      { imageSlot: { src: '../../images/content/card-image-1.webp', alt: 'Editable hero image' } },
      {},
      fields({ imageSlot: 'image' })
    );
    assert.deepEqual(args.imageSlot, { src: '', alt: 'Editable hero image' });
  });

  it('leaves a real asset URL alone', () => {
    const { args } = mergeBlockValues(
      { imageSlot: { src: 'https://cdn.example.com/hero.jpg', alt: '' } },
      {},
      fields({ imageSlot: 'image' })
    );
    assert.equal((args.imageSlot as { src: string }).src, 'https://cdn.example.com/hero.jpg');
  });

  it('reports nothing when there is no field metadata to judge against', () => {
    assert.deepEqual(mergeBlockValues({ a: 'x' }, {}).unfilled, []);
  });
});

describe('blankContentValues', () => {
  const fields = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { editorType: v }]));

  it('empties content so an unwritten field ships blank, not as somebody else sample copy', () => {
    const out = blankContentValues(
      { title: 'Sample headline', bodySlot: 'Harum consequatur repellendus quaerat.' },
      fields({ title: 'text', bodySlot: 'richtext' })
    );
    assert.equal(out.title, '');
    assert.equal(out.bodySlot, '');
  });

  it('keeps configuration, because a default theme really is a default', () => {
    const out = blankContentValues(
      { title: 'Sample', theme: 'Off White', columns: 3, dark: false },
      fields({ title: 'text', theme: 'select', columns: 'number', dark: 'boolean' })
    );
    assert.equal(out.theme, 'Off White');
    assert.equal(out.columns, 3);
    assert.equal(out.dark, false);
  });

  it('reduces an array to ONE blank item — the shape to author against', () => {
    // Keeping all three handed back somebody's three press releases as a starting point.
    const out = blankContentValues(
      { cards: [{ title: 'Q3 Results', body: 'Revenue exceeds…' }, { title: 'B' }, { title: 'C' }] },
      fields({ cards: 'array' })
    );
    assert.deepEqual(out.cards, [{ title: '', body: '' }]);
  });

  it('replaces an image with a placeholder at the template proportions', () => {
    const out = blankContentValues(
      { hero: { src: '../../images/content/card-image-1.webp', alt: 'Editable hero image', width: 1536, height: 1200 } },
      fields({ hero: 'image' })
    );
    const hero = out.hero as { src: string; alt: string; width: number };
    assert.match(hero.src, /^https:\/\/placehold\.co\/1536x1200/);
    assert.equal(hero.width, 1536, 'other template keys survive');
    assert.equal(hero.alt, 'Hero', 'alt captions the stand-in rather than describing a missing image');
  });

  it('recovers dimensions from an existing placeholder URL when width/height are absent', () => {
    const out = blankContentValues({ hero: { src: 'https://placehold.co/2560x1400', alt: 'x' } }, fields({ hero: 'image' }));
    assert.match(String((out.hero as { src: string }).src), /2560x1400/);
  });

  it('falls back to a sane ratio when nothing says otherwise', () => {
    const out = blankContentValues({ hero: { src: '', alt: '' } }, fields({ hero: 'image' }));
    assert.match(String((out.hero as { src: string }).src), /^https:\/\/placehold\.co\/1200x800/);
  });

  it('blanks a serialized React element to an empty string', () => {
    const out = blankContentValues(
      { bodySlot: { key: null, type: 'p', props: { children: 'docs text' }, _owner: null } },
      fields({ bodySlot: 'slot' })
    );
    assert.equal(out.bodySlot, '');
  });
});

describe('field shapes come from real preview values', () => {
  it('calls a plain-text field plain, so the model does not wrap it in <p>', () => {
    // A live page shipped "<p>Trusted by leading hospital systems…</p>" into a field that takes bare
    // text, because every `slot` had been described as "HTML string".
    const out = summarizeFields({ bodySlot: { editorType: 'slot' } }, { bodySlot: 'Our proven platform delivers.' });
    assert.match(out, /bodySlot: plain text/);
  });

  it('calls a markup field HTML, and shows which tag', () => {
    const out = summarizeFields({ titleSlot: { editorType: 'slot' } }, { titleSlot: '<h1>About 8x8</h1>' });
    assert.match(out, /titleSlot: HTML, e\.g\. <h1>…/);
  });

  it('names the real keys of an object field', () => {
    // buttonSlots is { url, text } on one block and { label, href } on another; only the value knows.
    const out = summarizeFields({ buttonSlots: { editorType: 'array' } }, { buttonSlots: [{ url: '#', text: 'Go' }] });
    assert.match(out, /\{ url: "#", text: "Go" \}/);
  });

  it('says what an array ITEM contains, which is what was missing', () => {
    const out = summarizeFields(
      { stats: { editorType: 'array' } },
      { stats: [{ stat: '2M+', eyebrow: 'Users', sub: '', bodySlot: '' }] }
    );
    assert.match(out, /array of \{ stat: "2M\+", eyebrow: "Users", sub, bodySlot \} — write EVERY item/);
  });

  it('hides bookkeeping keys from the shape', () => {
    const out = summarizeFields({ items: { editorType: 'array' } }, { items: [{ _key: '1', _type: 'stat', label: 'x' }] });
    assert.doesNotMatch(out, /_key/);
  });

  it('falls back to the declared type when there is no preview value', () => {
    assert.match(summarizeFields({ title: { editorType: 'text' } }, {}), /title: text/);
  });
});

describe('supplied-but-empty counts as unfilled', () => {
  const fields = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { editorType: v }]));

  it('flags an array of blank objects', () => {
    // The live failure: four stat objects, every field empty, and the presence check called it done.
    const { unfilled } = mergeBlockValues(
      { stats: [{ stat: '', eyebrow: '' }] },
      { stats: [{ stat: '' }, { stat: '' }, { stat: '' }, { stat: '' }] },
      fields({ stats: 'array' })
    );
    assert.deepEqual(unfilled, ['stats']);
  });

  it('accepts an array that actually has content', () => {
    const { unfilled } = mergeBlockValues(
      { stats: [{ stat: '', eyebrow: '' }] },
      { stats: [{ stat: '2M+', eyebrow: 'Users' }] },
      fields({ stats: 'array' })
    );
    assert.deepEqual(unfilled, []);
  });

  it('flags an empty string supplied for a text field', () => {
    const { unfilled } = mergeBlockValues({ title: '' }, { title: '   ' }, fields({ title: 'text' }));
    assert.deepEqual(unfilled, ['title']);
  });

  it('flags an untouched image so the model at least looks for a real asset', () => {
    const { unfilled, args } = mergeBlockValues(
      { hero: { src: 'https://placehold.co/1200x800', alt: '' } },
      {},
      fields({ hero: 'image' })
    );
    assert.deepEqual(unfilled, ['hero']);
    // Flagged, but the placeholder survives — if no asset fits, a sized stand-in beats an empty slot.
    assert.match(String((args.hero as { src: string }).src), /placehold\.co/);
  });

  it('does not flag an image the model filled from the asset store', () => {
    const { unfilled } = mergeBlockValues(
      { hero: { src: 'https://placehold.co/1200x800', alt: '' } },
      { hero: { src: 'https://cdn.example.com/real.jpg', alt: 'Care team' } },
      fields({ hero: 'image' })
    );
    assert.deepEqual(unfilled, []);
  });
});

describe('array item keys', () => {
  it('gives generated items distinct keys', () => {
    // All N items inheriting the template's single `_key` is a duplicate-key bug waiting on the first
    // page that actually fills an array.
    const { args } = mergeBlockValues(
      { stats: [{ _key: 'stat1', stat: '', eyebrow: '' }] },
      { stats: [{ stat: '2M+' }, { stat: '160+' }, { stat: '99.999%' }] }
    );
    const keys = (args.stats as { _key: string }[]).map((s) => s._key);
    assert.equal(new Set(keys).size, 3);
  });

  it('respects a key the model supplied', () => {
    const { args } = mergeBlockValues({ items: [{ _key: 't', label: '' }] }, { items: [{ _key: '1996', label: 'Founded' }] });
    assert.equal((args.items as { _key: string }[])[0]._key, '1996');
  });
});

describe('readable placeholders', () => {
  const fields = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { editorType: v }]));

  it('labels the placeholder with what belongs there', () => {
    // An unlabelled grey box only says "something is missing", which is the least useful thing a
    // placeholder can communicate in a review.
    const out = blankContentValues({ imageSlot: { src: '', alt: '', width: 1536, height: 1024 } }, fields({ imageSlot: 'image' }));
    const src = String((out.imageSlot as { src: string }).src);
    assert.match(src, /1536x1024/);
    assert.match(src, /text=Image/);
  });

  it('turns a camelCase field name into a caption', () => {
    assert.equal(humanizeFieldName('desktopImageSlot'), 'Desktop image');
    assert.equal(humanizeFieldName('mediaSlot'), 'Media');
    assert.equal(humanizeFieldName('imageSlot'), 'Image');
  });

  it('gives a slot that renders an <img> a placeholder, not an empty string', () => {
    // mediaSlot came through as "" on a live page while imageSlot got a placeholder — the slot held
    // markup, so the image branch never ran.
    const out = blankContentValues(
      { mediaSlot: '<img src="../../images/content/x.webp" alt="Team" />' },
      fields({ mediaSlot: 'slot' })
    );
    assert.match(String(out.mediaSlot), /<img src="https:\/\/placehold\.co/);
  });

  it('handles a rendered element tree containing an image', () => {
    const tree = { key: null, type: 'figure', props: { children: { type: 'img', props: { src: 'x.png' } } }, _owner: null };
    const out = blankContentValues({ mediaSlot: tree }, fields({ mediaSlot: 'slot' }));
    assert.match(String(out.mediaSlot), /placehold\.co/);
  });

  it('leaves a non-image slot as an empty string', () => {
    const tree = { key: null, type: 'p', props: { children: 'docs' }, _owner: null };
    const out = blankContentValues({ bodySlot: tree }, fields({ bodySlot: 'slot' }));
    assert.equal(out.bodySlot, '');
  });

  it('gives an image field with no preview object a stand-in anyway', () => {
    // Otherwise the slot collapses and the page loses its proportions.
    const out = blankContentValues({ hero: '' }, fields({ hero: 'image' }));
    assert.match(String((out.hero as { src: string }).src), /placehold\.co/);
  });

  it('keeps srcset in step with src, or the browser serves the stale one', () => {
    const out = blankContentValues(
      { hero: { src: 'old.jpg', srcset: 'old.jpg 2x', alt: '' } },
      fields({ hero: 'image' })
    );
    const hero = out.hero as { src: string; srcset: string };
    assert.equal(hero.srcset, hero.src);
  });
});

describe('invented image URLs', () => {
  const fields = (o: Record<string, string>) =>
    Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { editorType: v }]));

  it('replaces a plausible but invented CDN path with the placeholder', () => {
    // A live page shipped https://assets.8x8.com/images/healthcare-contact-center.jpg — invented, and
    // a 404. Worse than a missing image because it looks real enough that nobody checks.
    const { args, invalidValues } = mergeBlockValues(
      { hero: { src: 'https://placehold.co/1536x1024', alt: '' } },
      { hero: { src: 'https://assets.8x8.com/images/made-up.jpg', alt: 'x' } },
      fields({ hero: 'image' }),
      new Set()
    );
    assert.match(String((args.hero as { src: string }).src), /placehold\.co/);
    assert.equal(invalidValues.length, 1);
  });

  it('accepts a src the asset store actually returned', () => {
    const known = new Set(['https://real.blob/asset.jpg']);
    const { args, invalidValues } = mergeBlockValues(
      { hero: { src: 'https://placehold.co/1200x800', alt: '' } },
      { hero: { src: 'https://real.blob/asset.jpg', alt: 'Care team' } },
      fields({ hero: 'image' }),
      known
    );
    assert.equal((args.hero as { src: string }).src, 'https://real.blob/asset.jpg');
    assert.deepEqual(invalidValues, []);
  });

  it('accepts the app own proxy paths', () => {
    const { invalidValues } = mergeBlockValues(
      { hero: { src: '', alt: '' } },
      { hero: { src: '/api/handoff/artifact-asset?p=x', alt: '' } },
      fields({ hero: 'image' }),
      new Set()
    );
    assert.deepEqual(invalidValues, []);
  });

  it('checks images nested inside array items too', () => {
    const { invalidValues } = mergeBlockValues(
      { cards: [{ img: { src: 'https://placehold.co/400x300', alt: '' } }] },
      { cards: [{ img: { src: 'https://invented.example/a.jpg' } }] },
      fields({ cards: 'array' }),
      new Set()
    );
    assert.equal(invalidValues.length, 1);
  });
});

describe('bookkeeping keys survive blanking', () => {
  it('keeps _type, which components switch on', () => {
    // A live page came back with `_type: ""` where the preview had "statCard".
    const out = blankContentValues(
      { stats: [{ _key: 'a', _type: 'statCard', stat: '100', eyebrow: 'Countries' }] },
      { stats: { editorType: 'array' } }
    );
    const item = (out.stats as Record<string, unknown>[])[0];
    assert.equal(item._type, 'statCard');
    assert.equal(item._key, 'a');
    assert.equal(item.stat, '');
  });
});

describe('summarizeFields', () => {
  it('caps the list so the whole catalog stays cheap to send', () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${i}`, { editorType: 'text' }]));
    assert.match(summarizeFields(many), /\+13 more/);
  });

  it('is empty for a component with no fields', () => {
    assert.equal(summarizeFields({}), '');
    assert.equal(summarizeFields(null), '');
  });
});

/**
 * The real `desktopImageSlot` on `hero-background` — a serialized React element.
 *
 * **Verified against the live component module in a browser, not reasoned about.** Rendering
 * `hero-background` with this slot set four ways:
 *
 * | value | result |
 * |---|---|
 * | `{ src, alt }` | renders the src |
 * | `{ ...element, src, alt }` | renders the src (top-level wins) |
 * | element with `props.src` | **silently ignored** — component falls back to its own default image |
 * | the stored preview value verbatim | **throws** `(e \|\| []).filter is not a function` |
 *
 * So a serialized element in a preview is **render output, not an input prop**, and the declared
 * `{ src, alt }` contract is correct. An earlier fix wrote into `props.src` on the theory that the
 * element was the real shape; that produced values the component discards, which is worse than the bug
 * it replaced because the page shows a plausible default instead of nothing.
 */
describe('image slots whose preview value is a React element', () => {
  const heroImageSlot = () => ({
    key: 'Desktop background preview image, 64:35 aspect ratio',
    type: 'img',
    props: {
      alt: '',
      src: '../../images/content/iframe-bg-img.jpeg',
      role: 'presentation',
      width: 2560,
      height: 1400,
      className: 'h-full w-full object-cover',
      'aria-hidden': true,
    },
    _owner: null,
    _store: {},
  });

  const fields = { desktopImageSlot: { editorType: 'image', shape: '{ src, alt, width?, height? }', fromBase: true } };

  it('normalises the element to the plain shape the component accepts', () => {
    const blanked = blankContentValues({ desktopImageSlot: heroImageSlot() }, fields) as {
      desktopImageSlot: Record<string, unknown>;
    };
    const slot = blanked.desktopImageSlot;
    // Not an element: that form is discarded by the component in favour of its own default.
    assert.ok(!('type' in slot) && !('props' in slot), 'must not stay a serialized element');
    assert.match(String(slot.src), /placehold\.co/);
    assert.ok(!String(slot.src).includes('../../images'), 'the unresolvable preview path must be gone');
  });

  it('lifts the aspect ratio out of props.width/height before discarding the element', () => {
    const blanked = blankContentValues({ desktopImageSlot: heroImageSlot() }, fields) as {
      desktopImageSlot: { src: string; width: number; height: number };
    };
    // 2560x1400 is 64:35 — a square placeholder in a wide hero makes a good layout look broken.
    assert.equal(blanked.desktopImageSlot.width, 2560);
    assert.equal(blanked.desktopImageSlot.height, 1400);
    const [, w, h] = /(\d+)x(\d+)/.exec(blanked.desktopImageSlot.src) ?? [];
    assert.ok(Number(w) > Number(h), `expected a landscape placeholder, got ${w}x${h}`);
  });

  it('passes an authored { src, alt } through as plain data', () => {
    const known = new Set(['/api/handoff/assets/img_abc/raw']);
    const template = blankContentValues({ desktopImageSlot: heroImageSlot() }, fields);
    const { args } = mergeBlockValues(
      template,
      { desktopImageSlot: { src: '/api/handoff/assets/img_abc/raw', alt: 'Students on campus' } },
      fields,
      known
    );
    const slot = args.desktopImageSlot as Record<string, unknown>;
    assert.equal(slot.src, '/api/handoff/assets/img_abc/raw');
    assert.equal(slot.alt, 'Students on campus');
    assert.ok(!('props' in slot), 'an element-shaped result is silently ignored by the component');
  });

  it('still rejects an invented src', () => {
    const template = blankContentValues({ desktopImageSlot: heroImageSlot() }, fields);
    const { args, invalidValues } = mergeBlockValues(
      template,
      { desktopImageSlot: { src: 'https://assets.8x8.com/images/made-up.jpg', alt: 'x' } },
      fields,
      new Set()
    );
    const slot = args.desktopImageSlot as Record<string, unknown>;
    assert.ok(!String(slot.src).includes('assets.8x8.com'));
    assert.equal(invalidValues.length, 1);
  });

  it('leaves a preview that already holds plain data alone', () => {
    // Previews are an inconsistent mix: some store input props, some store render output. Only the
    // output-shaped ones need normalising.
    const plainFields = { imageSlot: { editorType: 'image', shape: '{ src, alt }', fromBase: true } };
    const blanked = blankContentValues(
      { imageSlot: { src: '../../images/content/x.webp', alt: 'A', width: 800, height: 600 } },
      plainFields
    ) as { imageSlot: Record<string, unknown> };
    assert.match(String(blanked.imageSlot.src), /placehold\.co/);
    assert.equal(blanked.imageSlot.width, 800);
  });
});

/**
 * Misread for a week as the model *inventing* image URLs. It was not: it searched the library, found
 * the right asset, and wrote the whole tag into the src. The object shape was right and the asset was
 * real — only the packaging was wrong, and rejecting it shipped a page entirely on placeholders while
 * the reply said every field was authored. Measured 0 of 4.
 */
describe('extractImageSrc', () => {
  it('pulls the url out of an img tag, which is what the model actually wrote', () => {
    assert.equal(
      extractImageSrc('<img src="/api/handoff/assets/img_aeb067be0406/raw" alt="Students on campus" />'),
      '/api/handoff/assets/img_aeb067be0406/raw'
    );
  });

  it('handles single quotes and extra attributes', () => {
    assert.equal(extractImageSrc("<img class='w-full' src='/api/x/raw' width='800'>"), '/api/x/raw');
  });

  it('handles markdown image notation — the same mistake, different notation', () => {
    assert.equal(extractImageSrc('![Students](/api/x/raw)'), '/api/x/raw');
  });

  it('leaves a bare url completely alone, including one with a query string', () => {
    assert.equal(extractImageSrc('/api/x/raw'), '/api/x/raw');
    assert.equal(extractImageSrc('https://placehold.co/800x600?text=A%20B'), 'https://placehold.co/800x600?text=A%20B');
  });

  it('returns the input when there is nothing to unwrap', () => {
    assert.equal(extractImageSrc('<span>not an image</span>'), '<span>not an image</span>');
    assert.equal(extractImageSrc(''), '');
  });
});

describe('mergeBlockValues unwrapping a wrapped src', () => {
  const template = { imageSlot: { src: 'https://placehold.co/1200x800', alt: '' } };
  const known = new Set(['/api/handoff/assets/img_real/raw']);

  it('recovers a real asset from a tag rather than throwing it away', () => {
    const r = mergeBlockValues(
      template,
      { imageSlot: { src: '<img src="/api/handoff/assets/img_real/raw" alt="Campus" />' } },
      { imageSlot: { editorType: 'image' } },
      known
    );
    assert.deepEqual(r.args.imageSlot, { src: '/api/handoff/assets/img_real/raw', alt: 'Campus' });
    assert.deepEqual(r.invalidValues, [], 'a recovered asset is not an invalid value');
  });

  it('does not let a tag smuggle in a src the guard would otherwise refuse', () => {
    // Extraction is not a relaxation. Whatever comes out is checked the same way a bare string is.
    const r = mergeBlockValues(
      template,
      { imageSlot: { src: '<img src="https://evil.example.com/x.png" />' } },
      { imageSlot: { editorType: 'image' } },
      known
    );
    assert.match(String((r.args.imageSlot as { src: string }).src), /placehold\.co/);
    assert.equal(r.invalidValues.length, 1);
  });

  it('refuses a javascript: url wrapped in a tag', () => {
    const r = mergeBlockValues(
      template,
      { imageSlot: { src: `<img src="javascript:alert(1)" />` } },
      { imageSlot: { editorType: 'image' } },
      known
    );
    assert.match(String((r.args.imageSlot as { src: string }).src), /placehold\.co/);
  });

  it('keeps an alt the model supplied rather than overwriting it from the tag', () => {
    const r = mergeBlockValues(
      template,
      { imageSlot: { src: '<img src="/api/handoff/assets/img_real/raw" alt="From tag" />', alt: 'Authored' } },
      { imageSlot: { editorType: 'image' } },
      known
    );
    assert.equal((r.args.imageSlot as { alt: string }).alt, 'Authored');
  });

  it('names the offending value when it really is unusable', () => {
    // "not from the asset library" alone is the unknown-key mistake again: told it is wrong, with no
    // idea what was wrong, the model produces the same thing on retry.
    const r = mergeBlockValues(
      template,
      { imageSlot: { src: 'https://cdn.made-up.com/hero.jpg' } },
      { imageSlot: { editorType: 'image' } },
      known
    );
    assert.match(r.invalidValues[0]!, /cdn\.made-up\.com/);
  });
});

/**
 * The swap has to be reported to *both* audiences.
 *
 * `invalidValues` is model-facing and ends in an instruction. `replacedImages` is the structured fact,
 * so the UI can phrase it for a person. Only the first existed, which is why an edit could apply, report
 * "Applied", claim the image was added, and show a placeholder.
 */
describe('mergeBlockValues reports replaced images structurally', () => {
  const template = { imageSlot: { src: 'https://placehold.co/1200x800', alt: '' } };
  const fields = { imageSlot: { editorType: 'image' } };

  it('records the field whose image was refused', () => {
    const r = mergeBlockValues(template, { imageSlot: { src: 'https://cdn.made-up.com/a.jpg' } }, fields, new Set());
    assert.deepEqual(r.replacedImages, [{ field: 'imageSlot', src: 'https://cdn.made-up.com/a.jpg' }]);
    assert.equal(r.invalidValues.length, 1, 'and still tells the model');
  });

  it('records nothing when the src was legitimate', () => {
    const known = new Set(['/api/handoff/assets/img_real/raw']);
    const r = mergeBlockValues(template, { imageSlot: { src: '/api/handoff/assets/img_real/raw' } }, fields, known);
    assert.deepEqual(r.replacedImages, []);
    assert.deepEqual(r.invalidValues, []);
  });

  it('records nothing for a src recovered from a wrapped tag', () => {
    // Unwrapping is a recovery, not a rejection — reporting it would tell the user their image failed
    // when it did not.
    const known = new Set(['/api/handoff/assets/img_real/raw']);
    const r = mergeBlockValues(
      template,
      { imageSlot: { src: '<img src="/api/handoff/assets/img_real/raw" alt="A" />' } },
      fields,
      known
    );
    assert.deepEqual(r.replacedImages, []);
  });

  it('records every item of an array field, not just the first', () => {
    const arrayTemplate = { images: [{ src: 'https://placehold.co/800x600', alt: '' }] };
    const r = mergeBlockValues(
      arrayTemplate,
      { images: [{ src: 'https://a.invalid/1.jpg' }, { src: 'https://a.invalid/2.jpg' }] },
      { images: { editorType: 'list' } },
      new Set()
    );
    assert.equal(r.replacedImages.length, 2, 'a gallery with two bad srcs is two problems');
    assert.ok(r.replacedImages.every((x) => x.field === 'images'));
  });
});
