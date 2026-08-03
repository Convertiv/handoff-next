import assert from 'node:assert';
import { describe, it } from 'node:test';
import { assetSearchTerms, looseMatchNote, shouldRetryLoosely } from '../src/app/lib/asset-search';

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
describe('assetSearchTerms', () => {
  it('splits a phrase, because no asset title is ever a sentence', () => {
    assert.deepEqual(assetSearchTerms('lecture hall'), ['lecture', 'hall']);
    assert.deepEqual(assetSearchTerms('students on campus'), ['students', 'campus']);
  });

  it('drops words that narrow nothing', () => {
    assert.deepEqual(assetSearchTerms('images of the team'), ['team']);
    assert.deepEqual(assetSearchTerms('photo for a hero'), ['hero']);
  });

  it('drops fragments too short to narrow anything', () => {
    // `campus` survives; `uk` and `hq` are two letters and would match half the library.
    assert.deepEqual(assetSearchTerms('UK campus hq'), ['campus']);
  });

  it('falls back rather than returning nothing when every word is too short', () => {
    // Not `[]`: an empty term list drops the search clause and returns the whole library as if it had all
    // matched. Searching the raw phrase finds little, which is honest; matching everything is not.
    assert.deepEqual(assetSearchTerms('a UK hq'), ['a uk hq']);
  });

  it('deduplicates, so a repeated word is not matched twice', () => {
    assert.deepEqual(assetSearchTerms('campus campus CAMPUS'), ['campus']);
  });

  it('is case and punctuation insensitive', () => {
    assert.deepEqual(assetSearchTerms('Campus, Buildings!'), ['campus', 'buildings']);
  });

  it('falls back to the raw query rather than matching everything', () => {
    // Every word stopped or too short. An empty term list would drop the search clause entirely and
    // return the whole library as though it had all matched.
    assert.deepEqual(assetSearchTerms('the of'), ['the of']);
    assert.deepEqual(assetSearchTerms('hq'), ['hq']);
  });

  it('returns nothing for nothing', () => {
    assert.deepEqual(assetSearchTerms(''), []);
    assert.deepEqual(assetSearchTerms('   '), []);
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
