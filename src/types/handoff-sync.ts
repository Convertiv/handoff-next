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

/** Granular change classification for selective pull. */
export type SyncChangeType = 'metadata_updated' | 'source_updated' | 'artifacts_updated' | 'full';

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
  /** Built preview artifacts from components/[id]/dist/ keyed by basename */
  buildArtifacts?: Record<string, string>;
  /** Handoff-layer source files from components/[id]/ (excl. dist/) keyed by relative path */
  sourceFiles?: Record<string, string>;
  /**
   * Workspace images referenced by this component (resolved + content-addressed).
   * The server ingests these as library assets and links usages; references in
   * buildArtifacts are already rewritten to each asset's served URL.
   */
  referencedImages?: ReferencedImagePayload[];
  /** Granular change classification for selective pull */
  changeType?: SyncChangeType;
  source?: string;
};

export type ReferencedImagePayload = {
  /** Content-addressed asset id: `img_<sha256[:12]>` */
  assetId: string;
  filename: string;
  contentHash: string;
  mime: string;
  /** Base64-encoded bytes */
  dataBase64: string;
  /** Original reference strings (for usage notes/propKey) */
  refs: string[];
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
  /** Built preview files from `public/api/pattern/` keyed by basename */
  buildArtifacts?: Record<string, string>;
  source?: string;
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
