import assert from 'node:assert';
import { describe, it } from 'node:test';
import { contentOnlyProperties } from '../src/app/components/Playground/fields/content-only';

/**
 * Invitations lock configuration — a guest edits content only (Brad, 2026-08-06).
 *
 * The filter runs over the properties tree, so a hidden field is genuinely absent rather than disabled.
 */
describe('contentOnlyProperties', () => {
  it('keeps copy, imagery and calls to action', () => {
    const kept = contentOnlyProperties({
      titleSlot: { type: 'text' },
      bodySlot: { type: 'React.ReactNode' },
      blurb: { type: 'richtext' },
      imageSlot: { type: 'image' },
      clip: { type: 'video_file' },
      cta: { type: 'button' },
      more: { type: 'link' },
    });
    assert.deepEqual(Object.keys(kept).sort(), ['blurb', 'bodySlot', 'clip', 'cta', 'imageSlot', 'more', 'titleSlot']);
  });

  it('drops the configuration a brand-controlled invite should own', () => {
    const kept = contentOnlyProperties({
      theme: { type: 'select', options: ['deep-purple', 'light'] },
      layout: { type: 'enum', options: ['large', 'small'] },
      useCarousel: { type: 'boolean' },
      columns: { type: 'number' },
      onClick: { type: 'function' },
    });
    assert.deepEqual(kept, {});
  });

  /** `any`/unknown renders a raw JSON editor over the block args — an arbitrary write past every field rule. */
  it('drops the raw-JSON escape hatch', () => {
    assert.deepEqual(contentOnlyProperties({ mystery: { type: 'any' } }), {});
    assert.deepEqual(contentOnlyProperties({ weird: { type: 'something-unrecognised' } }), {});
  });

  it('keeps a container for the content inside it, and drops the config beside it', () => {
    const kept = contentOnlyProperties({
      meta: {
        type: 'object',
        properties: { eyebrow: { type: 'text' }, showEyebrow: { type: 'boolean' } },
      },
    });
    assert.deepEqual(Object.keys(kept), ['meta']);
    const meta = kept.meta as { properties: Record<string, unknown> };
    assert.deepEqual(Object.keys(meta.properties), ['eyebrow']);
  });

  /** A group of nothing but toggles should disappear, not render as an empty labelled box. */
  it('drops a container with nothing editable left inside', () => {
    const kept = contentOnlyProperties({
      display: { type: 'object', properties: { dark: { type: 'boolean' }, cols: { type: 'number' } } },
    });
    assert.deepEqual(kept, {});
  });

  it('filters array item fields and keeps the array', () => {
    const kept = contentOnlyProperties({
      stats: {
        type: 'array',
        items: { properties: { stat: { type: 'text' }, animate: { type: 'boolean' } } },
      },
    });
    const stats = kept.stats as { items: { properties: Record<string, unknown> } };
    assert.deepEqual(Object.keys(stats.items.properties), ['stat']);
  });

  it('keeps an array of bare strings, where the item descriptor is the leaf', () => {
    const kept = contentOnlyProperties({ tags: { type: 'array', items: { type: 'text' } } });
    assert.deepEqual(Object.keys(kept), ['tags']);
  });

  it('drops an array whose items are all configuration', () => {
    assert.deepEqual(contentOnlyProperties({ flags: { type: 'array', items: { type: 'boolean' } } }), {});
  });

  /** An authored `editorType` wins on widget choice, so it has to win here too or the two disagree. */
  it('respects an authored editorType over the raw type', () => {
    const kept = contentOnlyProperties({ slotty: { type: 'React.ReactNode', editorType: 'image' } });
    assert.deepEqual(Object.keys(kept), ['slotty']);
    assert.deepEqual(contentOnlyProperties({ locked: { type: 'text', editorType: 'select' } }), {});
  });

  it('tolerates nonsense input', () => {
    assert.deepEqual(contentOnlyProperties(undefined), {});
    assert.deepEqual(contentOnlyProperties('nope'), {});
    assert.deepEqual(contentOnlyProperties([{ type: 'text' }]), {});
    assert.deepEqual(contentOnlyProperties({ a: null, b: 'x' }), {});
  });
});

/**
 * Config declared as a bare string, which no type check can catch.
 *
 * Found by running the filter against `hero-split`: `theme`/`layout`/`direction` are `enum` and lock correctly,
 * but `anchor` and `imageTheme` are `type: 'text'` — a guest editing `anchor` breaks in-page navigation.
 */
describe('contentOnlyProperties — config that looks like text', () => {
  it('locks the known string-typed config names', () => {
    const kept = contentOnlyProperties({
      anchor: { type: 'text' },
      imageTheme: { type: 'text' },
      questionTheme: { type: 'text' },
      slug: { type: 'text' },
      className: { type: 'text' },
      titleSlot: { type: 'text' },
    });
    assert.deepEqual(Object.keys(kept), ['titleSlot']);
  });

  /** Narrow on purpose — it must not start swallowing copy. */
  it('does not swallow ordinary copy fields', () => {
    const kept = contentOnlyProperties({
      title: { type: 'text' },
      bodySlot: { type: 'React.ReactNode' },
      eyebrow: { type: 'text' },
      overlineSlot: { type: 'text' },
    });
    assert.deepEqual(Object.keys(kept).sort(), ['bodySlot', 'eyebrow', 'overlineSlot', 'title']);
  });

  it('locks them inside containers too', () => {
    const kept = contentOnlyProperties({
      group: { type: 'object', properties: { anchor: { type: 'text' }, heading: { type: 'text' } } },
    });
    const group = kept.group as { properties: Record<string, unknown> };
    assert.deepEqual(Object.keys(group.properties), ['heading']);
  });
});
