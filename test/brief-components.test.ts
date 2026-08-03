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

  it('keeps every component distinguishable — no two entries collapse to one signature', () => {
    // A collision would make one component unreachable by name, silently.
    const seen = new Map<string, string>();
    for (const entry of CATALOG) {
      const key = signatureOf(entry.title);
      const clash = seen.get(key);
      assert.equal(clash, undefined, `${entry.id} and ${clash} share the signature "${key}"`);
      seen.set(key, entry.id);
    }
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
