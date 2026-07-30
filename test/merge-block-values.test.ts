import assert from 'node:assert';
import { describe, it } from 'node:test';
import { mergeBlockValues, summarizeFields } from '../src/app/lib/merge-block-values';

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

describe('summarizeFields', () => {
  it('names each field with its editor type', () => {
    const out = summarizeFields({ headline: { editorType: 'text' }, photo: { editorType: 'image' } });
    assert.equal(out, 'headline (text), photo (image)');
  });

  it('caps the list so the whole catalog stays cheap to send', () => {
    const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`f${i}`, { editorType: 'text' }]));
    const out = summarizeFields(many);
    assert.match(out, /\+15 more/);
  });

  it('is empty for a component with no fields', () => {
    assert.equal(summarizeFields({}), '');
    assert.equal(summarizeFields(null), '');
  });
});
