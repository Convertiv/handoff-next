import type { PatternListObject, PatternObject } from '@handoff/transformers/preview/types';
import type { handoffPatterns } from '../db/schema';

type PatternRow = typeof handoffPatterns.$inferSelect;

/** Extra fields returned by `/api/handoff/patterns` for the browser UI. */
export type PatternListApiEntry = PatternListObject & {
  _source: string;
  /** `page` | `template` | `brief` — what it is, as opposed to `_source`, which is how it got here. */
  _kind: string;
  _thumbnail: string | null;
  _userId: string | null;
  _createdAt: string | null;
  _updatedAt: string | null;
  _componentCount: number;
  /** Sharing visibility (Phase B): private | shared | team | public. */
  visibility: string;
  /** Lifecycle status (Phase B): prototype | draft | review | approved | archived. */
  status: string;
};

/** Full row payload for playground load (includes `data` previews block). */
export type PatternDetailApiResponse = {
  id: string;
  path: string | null;
  title: string;
  description: string | null;
  group: string | null;
  tags: unknown;
  components: PatternObject['components'];
  data: Record<string, unknown>;
  source: string;
  /**
   * ⚠️ These three were missing, and their absence was invisible.
   *
   * `MetaControl` reads this response and falls back to `private` / `draft` when a field is absent — so the
   * control has been showing every page as private-and-draft whatever the row said, and only looked right
   * because the first thing anyone does with it is set a value. `kind` would have inherited exactly the same
   * bug. A settings control that silently misreports the current setting is worse than one that fails to load.
   */
  visibility: string;
  status: string;
  kind: string;
  thumbnail: string | null;
  userId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export function patternRowToListEntry(row: PatternRow, basePath: string): PatternListApiEntry {
  const fromData =
    row.data && typeof row.data === 'object' && row.data !== null ? (row.data as Partial<PatternListObject>) : {};
  const components = (row.components as PatternObject['components']) ?? fromData.components ?? [];
  return {
    id: row.id,
    path: row.path ?? fromData.path ?? `${basePath}/api/pattern/${row.id}.json`,
    title: row.title || fromData.title || row.id,
    description: row.description ?? fromData.description,
    group: row.group ?? fromData.group,
    tags: (row.tags as string[] | undefined) ?? fromData.tags,
    components,
    url: fromData.url,
    _source: row.source,
    _kind: row.kind ?? 'page',
    _thumbnail: row.thumbnail ?? null,
    _userId: row.userId ?? null,
    _createdAt: row.createdAt?.toISOString?.() ?? null,
    _updatedAt: row.updatedAt?.toISOString?.() ?? null,
    _componentCount: Array.isArray(components) ? components.length : 0,
    visibility: row.visibility,
    status: row.status,
  };
}

export function patternRowToDetailResponse(row: PatternRow, basePath: string): PatternDetailApiResponse {
  const entry = patternRowToListEntry(row, basePath);
  const data =
    row.data && typeof row.data === 'object' && row.data !== null ? (row.data as Record<string, unknown>) : {};
  return {
    id: entry.id,
    path: row.path,
    title: entry.title,
    description: row.description ?? null,
    group: row.group ?? null,
    tags: row.tags,
    components: entry.components,
    data,
    source: row.source,
    visibility: row.visibility,
    status: row.status,
    kind: row.kind ?? 'page',
    thumbnail: row.thumbnail ?? null,
    userId: row.userId ?? null,
    createdAt: row.createdAt?.toISOString() ?? null,
    updatedAt: row.updatedAt?.toISOString() ?? null,
  };
}
