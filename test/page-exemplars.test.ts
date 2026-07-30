import assert from 'node:assert';
import { describe, it } from 'node:test';
import { PAGE_EXEMPLARS, formatExemplars } from '../src/app/lib/page-exemplars';

/**
 * These ship on every turn, so they have to stay compact — and they have to keep saying the thing that
 * actually changes output: real pages are long and their backgrounds alternate.
 */
describe('page exemplars', () => {
  it('describes each section as a sentence, not as a component id', () => {
    // Naming ids would rot the moment the catalog changes, and the model already has the catalog in
    // front of it — what it lacks is the rhythm. "Three-up: how it fits how people work" is guidance;
    // "hero-split-media" is a dependency.
    for (const ex of PAGE_EXEMPLARS) {
      for (const s of ex.sections) {
        assert.doesNotMatch(s.purpose, /^[a-z][a-z0-9-]*$/, `"${s.purpose}" reads as an id`);
        assert.ok(s.purpose.includes(' '), `"${s.purpose}" should be descriptive`);
      }
    }
  });

  it('shows a product page as long, which is the correction that matters', () => {
    // Ours produced four sections; the real one has fifteen.
    const product = PAGE_EXEMPLARS.find((e) => e.name === 'Product page');
    assert.ok(product && product.sections.length >= 12);
  });

  it('varies background tone rather than repeating one', () => {
    for (const ex of PAGE_EXEMPLARS) {
      const tones = new Set(ex.sections.map((s) => s.tone));
      assert.ok(tones.size >= 3, `${ex.name} should alternate backgrounds`);
    }
  });

  it('always opens on a brand-coloured hero', () => {
    // Ours made every block off-white including the hero, which is most of why it read as flat.
    for (const ex of PAGE_EXEMPLARS) {
      assert.equal(ex.sections[0].tone, 'brand', `${ex.name} hero`);
    }
  });

  it('closes on a CTA for pages that sell, but not for a customer story', () => {
    // The real customer story ends on related stories, not a pitch. Forcing a CTA everywhere would be
    // inventing best practice rather than recording what the site does.
    const closer = (n: string) => PAGE_EXEMPLARS.find((e) => e.name === n)!.sections.slice(-1)[0];
    assert.equal(closer('Product page').tone, 'brand');
    assert.equal(closer('Solution / use-case page').tone, 'brand');
    assert.match(closer('Customer story').purpose, /Related/);
  });

  it('renders compactly enough to ship on every turn', () => {
    const out = formatExemplars();
    assert.ok(out.length < 3500, `exemplars are ${out.length} chars`);
    assert.match(out, /Product page/);
    assert.match(out, /brand background/);
  });

  it('carries item counts so grids are not proposed with one entry', () => {
    assert.match(formatExemplars(), /\(3 items\)/);
  });
});
