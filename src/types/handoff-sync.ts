/**
 * Shared wire format for online/local sync (API + CLI).
 * Keep this file free of Next.js / Drizzle imports so the root `tsc` build can compile CLI code.
 */

export type SyncEntityType = 'page' | 'component' | 'pattern';

export type SyncAction = 'create' | 'update' | 'delete';

/** Payload shapes per entity (stored in `sync_event.payload` and returned in `SyncChange.data`). */
export type PageSyncData = {
  slug: string;
  frontmatter: Record<string, unknown>;
  markdown: string;
};

export type ComponentSyncData = {
  id: string;
  title?: string;
  description?: string;
  group?: string;
  type?: string;
  path?: string;
  image?: string;
  properties?: unknown;
  previews?: unknown;
  /** Full component row / `ComponentObject` for round-trip */
  data?: Record<string, unknown>;
  /** Serialized `.handoff` declaration when pushing from local */
  handoffConfig?: Record<string, unknown>;
};

export type PatternSyncData = {
  id: string;
  title?: string;
  description?: string;
  group?: string;
  tags?: unknown;
  components?: unknown;
  data?: Record<string, unknown>;
  handoffConfig?: Record<string, unknown>;
};

export type SyncChangeData = PageSyncData | ComponentSyncData | PatternSyncData | Record<string, unknown> | null;

export interface SyncChange {
  /** Monotonic sync cursor — matches `sync_event.id` */
  version: number;
  entityType: SyncEntityType;
  entityId: string;
  action: SyncAction;
  updatedAt: string;
  data: SyncChangeData;
}

export interface SyncChangeset {
  /** Highest `sync_event.id` in the database (cursor for `sync:status` / next pull baseline) */
  version: number;
  changes: SyncChange[];
}

export interface SyncStatusResponse {
  latestVersion: number;
  counts: {
    components: number;
    patterns: number;
    pages: number;
    syncEvents: number;
  };
}

/** Request body for `POST /api/sync/upload` */
export interface SyncUploadBody {
  changes: Array<{
    entityType: SyncEntityType;
    entityId: string;
    action: SyncAction;
    data?: SyncChangeData;
  }>;
}
