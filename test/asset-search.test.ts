import assert from 'node:assert';
import { describe, it } from 'node:test';
import { looseMatchNote, searchTerms, shouldRetryLoosely, summarizeAssetRow } from '../src/app/lib/asset-search';

/**
 * The search was `ilike(title, '%query%')` — one substring, one column.
 *
 * So "lecture hall" matched nothing even where the library held "Students studying in university", and
 * the alt text, description and tags that describe each picture were never consulted. A real turn fired
 * eight searches, six came back empty, and the page shipped on placeholders against a 127-image library
 * that had campus photographs all along.
 *
 * Measuring first inverted my assumption: the eight calls cost 4KB, about 5k tokens replayed. The fan-out
 * was never the expense — it was the symptom.
 */
describe('searchTerms', () => {
  it('splits a phrase, because no asset title is ever a sentence', () => {
    assert.deepEqual(searchTerms('lecture hall'), ['lecture', 'hall']);
    assert.deepEqual(searchTerms('students on campus'), ['students', 'campus']);
  });

  it('drops words that narrow nothing', () => {
    assert.deepEqual(searchTerms('images of the team'), ['team']);
    assert.deepEqual(searchTerms('photo for a hero'), ['hero']);
  });

  it('drops fragments too short to narrow anything', () => {
    // `campus` survives; `uk` and `hq` are two letters and would match half the library.
    assert.deepEqual(searchTerms('UK campus hq'), ['campus']);
  });

  it('falls back rather than returning nothing when every word is too short', () => {
    // Not `[]`: an empty term list drops the search clause and returns the whole library as if it had all
    // matched. Searching the raw phrase finds little, which is honest; matching everything is not.
    assert.deepEqual(searchTerms('a UK hq'), ['a uk hq']);
  });

  it('deduplicates, so a repeated word is not matched twice', () => {
    assert.deepEqual(searchTerms('campus campus CAMPUS'), ['campus']);
  });

  it('is case and punctuation insensitive', () => {
    assert.deepEqual(searchTerms('Campus, Buildings!'), ['campus', 'buildings']);
  });

  it('falls back to the raw query rather than matching everything', () => {
    // Every word stopped or too short. An empty term list would drop the search clause entirely and
    // return the whole library as though it had all matched.
    assert.deepEqual(searchTerms('the of'), ['the of']);
    assert.deepEqual(searchTerms('hq'), ['hq']);
  });

  it('returns nothing for nothing', () => {
    assert.deepEqual(searchTerms(''), []);
    assert.deepEqual(searchTerms('   '), []);
  });
});

describe('shouldRetryLoosely', () => {
  it('retries when the precise pass found nothing', () => {
    assert.equal(shouldRetryLoosely(['lecture', 'hall'], 0), true);
  });

  it('does not retry when something was found', () => {
    assert.equal(shouldRetryLoosely(['lecture', 'hall'], 3), false);
  });

  it('does not retry a single term, where both passes are identical', () => {
    // Running the same query twice to get the same empty answer costs a round trip for nothing.
    assert.equal(shouldRetryLoosely(['campus'], 0), false);
    assert.equal(shouldRetryLoosely([], 0), false);
  });
});

describe('looseMatchNote', () => {
  it('says the match was partial, and what to do if nothing fits', () => {
    // A loose result is weaker evidence, and the model should be able to tell the difference before
    // putting it on a page.
    const note = looseMatchNote('lecture hall');
    assert.match(note, /No asset matched all of "lecture hall"/);
    assert.match(note, /say so rather than using a poor match/);
  });
});

/**
 * `handoff_search_assets` returned whole database rows. Measured on the 8x8 registry: 50 images came to
 * 102,000 characters, **59% of it `sourceMetadata`** — the full generation prompt and house-style
 * boilerplate repeated per asset, roughly 25k tokens for one search.
 */
describe('summarizeAssetRow', () => {
  const row = {
    id: 'img_abc123',
    title: 'Students on campus steps',
    assetType: 'image',
    mimeType: 'image/webp',
    storageUrl: '/api/handoff/assets/img_abc123/raw',
    altText: 'Students chatting on university steps',
    description: 'Three students on the steps of a university building',
    tags: ['generated', 'playground'],
    nativeWidth: 1536,
    nativeHeight: 1024,
    fileSizeBytes: 154810,
    storageKey: null,
    svgContent: '<svg>…thousands of characters…</svg>',
    sourceMetadata: { prompt: 'x'.repeat(2000), brief: 'y'.repeat(200), jobId: 121 },
    sourceType: 'upload',
    createdBy: '29fd45d9',
    createdAt: '2026-08-03T22:11:03.050Z',
    status: 'active',
    collectionName: null,
  };

  it('keeps what you need to choose an asset and place it', () => {
    const s = summarizeAssetRow(row);
    assert.equal(s.id, 'img_abc123');
    assert.equal(s.storageUrl, '/api/handoff/assets/img_abc123/raw');
    assert.equal(s.altText, 'Students chatting on university steps');
    assert.match(String(s.description), /Three students/);
    assert.deepEqual(s.tags, ['generated', 'playground']);
    assert.equal(s.width, 1536);
    assert.equal(s.height, 1024);
  });

  it('drops the generation prompt, which was most of the payload', () => {
    const json = JSON.stringify(summarizeAssetRow(row));
    assert.ok(!json.includes('sourceMetadata'));
    assert.ok(!json.includes('x'.repeat(50)), 'no prompt text survives');
  });

  it('drops svgContent — a search for fifty icons would return fifty SVGs', () => {
    assert.ok(!JSON.stringify(summarizeAssetRow(row)).includes('<svg'));
  });

  it('drops bookkeeping nobody chooses an asset by', () => {
    const json = JSON.stringify(summarizeAssetRow(row));
    for (const gone of ['createdBy', 'createdAt', 'storageKey', 'sourceType', 'status']) {
      assert.ok(!json.includes(gone), `${gone} should not be in a search summary`);
    }
  });

  it('is dramatically smaller than the row it came from', () => {
    const before = JSON.stringify(row).length;
    const after = JSON.stringify(summarizeAssetRow(row)).length;
    assert.ok(after < before / 5, `${after} should be well under a fifth of ${before}`);
  });

  it('omits collection and icon-set keys when unset, rather than carrying nulls per row', () => {
    assert.ok(!('collectionName' in summarizeAssetRow(row)));
    assert.equal(summarizeAssetRow({ ...row, collectionName: 'Campus' }).collectionName, 'Campus');
  });

  it('survives a row with almost nothing in it', () => {
    const s = summarizeAssetRow({ id: 'img_x' });
    assert.equal(s.id, 'img_x');
    assert.equal(s.title, '');
    assert.equal(s.width, null);
    assert.deepEqual(s.tags, []);
  });
});
