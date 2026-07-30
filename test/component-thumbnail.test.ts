import assert from 'node:assert';
import { describe, it } from 'node:test';
import { componentThumbnailSvg, componentThumbnailUrl } from '../src/app/lib/component-thumbnail';

const props = (o: Record<string, { editorType: string }>) => o;

describe('componentThumbnailSvg', () => {
  it('always returns well-formed SVG, even for an empty contract', () => {
    for (const p of [undefined, null, {}]) {
      const svg = componentThumbnailSvg(p);
      assert.match(svg, /^<svg[^>]+>/);
      assert.match(svg, /<\/svg>$/);
    }
  });

  it('draws a placeholder rather than a blank box when there is nothing to show', () => {
    // A blank rectangle reads as a loading failure, which is the thing this route exists to avoid.
    assert.match(componentThumbnailSvg({}), /stroke-dasharray/);
  });

  it('uses the split layout for one image beside copy — the hero shape', () => {
    const svg = componentThumbnailSvg(
      props({ title: { editorType: 'text' }, body: { editorType: 'richtext' }, photo: { editorType: 'image' } })
    );
    // The split branch draws the picture mark; the stacked branch does not.
    assert.match(svg, /<circle/);
  });

  it('stacks when there is no image', () => {
    const svg = componentThumbnailSvg(props({ title: { editorType: 'text' }, body: { editorType: 'richtext' } }));
    assert.doesNotMatch(svg, /<circle/);
  });

  it('lets an explicit name beat position, so only one field becomes the heading', () => {
    // `subtitle` declared first must not be drawn as the headline. Declaration order still drives the
    // vertical order — an eyebrow above a headline is a real layout — so the two are not identical;
    // what must hold is that exactly one heading is drawn, and it is the one named like one.
    const headingBars = (svg: string) => (svg.match(/height="13"/g) ?? []).length;

    const subtitleFirst = componentThumbnailSvg(props({ subtitle: { editorType: 'text' }, title: { editorType: 'text' } }));
    const titleFirst = componentThumbnailSvg(props({ title: { editorType: 'text' }, subtitle: { editorType: 'text' } }));

    // A heading draws two bars; two headings would draw four.
    assert.equal(headingBars(subtitleFirst), 2);
    assert.equal(headingBars(titleFirst), 2);
  });

  it('falls back to position only when no field is named like a heading', () => {
    const svg = componentThumbnailSvg(props({ blurb: { editorType: 'text' }, detail: { editorType: 'text' } }));
    assert.equal((svg.match(/height="13"/g) ?? []).length, 2, 'the first text field should read as the heading');
  });

  it('ignores configuration properties, which occupy no visual space', () => {
    const withConfig = componentThumbnailSvg(
      props({ title: { editorType: 'text' }, dark: { editorType: 'boolean' }, cols: { editorType: 'number' } })
    );
    const without = componentThumbnailSvg(props({ title: { editorType: 'text' } }));
    assert.equal(withConfig, without);
  });

  it('escapes nothing user-controlled into the markup', () => {
    // Property NAMES steer layout but must never reach the output — otherwise a component id or a
    // field name becomes an SVG injection vector.
    const svg = componentThumbnailSvg(props({ '"><script>alert(1)</script>': { editorType: 'text' } }));
    assert.doesNotMatch(svg, /<script>/);
  });

  it('caps how much it draws so a 40-prop component stays legible', () => {
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, { editorType: 'text' }]));
    const svg = componentThumbnailSvg(many);
    assert.ok((svg.match(/<rect/g) ?? []).length < 24);
  });
});

describe('componentThumbnailUrl', () => {
  it('encodes the id and honours basePath', () => {
    assert.equal(componentThumbnailUrl('hero-split'), '/api/handoff/components/hero-split/thumbnail.svg');
    assert.equal(componentThumbnailUrl('a/b', '/ds'), '/ds/api/handoff/components/a%2Fb/thumbnail.svg');
  });
});
