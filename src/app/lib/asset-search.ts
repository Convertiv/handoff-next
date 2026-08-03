/**
 * How an asset search matches.
 *
 * Measured, after assuming the opposite: a turn firing eight `search_assets` calls is not expensive —
 * 4KB of payload, roughly 5k tokens once replayed. It fires eight because **six of them come back
 * empty**, against a 127-image library that plainly has what was asked for.
 *
 * The reason was one line: `ilike(title, '%query%')`. A single substring match, on the title alone. So
 * "lecture hall" matches nothing even where the library holds "Students studying in university", and
 * `altText`, `description` and `tags` — all populated, all describing the picture — were never consulted.
 * The model searched, got nothing, rephrased, got nothing, and the page shipped on placeholders. That is
 * the remaining red on `fresh-page-with-imagery` and a good part of the imagery complaints.
 *
 * Pure: the term splitting and the fallback policy are the parts worth arguing about, and they are
 * testable without a database. The SQL that consumes them lives in `queries.ts`.
 */

/**
 * Words too common to narrow anything.
 *
 * Kept deliberately short. An over-eager stop list turns "images of the team" into nothing at all, and
 * the failure being fixed here is precisely a search that returns nothing.
 */
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'for',
  'and',
  'or',
  'with',
  'in',
  'on',
  'at',
  'to',
  'image',
  'images',
  'photo',
  'photos',
  'picture',
  'pictures',
]);

/**
 * The words a query should match on.
 *
 * Split rather than matched whole, because a phrase match is what made the search useless: a person or a
 * model types "lecture hall" or "students on campus", and no asset title is ever that sentence.
 *
 * Short words are dropped — a two-letter fragment matches half the library and narrows nothing. If every
 * word is stopped or too short, the original query comes back as a single term, so "the of" still
 * searches for something rather than silently matching everything.
 */
export function assetSearchTerms(query: string): string[] {
  const words = (query ?? '').toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const terms = [...new Set(words.filter((w) => w.length > 2 && !STOP_WORDS.has(w)))];
  if (terms.length) return terms;

  const fallback = (query ?? '').trim().toLowerCase();
  return fallback ? [fallback] : [];
}

/**
 * How strictly the terms must match.
 *
 * `all` is the precise pass — every term somewhere in the asset's text. `any` is the loose pass, run only
 * when `all` found nothing, so a search never comes back empty while relevant assets exist. Returning
 * nothing is the expensive outcome: it costs a round, an invented src, or a placeholder that ships.
 */
export type AssetSearchMode = 'all' | 'any';

/**
 * Whether a loose second pass is worth running.
 *
 * Only when the precise pass found nothing *and* there was more than one term — with a single term the
 * two passes are identical, and running it twice is a wasted query.
 */
export function shouldRetryLoosely(terms: string[], preciseHits: number): boolean {
  return preciseHits === 0 && terms.length > 1;
}

/**
 * A note for the model when results came from the loose pass.
 *
 * Said plainly because a loose match is weaker evidence: "students" returned for "lecture hall" may be
 * the right picture or merely the nearest one, and the model should be able to tell the difference before
 * putting it on a page.
 */
export function looseMatchNote(query: string): string {
  return (
    `No asset matched all of "${query}", so these match some of it. Check the names before using one — ` +
    'if none of them fit, say so rather than using a poor match.'
  );
}
