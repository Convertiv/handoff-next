import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  describeBriefComponents,
  findNamedComponents,
  resolveBriefComponents,
  signatureOf,
} from '../src/app/lib/brief-components';

/**
 * "The copy doc suggested Split Content and Handoff provided Simple Copy."
 *
 * That is not a near miss — `content-split` is `{content, split}` and `simple-copy` is `{copy, simple}`,
 * nothing in common. The brief said which block it wanted and nothing read it.
 *
 * The catalog entries below are real 8x8 components, including the ones that make naive matching
 * dangerous: `hero-split`, `split-card-carousel` and `content-split` all contain the word "split".
 */
const CATALOG = [
  { id: 'content-split', title: 'Content Split' },
  { id: 'simple-copy', title: 'Simple Copy' },
  { id: 'hero-split', title: 'Hero Split' },
  { id: 'split-card-carousel', title: 'Split Card Carousel' },
  { id: 'card', title: 'Simple Card' },
  { id: 'two-column-content', title: 'Two Column Content' },
  { id: 'stats', title: 'Stats' },
];

describe('signatureOf', () => {
  it('is order-insensitive, which is the whole reason this works', () => {
    // "Split Content" vs "Content Split" — the same words reversed. A substring or prefix test misses it.
    assert.equal(signatureOf('Split Content'), signatureOf('Content Split'));
    assert.equal(signatureOf('Split Content'), signatureOf('content-split'));
  });

  it('ignores punctuation and casing', () => {
    assert.equal(signatureOf('content_split'), signatureOf('CONTENT / SPLIT'));
  });

  it('drops words that say a thing is a component rather than which one', () => {
    assert.equal(signatureOf('Split Content Block'), signatureOf('content-split'));
    assert.equal(signatureOf('hero section'), signatureOf('Hero'));
  });

  it('is empty for a name made only of noise, so it cannot match everything', () => {
    assert.equal(signatureOf('the block'), '');
    assert.equal(signatureOf('   '), '');
  });
});

describe('resolveBriefComponents', () => {
  it('resolves the reported case', () => {
    const { matched, unmatched } = resolveBriefComponents(['Split Content'], CATALOG);
    assert.deepEqual(unmatched, []);
    assert.equal(matched[0]!.id, 'content-split');
  });

  it('does not let a shared word pick the wrong block', () => {
    // `{split}` is a subset of hero-split, split-card-carousel AND content-split, so subset matching
    // would confidently return whichever came first. Equality either matches or does not.
    const { matched, unmatched } = resolveBriefComponents(['Split'], CATALOG);
    assert.deepEqual(matched, []);
    assert.deepEqual(unmatched, ['Split']);
  });

  it('matches on the title when it differs from the id', () => {
    // `card` is titled "Simple Card"; a brief is written from what someone saw in the picker.
    assert.equal(resolveBriefComponents(['Simple Card'], CATALOG).matched[0]!.id, 'card');
  });

  it('matches on the id when someone pastes the slug', () => {
    assert.equal(resolveBriefComponents(['two-column-content'], CATALOG).matched[0]!.id, 'two-column-content');
  });

  it('reports a name that matches nothing rather than guessing', () => {
    const { matched, unmatched } = resolveBriefComponents(['Zig Zag Timeline'], CATALOG);
    assert.deepEqual(matched, []);
    assert.deepEqual(unmatched, ['Zig Zag Timeline']);
  });

  it('does not depend on the catalog being collision-free, because it is not', () => {
    // This used to assert the fixture had no colliding titles, on the belief that a collision would make
    // a component silently unreachable. The real registry has one — `content-split` and `feature` are both
    // titled "Content Split" — so the behaviour under collision is what needs asserting, not its absence.
    // See the duplicate-title suite below.
    const signatures = CATALOG.map((c) => signatureOf(c.title));
    assert.equal(new Set(signatures).size, signatures.length, 'this fixture happens to be clean');
  });

  it('survives an empty catalog and empty names', () => {
    assert.deepEqual(resolveBriefComponents([], CATALOG), { matched: [], unmatched: [] });
    assert.deepEqual(resolveBriefComponents(['Content Split'], []).unmatched, ['Content Split']);
  });
});

