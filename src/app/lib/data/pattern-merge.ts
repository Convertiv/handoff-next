import type { PatternListObject } from '@handoff/transformers/preview/types';

/**
 * Pure helpers for merging and shaping pattern (playground page) lists.
 *
 * Extracted from `dynamic-provider.ts` for the same reason `menu-merge.ts` was: that module pulls the
 * full Next graph, so nothing inside it can be unit-tested. These are the parts worth testing — they
 * are exactly where a single malformed row took down the entire list.
 */

/** The columns these helpers read. Structural, so a Drizzle row satisfies it without importing the schema. */
export type PatternRowish = {
  id: string;
  title?: string | null;
  path?: string | null;
  description?: string | null;
  group?: string | null;
  tags?: unknown;
  components?: unknown;
  data?: unknown;
};

/**
 * Sort comparator for merged catalog lists.
 *
 * Coerces rather than throws. `(a.title || a.id).localeCompare(...)` blew up the whole pattern list
 * with `Cannot read properties of undefined (reading 'localeCompare')` because one row carried a `data`
 * blob with neither field — so a single malformed page made *every* page unlistable, over MCP and in
 * the UI alike. A list should degrade on a bad row, not die on it.
 */
export function byDisplayName(
  a: { title?: string | null; name?: string | null; id?: string | null },
  b: { title?: string | null; name?: string | null; id?: string | null }
): number {
  const key = (x: { title?: string | null; name?: string | null; id?: string | null }) =>
    String(x.title || x.name || x.id || '');
  return key(a).localeCompare(key(b));
}

/**
 * Project a DB pattern row onto the list shape.
 *
 * Backfills `id`/`title` from the row's own columns rather than trusting the `data` blob wholesale. A
 * payload missing those fields — a partially-written page, or one saved in an older shape — previously
 * produced an entry with neither, which is what the sort then choked on.
 */
export function patternListFromRow(r: PatternRowish): PatternListObject {
  if (r.data && typeof r.data === 'object') {
    const data = r.data as Partial<PatternListObject>;
    return { ...data, id: data.id ?? r.id, title: data.title ?? r.title ?? r.id } as PatternListObject;
  }
  return {
    id: r.id,
    path: r.path ?? `/system/pattern/${r.id}`,
    title: r.title ?? r.id,
    description: r.description ?? '',
    group: r.group ?? '',
    tags: (r.tags as string[]) ?? [],
    components: (r.components as PatternListObject['components']) ?? [],
  } as PatternListObject;
}

/** Merge the filesystem list with DB rows, DB winning where it carries a payload. */
export function mergePatternLists(staticList: PatternListObject[], dbRows: PatternRowish[]): PatternListObject[] {
  const merged = new Map<string, PatternListObject>();
  for (const item of staticList) {
    merged.set(item.id, item);
  }
  for (const r of dbRows) {
    if (r.data && typeof r.data === 'object') {
      merged.set(r.id, patternListFromRow(r));
    } else if (!merged.has(r.id)) {
      merged.set(r.id, patternListFromRow(r));
    }
  }
  return [...merged.values()].sort(byDisplayName);
}
