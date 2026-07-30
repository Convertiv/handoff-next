import assert from 'node:assert';
import { describe, it } from 'node:test';
import { blankContentValues, mergeBlockValues, summarizeFields } from '../src/app/lib/merge-block-values';

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
    const { args } = mergeBlockValues({ photo: { src: '', alt: '' } }, { photo: 'https://cdn/x.jpg' });
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
    assert.deepEqual(out.hero, { src: 'https://placehold.co/1536x1200', alt: '', width: 1536, height: 1200 });
  });

  it('recovers dimensions from an existing placeholder URL when width/height are absent', () => {
    const out = blankContentValues({ hero: { src: 'https://placehold.co/2560x1400', alt: 'x' } }, fields({ hero: 'image' }));
    assert.match(String((out.hero as { src: string }).src), /2560x1400/);
  });

  it('falls back to a sane ratio when nothing says otherwise', () => {
    const out = blankContentValues({ hero: { src: '', alt: '' } }, fields({ hero: 'image' }));
    assert.equal((out.hero as { src: string }).src, 'https://placehold.co/1200x800');
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
    assert.match(out, /\{ url, text \}/);
  });

  it('says what an array ITEM contains, which is what was missing', () => {
    const out = summarizeFields(
      { stats: { editorType: 'array' } },
      { stats: [{ stat: '2M+', eyebrow: 'Users', sub: '', bodySlot: '' }] }
    );
    assert.match(out, /array of \{ stat, eyebrow, sub, bodySlot \} — write EVERY item/);
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