describe('findNamedComponents', () => {
  it('reads a Component column out of a markdown table', () => {
    // The shape `docxToSourceCopy` emits from a Word table.
    const brief = [
      '| Section | Component | New Copy |',
      '| --- | --- | --- |',
      '| Hero | Hero Split | Partner with 8x8 |',
      '| Why | Split Content | Grow with us |',
    ].join('\n');
    assert.deepEqual(findNamedComponents(brief), ['Hero Split', 'Split Content']);
  });

  it('reads a labelled line, which is how a prose brief says it', () => {
    assert.deepEqual(findNamedComponents('Component: Split Content\nCopy: Grow with us'), ['Split Content']);
  });

  it('accepts Block, Module and Layout as the same instruction', () => {
    for (const label of ['Block', 'Module', 'Layout', 'Pattern']) {
      assert.deepEqual(findNamedComponents(`${label}: Content Split`), ['Content Split']);
    }
  });

  it('deduplicates by signature — a brief repeats a component per row', () => {
    const brief = [
      '| Component | Copy |',
      '| --- | --- |',
      '| Split Content | One |',
      '| split-content | Two |',
      '| Content Split | Three |',
    ].join('\n');
    assert.deepEqual(findNamedComponents(brief), ['Split Content']);
  });

  it('finds nothing in a table with no component column', () => {
    // The two-column decks we already handle. Reading the copy column as component names would send the
    // model to blocks nobody asked for while looking authoritative.
    const brief = ['| Section | New Copy |', '| --- | --- |', '| Hero | Partner with 8x8 |'].join('\n');
    assert.deepEqual(findNamedComponents(brief), []);
  });

  it('finds nothing in ordinary prose that happens to mention blocks', () => {
    assert.deepEqual(findNamedComponents('We want a hero, some cards, and a split content feel.'), []);
  });

  it('starts a new header hunt after the table ends', () => {
    const brief = [
      '| Section | Copy |',
      '| --- | --- |',
      '| Hero | Words |',
      '',
      '| Component | Copy |',
      '| --- | --- |',
      '| Content Split | More |',
    ].join('\n');
    assert.deepEqual(findNamedComponents(brief), ['Content Split']);
  });

  it('never returns the separator row as a name', () => {
    const brief = ['| Component |', '| --- |', '| Content Split |'].join('\n');
    assert.deepEqual(findNamedComponents(brief), ['Content Split']);
  });

  it('copes with empty input', () => {
    assert.deepEqual(findNamedComponents(''), []);
  });
});

describe('describeBriefComponents', () => {
  it('names the resolved id, so nothing is left to infer', () => {
    const text = describeBriefComponents(resolveBriefComponents(['Split Content'], CATALOG))!;
    assert.match(text, /"Split Content" is the `content-split` block \(Content Split\)/);
  });

  it('asks it to say what it substituted rather than doing it silently', () => {
    // The silent substitution *is* the bug: the brief asked for Split Content, got Simple Copy, and the
    // reply never mentioned the swap.
    const text = describeBriefComponents(resolveBriefComponents(['Zig Zag Timeline'], CATALOG))!;
    assert.match(text, /No block in this system matches "Zig Zag Timeline"/);
    assert.match(text, /do not\s+substitute silently/);
  });

  it('returns null when the brief named nothing, so ordinary copy gains no noise', () => {
    assert.equal(describeBriefComponents({ matched: [], unmatched: [] }), null);
  });
});

/**
 * Titles are not unique and ids are.
 *
 * The 8x8 registry has `content-split` and `feature` both titled "Content Split". A single
 * first-writer-wins map resolved "Split Content" to whichever came first — correctly, as it happened, and
 * for no better reason than insertion order.
 *
 * Found by calling the deployed MCP tool while checking the QA script, which is also how the original
 * "zero collisions" claim turned out to be wrong: it was measured against 70 built files on disk, not the
 * 77 components in the registry.
 */
describe('resolveBriefComponents with a duplicate title', () => {
  const withDuplicate = [
    { id: 'feature', title: 'Content Split' },
    { id: 'content-split', title: 'Content Split' },
  ];

  it('breaks the tie on the id, not on catalog order', () => {
    // `content-split`'s id signature IS "content split"; `feature`'s is "feature". A real distinction.
    assert.equal(resolveBriefComponents(['Split Content'], withDuplicate).matched[0]!.id, 'content-split');
    assert.equal(
      resolveBriefComponents(['Content Split'], [...withDuplicate].reverse()).matched[0]!.id,
      'content-split',
      'and the answer does not depend on which came first'
    );
  });

  it('reports a genuine clash as unmatched rather than picking one', () => {
    // Two components whose *titles* collide and neither id matches: nothing distinguishes them, so this
    // is a question rather than an answer.
    const twins = [
      { id: 'promo-a', title: 'Big Promo' },
      { id: 'promo-b', title: 'Big Promo' },
    ];
    const { matched, unmatched } = resolveBriefComponents(['Big Promo'], twins);
    assert.deepEqual(matched, []);
    assert.deepEqual(unmatched, ['Big Promo']);
  });

  it('still resolves an unambiguous name', () => {
    assert.equal(resolveBriefComponents(['Simple Copy'], CATALOG).matched[0]!.id, 'simple-copy');
  });
});
