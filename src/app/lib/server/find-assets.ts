import 'server-only';

import { listAssets } from '@/lib/db/queries';
import { searchTerms, shouldRetryLoosely } from '@/lib/asset-search';

/**
 * Asset search with the precise-then-loose policy, in one place.
 *
 * The policy lived inline in the playground chat's `search_assets` handler, so MCP's
 * `handoff_search_assets` had the multi-field term matching — it goes through `listAssets` — and none of
 * the fallback. Two callers with different behaviour for the same question, which is the most expensive
 * recurring bug in this codebase: capabilities not reaching the row, MCP running a duplicate scaffold
 * loop, the editor and the scaffold describing one field differently, the edits handler re-deriving field
 * names the merge had already corrected.
 *
 * Shaping stays with the caller. The chat returns `{ id, name, src, alt, attached }` and folds in the
 * user's attachments; MCP returns whole rows. Those differences are real. The *policy* is not.
 */

export interface FoundAssets<T> {
  rows: T[];
  /**
   * True when the precise pass found nothing and these came from the loose one.
   *
   * Surfaced because a loose match is weaker evidence — "students" returned for "lecture hall" may be the
   * right picture or merely the nearest one, and a caller should be able to say so rather than presenting
   * it as an answer.
   */
  loose: boolean;
}

type AssetFilter = Parameters<typeof listAssets>[0];

/**
 * Every term must match, and if nothing does, any term will do.
 *
 * Coming back empty is the expensive outcome, not an imprecise result. Measured on one real turn: eight
 * searches, six of them empty, a page that shipped on placeholders, and a 127-image library that had the
 * photographs all along.
 *
 * The loose pass is skipped for a single term, where both passes are identical — see
 * `shouldRetryLoosely`.
 */
export async function findAssets(filter: AssetFilter = {}): Promise<FoundAssets<Awaited<ReturnType<typeof listAssets>>[number]>> {
  const query = typeof filter.search === 'string' ? filter.search.trim() : '';
  const precise = await listAssets(query ? { ...filter, search: query } : { ...filter, search: undefined });
  if (precise.length || !query) return { rows: precise, loose: false };

  if (!shouldRetryLoosely(searchTerms(query), precise.length)) return { rows: precise, loose: false };

  const loose = await listAssets({ ...filter, search: query, searchMode: 'any' });
  return { rows: loose, loose: loose.length > 0 };
}
