import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNull, like, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { AdminBuildTaskRow } from '../admin-build-tasks-types';
import { usePostgres } from './dialect';
import { getDb } from './index';
import { offloadArtifactImages, isDataUrl } from '../storage/artifact-images';
import {
  componentBuildJobs,
  componentGenerationJobs,
  figmaFetchJobs,
  handoffAssetCollections,
  handoffAssets,
  handoffAssetBlobs,
  handoffAssetUsages,
  handoffIconSets,
  handoffComponents,
  handoffDesignArtifacts,
  handoffDesignGenerationJobs,
  handoffEventLog,
  handoffPatterns,
  handoffDesignWorkspace,
  handoffResourceGrants,
  handoffShareLinks,
  handoffReferenceMaterials,
  handoffTokensSnapshots,
  users,
} from './schema';

export const DESIGN_WORKSPACE_ID = 'default';

/** Returns the total number of registered users. Used to detect fresh/unconfigured deployments. */
export async function getUserCount(): Promise<number> {
  if (!usePostgres()) return 0;
  try {
    const db = getDb();
    const result = await db.select({ n: count() }).from(users);
    return Number(result[0]?.n ?? 0);
  } catch (err) {
    // At build time, swallow ANY error (missing tables, unreachable DB, malformed
    // DATABASE_URL) so page collection doesn't crash. Returning 0 means /setup
    // becomes the redirect target — harmless if no real users exist.
    // At runtime, swallow only 42P01 (undefined_table) so /setup is reachable
    // pre-migration; other errors should surface for diagnosis.
    const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build' || process.env.NEXT_PHASE === 'phase-export';
    const code = (err as { cause?: { code?: string } })?.cause?.code;
    if (isBuildPhase || code === '42P01') {
      const detail = code ?? (err instanceof Error ? err.message : String(err));
      console.warn(`[handoff] getUserCount failed (${detail}) — treating as 0 users.`);
      return 0;
    }
    throw err;
  }
}

export type UserDisplay = { id: string; name: string | null; email: string | null; image: string | null };

/**
 * Batched display lookup for a set of user ids — ONE query, keyed by id. Used to
 * attach owner attribution (name/image) to list/detail responses without an N+1.
 * Returns an empty map for empty input or non-postgres mode (defensive, like the
 * other queries here).
 */
export async function getUserDisplays(ids: string[]): Promise<Map<string, UserDisplay>> {
  const map = new Map<string, UserDisplay>();
  if (!usePostgres() || ids.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email, image: users.image })
    .from(users)
    .where(inArray(users.id, ids));
  for (const row of rows) {
    map.set(row.id, { id: row.id, name: row.name ?? null, email: row.email ?? null, image: row.image ?? null });
  }
  return map;
}

export type DesignWorkspaceRow = typeof handoffDesignWorkspace.$inferSelect;

export type DesignWorkspacePatch = {
  designMd?: string;
  brandVoice?: Record<string, string>;
  includeFoundations?: boolean;
  customFoundationImageUrl?: string;
  componentReferences?: Record<string, { imageUrl: string; updatedAt?: string }>;
};

export type { AdminBuildTaskRow };

export async function getDbComponents() {
  const db = getDb();
  return db.select().from(handoffComponents);
}

/**
 * Light list projection — metadata columns only, NO jsonb (`data`/`properties`/
 * `previews`). The menu and component-index views only need these fields; the
 * full-row `getDbComponents()` transferred every component's `data` blob (~97%
 * of which is `sharedStyles`) on every page load. Use this for list/menu paths;
 * reserve the full fetch for single-component detail.
 */
export async function getDbComponentSummaries() {
  const db = getDb();
  return db
    .select({
      id: handoffComponents.id,
      path: handoffComponents.path,
      title: handoffComponents.title,
      description: handoffComponents.description,
      group: handoffComponents.group,
      image: handoffComponents.image,
      type: handoffComponents.type,
    })
    .from(handoffComponents);
}

/** Fetch a single component row by id (full jsonb), instead of scanning all rows. */
export async function getDbComponentById(id: string) {
  const db = getDb();
  const rows = await db.select().from(handoffComponents).where(eq(handoffComponents.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getDbPatterns() {
  const db = getDb();
  return db.select().from(handoffPatterns);
}

export type DbPatternFilter = {
  source?: string;
  q?: string;
  group?: string;
};

export async function getDbPatternsFiltered(filters: DbPatternFilter) {
  const db = getDb();
  const clauses = [];
  if (filters.source?.trim()) {
    clauses.push(eq(handoffPatterns.source, filters.source.trim()));
  }
  if (filters.group?.trim()) {
    clauses.push(eq(handoffPatterns.group, filters.group.trim()));
  }
  const q = filters.q?.trim();
  if (q) {
    const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    if (usePostgres()) {
      clauses.push(or(ilike(handoffPatterns.title, like), ilike(handoffPatterns.description, like))!);
    } else {
      clauses.push(
        sql`(lower(${handoffPatterns.title}) like lower(${like}) escape '\\' or lower(${handoffPatterns.description}) like lower(${like}) escape '\\')`
      );
    }
  }
  if (clauses.length === 0) {
    return db.select().from(handoffPatterns).orderBy(desc(handoffPatterns.updatedAt));
  }
  return db
    .select()
    .from(handoffPatterns)
    .where(and(...clauses))
    .orderBy(desc(handoffPatterns.updatedAt));
}

export async function getDbPatternById(id: string) {
  const db = getDb();
  const [row] = await db.select().from(handoffPatterns).where(eq(handoffPatterns.id, id));
  return row ?? null;
}

export async function getRecentBuildJobs(limit = 50) {
  const db = getDb();
  return db
    .select()
    .from(componentBuildJobs)
    .orderBy(desc(componentBuildJobs.id))
    .limit(limit);
}

function assetsExtractionErrorFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const e = (metadata as Record<string, unknown>).assetsExtractionError;
  return typeof e === 'string' && e.trim() ? e.trim() : null;
}

/** Design artifacts that have run (or are running) composite asset extraction — excludes `assets_status = none`. */
export async function getRecentDesignArtifactAssetJobs(limit = 80) {
  const db = getDb();
  return db
    .select({
      id: handoffDesignArtifacts.id,
      title: handoffDesignArtifacts.title,
      assetsStatus: handoffDesignArtifacts.assetsStatus,
      createdAt: handoffDesignArtifacts.createdAt,
      updatedAt: handoffDesignArtifacts.updatedAt,
      metadata: handoffDesignArtifacts.metadata,
    })
    .from(handoffDesignArtifacts)
    .where(ne(handoffDesignArtifacts.assetsStatus, 'none'))
    .orderBy(desc(handoffDesignArtifacts.updatedAt))
    .limit(limit);
}

function adminBuildTaskSortTime(row: AdminBuildTaskRow): number {
  if (row.kind === 'component_build') {
    const t = row.completedAt ?? row.createdAt;
    if (t) return new Date(t).getTime();
    return row.jobId;
  }
  if (row.kind === 'component_generation') {
    const t = row.completedAt ?? row.createdAt;
    if (t) return new Date(t).getTime();
    return row.generationJobId;
  }
  if (row.kind === 'figma_fetch') {
    const t = row.completedAt ?? row.createdAt;
    if (t) return new Date(t).getTime();
    return row.jobId;
  }
  if (row.updatedAt) return new Date(row.updatedAt).getTime();
  if (row.createdAt) return new Date(row.createdAt).getTime();
  return 0;
}

/** Merged timeline for the admin Builds dashboard (component Vite jobs + design asset extraction). */
export async function getRecentComponentGenerationJobs(limit = 80) {
  const db = getDb();
  return db
    .select()
    .from(componentGenerationJobs)
    .orderBy(desc(componentGenerationJobs.id))
    .limit(limit);
}

export async function getMergedAdminBuildTasks(
  componentJobLimit = 100,
  artifactJobLimit = 100,
  generationJobLimit = 80,
  figmaFetchLimit = 30
): Promise<AdminBuildTaskRow[]> {
  const [jobs, artifacts, genJobs, fetchJobs] = await Promise.all([
    getRecentBuildJobs(componentJobLimit),
    getRecentDesignArtifactAssetJobs(artifactJobLimit),
    getRecentComponentGenerationJobs(generationJobLimit),
    listRecentFigmaFetchJobs(figmaFetchLimit),
  ]);

  const rows: AdminBuildTaskRow[] = [
    ...jobs.map(
      (j): AdminBuildTaskRow => ({
        kind: 'component_build',
        jobId: j.id,
        componentId: j.componentId,
        status: j.status,
        error: j.error ?? null,
        createdAt: j.createdAt ?? null,
        completedAt: j.completedAt ?? null,
      })
    ),
    ...artifacts.map(
      (a): AdminBuildTaskRow => ({
        kind: 'design_asset_extraction',
        artifactId: a.id,
        title: a.title || 'Untitled',
        status: a.assetsStatus,
        error: assetsExtractionErrorFromMetadata(a.metadata),
        createdAt: a.createdAt ?? null,
        updatedAt: a.updatedAt ?? null,
      })
    ),
    ...genJobs.map(
      (g): AdminBuildTaskRow => ({
        kind: 'component_generation',
        generationJobId: g.id,
        artifactId: g.artifactId,
        componentId: g.componentId,
        status: g.status,
        error: g.error ?? null,
        createdAt: g.createdAt ?? null,
        completedAt: g.completedAt ?? null,
        iteration: g.iteration,
        visualScore: g.visualScore != null ? Number(g.visualScore) : null,
      })
    ),
    ...fetchJobs.map(
      (f): AdminBuildTaskRow => ({
        kind: 'figma_fetch',
        jobId: f.id,
        triggeredByUserId: f.triggeredByUserId ?? null,
        status: f.status,
        error: f.error ?? null,
        createdAt: f.createdAt ?? null,
        completedAt: f.completedAt ?? null,
      })
    ),
  ];

  rows.sort((a, b) => adminBuildTaskSortTime(b) - adminBuildTaskSortTime(a));
  return rows;
}

/** Count jobs still in queue or actively building (used to cap concurrent builds). */
export async function countQueuedOrBuildingJobs(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(componentBuildJobs)
    .where(or(eq(componentBuildJobs.status, 'queued'), eq(componentBuildJobs.status, 'building')));
  return Number(row?.n ?? 0);
}

/**
 * Returns the latest tokens snapshot that carries Figma `localStyles` — the shape
 * the foundation visual displays read.
 *
 * The snapshot table is append-only and has historically received rows in two
 * shapes: the Figma `localStyles` snapshot (from POST /api/registry/tokens) and
 * DTCG-shaped objects (previously written by the dtcg push). Because `push:all`
 * runs the dtcg step after the tokens step, a naive "latest row" read returned the
 * DTCG row and the visual displays went blank. We scan recent rows and return the
 * newest one that actually has `localStyles`, so a DTCG row can never mask it.
 */
export async function getDbTokensSnapshot(): Promise<unknown | null> {
  const db = getDb();
  // Filter for the `localStyles` key in SQL and take only the newest match, so
  // we transfer one payload instead of pulling 25 full snapshots and scanning
  // them in memory. `jsonb_exists` is the function form of the `?` operator
  // (avoids the `?` placeholder ambiguity in the query string).
  const rows = await db
    .select({ payload: handoffTokensSnapshots.payload })
    .from(handoffTokensSnapshots)
    .where(sql`jsonb_exists(${handoffTokensSnapshots.payload}, 'localStyles')`)
    .orderBy(desc(handoffTokensSnapshots.id))
    .limit(1);
  return rows[0]?.payload ?? null;
}

export async function listRecentFigmaFetchJobs(limit = 50) {
  const db = getDb();
  return db.select().from(figmaFetchJobs).orderBy(desc(figmaFetchJobs.id)).limit(limit);
}

export async function insertFigmaFetchJob(triggeredByUserId: string): Promise<number> {
  const db = getDb();
  const [row] = await db.insert(figmaFetchJobs).values({ status: 'queued', triggeredByUserId }).returning({ id: figmaFetchJobs.id });
  return row.id;
}

export async function getFigmaFetchJob(jobId: number) {
  const db = getDb();
  const [row] = await db.select().from(figmaFetchJobs).where(eq(figmaFetchJobs.id, jobId));
  return row ?? null;
}

export async function countQueuedOrRunningFigmaFetchJobs(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ n: count() })
    .from(figmaFetchJobs)
    .where(or(eq(figmaFetchJobs.status, 'queued'), eq(figmaFetchJobs.status, 'running')));
  return Number(row?.n ?? 0);
}

export type AiEventRow = {
  id: number;
  createdAt: Date | null;
  eventType: string;
  status: string;
  model: string | null;
  provider: string | null;
  route: string | null;
  estimatedInputTokens: number | null;
  estimatedOutputTokens: number | null;
  estimatedCostUsd: number;
  requestPreview: string | null;
  error: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
};

export async function getAiEventsForRange({
  from,
  to,
  limit = 200,
}: {
  from: Date;
  to: Date;
  limit?: number;
}): Promise<AiEventRow[]> {
  if (!usePostgres()) return [];
  const db = getDb();
  const rows = await db
    .select({
      id: handoffEventLog.id,
      createdAt: handoffEventLog.createdAt,
      eventType: handoffEventLog.eventType,
      status: handoffEventLog.status,
      model: handoffEventLog.model,
      provider: handoffEventLog.provider,
      route: handoffEventLog.route,
      estimatedInputTokens: handoffEventLog.estimatedInputTokens,
      estimatedOutputTokens: handoffEventLog.estimatedOutputTokens,
      estimatedCostUsd: sql<string>`coalesce(${handoffEventLog.estimatedCostUsd}, 0)`,
      requestPreview: handoffEventLog.requestPreview,
      error: handoffEventLog.error,
      actorUserId: handoffEventLog.actorUserId,
      actorEmail: users.email,
      actorName: users.name,
    })
    .from(handoffEventLog)
    .leftJoin(users, eq(users.id, handoffEventLog.actorUserId))
    .where(and(eq(handoffEventLog.category, 'ai'), gte(handoffEventLog.createdAt, from), lte(handoffEventLog.createdAt, to)))
    .orderBy(desc(handoffEventLog.id))
    .limit(limit);
  return rows.map((row) => ({
    ...row,
    estimatedCostUsd: Number(row.estimatedCostUsd ?? 0),
  }));
}

export type AiCostSummary = {
  totalCalls: number;
  successCalls: number;
  failedCalls: number;
  totalCostUsd: number;
  byModel: { model: string; calls: number; totalCostUsd: number; failedCalls: number }[];
  byDay: { day: string; calls: number; totalCostUsd: number }[];
};

export async function getAiCostSummaryForRange({ from, to }: { from: Date; to: Date }): Promise<AiCostSummary> {
  if (!usePostgres()) {
    return { totalCalls: 0, successCalls: 0, failedCalls: 0, totalCostUsd: 0, byModel: [], byDay: [] };
  }
  const db = getDb();

  const [totals] = await db
    .select({
      totalCalls: count(),
      successCalls: sql<number>`count(*) filter (where ${handoffEventLog.status} = 'success')`,
      failedCalls: sql<number>`count(*) filter (where ${handoffEventLog.status} = 'error')`,
      totalCostUsd: sql<string>`coalesce(sum(${handoffEventLog.estimatedCostUsd}), 0)`,
    })
    .from(handoffEventLog)
    .where(and(eq(handoffEventLog.category, 'ai'), gte(handoffEventLog.createdAt, from), lte(handoffEventLog.createdAt, to)));

  const byModelRows = await db
    .select({
      model: sql<string>`coalesce(${handoffEventLog.model}, 'unknown')`,
      calls: count(),
      failedCalls: sql<number>`count(*) filter (where ${handoffEventLog.status} = 'error')`,
      totalCostUsd: sql<string>`coalesce(sum(${handoffEventLog.estimatedCostUsd}), 0)`,
    })
    .from(handoffEventLog)
    .where(and(eq(handoffEventLog.category, 'ai'), gte(handoffEventLog.createdAt, from), lte(handoffEventLog.createdAt, to)))
    .groupBy(sql`coalesce(${handoffEventLog.model}, 'unknown')`)
    .orderBy(desc(sql`coalesce(sum(${handoffEventLog.estimatedCostUsd}), 0)`));

  const byDayRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${handoffEventLog.createdAt}), 'YYYY-MM-DD')`,
      calls: count(),
      totalCostUsd: sql<string>`coalesce(sum(${handoffEventLog.estimatedCostUsd}), 0)`,
    })
    .from(handoffEventLog)
    .where(and(eq(handoffEventLog.category, 'ai'), gte(handoffEventLog.createdAt, from), lte(handoffEventLog.createdAt, to)))
    .groupBy(sql`date_trunc('day', ${handoffEventLog.createdAt})`)
    .orderBy(sql`date_trunc('day', ${handoffEventLog.createdAt})`);

  return {
    totalCalls: Number(totals?.totalCalls ?? 0),
    successCalls: Number(totals?.successCalls ?? 0),
    failedCalls: Number(totals?.failedCalls ?? 0),
    totalCostUsd: Number(totals?.totalCostUsd ?? 0),
    byModel: byModelRows.map((row) => ({
      model: row.model,
      calls: Number(row.calls ?? 0),
      failedCalls: Number(row.failedCalls ?? 0),
      totalCostUsd: Number(row.totalCostUsd ?? 0),
    })),
    byDay: byDayRows.map((row) => ({
      day: row.day,
      calls: Number(row.calls ?? 0),
      totalCostUsd: Number(row.totalCostUsd ?? 0),
    })),
  };
}

export type DesignArtifactInsert = {
  id?: string;
  title: string;
  description: string;
  status?: string;
  userId: string;
  imageUrl: string;
  sourceImages?: unknown;
  componentGuides?: unknown;
  foundationContext?: unknown;
  conversationHistory?: unknown;
  metadata?: unknown;
  assets?: unknown;
  assetsStatus?: string;
  componentSpec?: unknown;
  componentSpecMd?: string;
  specStatus?: string;
  publicAccess?: boolean;
  visibility?: string;
};

export async function insertDesignArtifact(input: DesignArtifactInsert) {
  const db = getDb();
  // Generate the id up front so Blob paths are scoped to it (Phase 1: offload
  // inline base64 images to Blob before persisting; passthrough when Blob is off).
  const id = input.id ?? crypto.randomUUID();
  const imaged = await offloadArtifactImages(
    {
      imageUrl: input.imageUrl,
      sourceImages: input.sourceImages,
      conversationHistory: input.conversationHistory,
      assets: input.assets,
    },
    id
  );
  const values: typeof handoffDesignArtifacts.$inferInsert = {
    id,
    title: input.title,
    description: input.description,
    status: input.status ?? 'review',
    userId: input.userId,
    imageUrl: imaged.imageUrl ?? '',
    sourceImages: (imaged.sourceImages ?? []) as Record<string, unknown>,
    componentGuides: (input.componentGuides ?? []) as Record<string, unknown>,
    foundationContext: (input.foundationContext ?? {}) as Record<string, unknown>,
    conversationHistory: (imaged.conversationHistory ?? []) as Record<string, unknown>,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
    assets: (imaged.assets ?? []) as typeof handoffDesignArtifacts.$inferInsert.assets,
    assetsStatus: input.assetsStatus ?? 'none',
    publicAccess: input.publicAccess ?? false,
  };
  // Optional fields: only set when provided so column defaults still apply otherwise.
  if (input.componentSpec !== undefined)
    values.componentSpec = input.componentSpec as typeof handoffDesignArtifacts.$inferInsert.componentSpec;
  if (input.componentSpecMd !== undefined) values.componentSpecMd = input.componentSpecMd;
  if (input.specStatus !== undefined) values.specStatus = input.specStatus;
  if (input.visibility !== undefined) values.visibility = input.visibility;
  const [row] = await db.insert(handoffDesignArtifacts).values(values).returning({ id: handoffDesignArtifacts.id });
  return row?.id ?? null;
}

export async function updateDesignArtifact(
  id: string,
  userId: string,
  patch: Partial<Omit<DesignArtifactInsert, 'id' | 'userId'>>
): Promise<boolean> {
  const db = getDb();
  const imaged = await offloadArtifactImages(
    {
      imageUrl: patch.imageUrl,
      sourceImages: patch.sourceImages,
      conversationHistory: patch.conversationHistory,
      assets: patch.assets,
    },
    id
  );
  const values: Partial<typeof handoffDesignArtifacts.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.imageUrl !== undefined) values.imageUrl = imaged.imageUrl as string;
  if (patch.sourceImages !== undefined) values.sourceImages = imaged.sourceImages as typeof handoffDesignArtifacts.$inferInsert.sourceImages;
  if (patch.componentGuides !== undefined)
    values.componentGuides = patch.componentGuides as typeof handoffDesignArtifacts.$inferInsert.componentGuides;
  if (patch.foundationContext !== undefined)
    values.foundationContext = patch.foundationContext as typeof handoffDesignArtifacts.$inferInsert.foundationContext;
  if (patch.conversationHistory !== undefined)
    values.conversationHistory = imaged.conversationHistory as typeof handoffDesignArtifacts.$inferInsert.conversationHistory;
  if (patch.metadata !== undefined) values.metadata = patch.metadata as typeof handoffDesignArtifacts.$inferInsert.metadata;
  if (patch.assets !== undefined) values.assets = imaged.assets as typeof handoffDesignArtifacts.$inferInsert.assets;
  if (patch.assetsStatus !== undefined) values.assetsStatus = patch.assetsStatus;
  if (patch.componentSpec !== undefined) values.componentSpec = patch.componentSpec as typeof handoffDesignArtifacts.$inferInsert.componentSpec;
  if (patch.componentSpecMd !== undefined) values.componentSpecMd = patch.componentSpecMd;
  if (patch.specStatus !== undefined) values.specStatus = patch.specStatus;
  if (patch.publicAccess !== undefined) values.publicAccess = patch.publicAccess;
  if (patch.visibility !== undefined) values.visibility = patch.visibility;
  const updated = await db
    .update(handoffDesignArtifacts)
    .set(values)
    .where(and(eq(handoffDesignArtifacts.id, id), eq(handoffDesignArtifacts.userId, userId)))
    .returning({ id: handoffDesignArtifacts.id });
  return updated.length > 0;
}

/** Update by id only (caller must enforce auth). Used for admin PATCH and background jobs. */
export async function updateDesignArtifactById(
  id: string,
  patch: Partial<Omit<DesignArtifactInsert, 'id' | 'userId'>>
): Promise<boolean> {
  const db = getDb();
  const imaged = await offloadArtifactImages(
    {
      imageUrl: patch.imageUrl,
      sourceImages: patch.sourceImages,
      conversationHistory: patch.conversationHistory,
      assets: patch.assets,
    },
    id
  );
  const values: Partial<typeof handoffDesignArtifacts.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.imageUrl !== undefined) values.imageUrl = imaged.imageUrl as string;
  if (patch.sourceImages !== undefined) values.sourceImages = imaged.sourceImages as typeof handoffDesignArtifacts.$inferInsert.sourceImages;
  if (patch.componentGuides !== undefined)
    values.componentGuides = patch.componentGuides as typeof handoffDesignArtifacts.$inferInsert.componentGuides;
  if (patch.foundationContext !== undefined)
    values.foundationContext = patch.foundationContext as typeof handoffDesignArtifacts.$inferInsert.foundationContext;
  if (patch.conversationHistory !== undefined)
    values.conversationHistory = imaged.conversationHistory as typeof handoffDesignArtifacts.$inferInsert.conversationHistory;
  if (patch.metadata !== undefined) values.metadata = patch.metadata as typeof handoffDesignArtifacts.$inferInsert.metadata;
  if (patch.assets !== undefined) values.assets = imaged.assets as typeof handoffDesignArtifacts.$inferInsert.assets;
  if (patch.assetsStatus !== undefined) values.assetsStatus = patch.assetsStatus;
  if (patch.componentSpec !== undefined) values.componentSpec = patch.componentSpec as typeof handoffDesignArtifacts.$inferInsert.componentSpec;
  if (patch.componentSpecMd !== undefined) values.componentSpecMd = patch.componentSpecMd;
  if (patch.specStatus !== undefined) values.specStatus = patch.specStatus;
  if (patch.publicAccess !== undefined) values.publicAccess = patch.publicAccess;
  if (patch.visibility !== undefined) values.visibility = patch.visibility;
  const updated = await db
    .update(handoffDesignArtifacts)
    .set(values)
    .where(eq(handoffDesignArtifacts.id, id))
    .returning({ id: handoffDesignArtifacts.id });
  return updated.length > 0;
}

export async function getDesignArtifactById(id: string) {
  const db = getDb();
  const [row] = await db.select().from(handoffDesignArtifacts).where(eq(handoffDesignArtifacts.id, id));
  return row ?? null;
}

/**
 * Light owner lookup — only `id` + `userId`, no JSONB blobs. Used by the
 * status subroute so the ownership check doesn't re-download the full artifact
 * on every poll tick (which would defeat `getDesignArtifactStatus`'s purpose).
 */
export async function getDesignArtifactOwnerId(id: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: handoffDesignArtifacts.id, userId: handoffDesignArtifacts.userId })
    .from(handoffDesignArtifacts)
    .where(eq(handoffDesignArtifacts.id, id))
    .limit(1);
  return row ?? null;
}

/** Atomically move `assets_status` from `pending` to `extracting`. Returns false if another worker claimed or status changed. */
export async function claimDesignArtifactForExtraction(id: string): Promise<boolean> {
  const db = getDb();
  const updated = await db
    .update(handoffDesignArtifacts)
    .set({ assetsStatus: 'extracting', updatedAt: new Date() })
    .where(and(eq(handoffDesignArtifacts.id, id), eq(handoffDesignArtifacts.assetsStatus, 'pending')))
    .returning({ id: handoffDesignArtifacts.id });
  return updated.length > 0;
}

/** Worker-only: finalize extraction without owner check. */
export async function finalizeDesignArtifactExtraction(
  id: string,
  opts: {
    assets: unknown[];
    assetsStatus: 'done' | 'failed';
    extractionError?: string | null;
  }
): Promise<void> {
  const db = getDb();
  const row = await getDesignArtifactById(id);
  const prevMeta =
    row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? { ...(row.metadata as Record<string, unknown>) }
      : {};
  if (opts.extractionError) prevMeta.assetsExtractionError = opts.extractionError;
  else delete prevMeta.assetsExtractionError;

  // Offload any inline base64 in extracted assets to Blob before persisting (Phase 1).
  const imaged = await offloadArtifactImages({ assets: opts.assets }, id);

  await db
    .update(handoffDesignArtifacts)
    .set({
      assets: (imaged.assets ?? opts.assets) as typeof handoffDesignArtifacts.$inferInsert.assets,
      assetsStatus: opts.assetsStatus,
      metadata: prevMeta as typeof handoffDesignArtifacts.$inferInsert.metadata,
      updatedAt: new Date(),
    })
    .where(eq(handoffDesignArtifacts.id, id));
}

/** True if any element of `arr` has an inline `data:` URL at `urlKey`. */
function arrayHasInlineImage(arr: unknown, urlKey: 'dataUrl' | 'imageUrl'): boolean {
  if (!Array.isArray(arr)) return false;
  return arr.some((item) => item && typeof item === 'object' && isDataUrl((item as Record<string, unknown>)[urlKey]));
}

export type BackfillArtifactBlobsResult = {
  processed: number;
  offloaded: number;
  skipped: number;
  nextCursor: string | null;
  done: boolean;
};

/**
 * Phase 1 backfill: for one batch of existing artifacts (ordered by `id` after
 * `cursor`), push any inline base64 images out to Blob. Direct writes here DO NOT
 * touch `updatedAt` so existing ordering is preserved. Per-row failures are caught
 * and counted as `skipped` so one bad row can't abort the batch. Caller must ensure
 * Blob is configured (offload is a no-op otherwise, so nothing would change).
 */
export async function backfillArtifactBlobsBatch(
  cursor: string | undefined,
  limit: number
): Promise<BackfillArtifactBlobsResult> {
  const db = getDb();
  const rows = await db
    .select()
    .from(handoffDesignArtifacts)
    .where(cursor ? gt(handoffDesignArtifacts.id, cursor) : undefined)
    .orderBy(asc(handoffDesignArtifacts.id))
    .limit(limit);

  let offloaded = 0;
  let skipped = 0;
  let nextCursor: string | null = cursor ?? null;

  for (const row of rows) {
    nextCursor = row.id;
    try {
      const hasInline =
        isDataUrl(row.imageUrl) ||
        arrayHasInlineImage(row.sourceImages, 'dataUrl') ||
        arrayHasInlineImage(row.conversationHistory, 'imageUrl') ||
        arrayHasInlineImage(row.assets, 'imageUrl');
      if (!hasInline) {
        skipped++;
        continue;
      }
      const imaged = await offloadArtifactImages(
        {
          imageUrl: row.imageUrl,
          sourceImages: row.sourceImages,
          conversationHistory: row.conversationHistory,
          assets: row.assets,
        },
        row.id
      );
      await db
        .update(handoffDesignArtifacts)
        .set({
          imageUrl: (imaged.imageUrl ?? row.imageUrl) as string,
          sourceImages: imaged.sourceImages as typeof handoffDesignArtifacts.$inferInsert.sourceImages,
          conversationHistory:
            imaged.conversationHistory as typeof handoffDesignArtifacts.$inferInsert.conversationHistory,
          assets: imaged.assets as typeof handoffDesignArtifacts.$inferInsert.assets,
        })
        .where(eq(handoffDesignArtifacts.id, row.id));
      offloaded++;
    } catch (err) {
      console.warn(
        '[handoff] artifact blob backfill failed for row',
        row.id,
        err instanceof Error ? err.message : String(err)
      );
      skipped++;
    }
  }

  const done = rows.length < limit;
  return { processed: rows.length, offloaded, skipped, nextCursor, done };
}

export type DesignArtifactListFilter = {
  status?: string;
  userId?: string;
  limit?: number;
};

export async function getDesignArtifacts(filter: DesignArtifactListFilter = {}) {
  const db = getDb();
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const clauses = [];
  if (filter.status?.trim()) {
    clauses.push(eq(handoffDesignArtifacts.status, filter.status.trim()));
  }
  if (filter.userId?.trim()) {
    clauses.push(eq(handoffDesignArtifacts.userId, filter.userId.trim()));
  }
  if (clauses.length === 0) {
    return db.select().from(handoffDesignArtifacts).orderBy(desc(handoffDesignArtifacts.updatedAt)).limit(limit);
  }
  return db
    .select()
    .from(handoffDesignArtifacts)
    .where(and(...clauses))
    .orderBy(desc(handoffDesignArtifacts.updatedAt))
    .limit(limit);
}

/**
 * Light list projection for the Library grid. Drops the heavy JSONB arrays
 * (`sourceImages`, `componentGuides`, `foundationContext`, `conversationHistory`,
 * `assets`, `componentSpec`, `componentSpecMd`) that `getDesignArtifacts()` pulls
 * as full rows — `conversationHistory` alone carries one base64 image PER iteration
 * turn, so a full-row list of 100 artifacts transfers many MB for a thumbnail grid.
 * `imageUrl` is retained (single final image; becomes a Blob URL in Phase 1).
 */
export async function getDesignArtifactSummaries(filter: DesignArtifactListFilter = {}) {
  const db = getDb();
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const cols = {
    id: handoffDesignArtifacts.id,
    title: handoffDesignArtifacts.title,
    description: handoffDesignArtifacts.description,
    status: handoffDesignArtifacts.status,
    userId: handoffDesignArtifacts.userId,
    imageUrl: handoffDesignArtifacts.imageUrl,
    assetsStatus: handoffDesignArtifacts.assetsStatus,
    specStatus: handoffDesignArtifacts.specStatus,
    publicAccess: handoffDesignArtifacts.publicAccess,
    metadata: handoffDesignArtifacts.metadata,
    createdAt: handoffDesignArtifacts.createdAt,
    updatedAt: handoffDesignArtifacts.updatedAt,
  };
  const clauses = [];
  if (filter.status?.trim()) {
    clauses.push(eq(handoffDesignArtifacts.status, filter.status.trim()));
  }
  if (filter.userId?.trim()) {
    clauses.push(eq(handoffDesignArtifacts.userId, filter.userId.trim()));
  }
  if (clauses.length === 0) {
    return db.select(cols).from(handoffDesignArtifacts).orderBy(desc(handoffDesignArtifacts.updatedAt)).limit(limit);
  }
  return db
    .select(cols)
    .from(handoffDesignArtifacts)
    .where(and(...clauses))
    .orderBy(desc(handoffDesignArtifacts.updatedAt))
    .limit(limit);
}

/**
 * Opaque, stable composite cursor over `(updated_at, id)`. Encodes the sort key
 * of the last row of a page so the next page can resume without skips or dupes
 * when several rows share an `updated_at` timestamp. base64url so it is URL-safe.
 */
export type DesignArtifactCursor = { updatedAt: Date; id: string };

export function encodeDesignArtifactCursor(row: { updatedAt: Date | string; id: string }): string {
  const iso = row.updatedAt instanceof Date ? row.updatedAt.toISOString() : new Date(row.updatedAt).toISOString();
  return Buffer.from(`${iso}|${row.id}`, 'utf8').toString('base64url');
}

export function decodeDesignArtifactCursor(raw: string): DesignArtifactCursor | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const sep = decoded.lastIndexOf('|');
    if (sep === -1) return null;
    const iso = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    const updatedAt = new Date(iso);
    if (!id || Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

export type DesignArtifactSummaryRow = Awaited<ReturnType<typeof getDesignArtifactSummaries>>[number];
export type DesignArtifactSummariesPage = {
  rows: DesignArtifactSummaryRow[];
  nextCursor: string | null;
};

/**
 * Cursor-paginated variant of `getDesignArtifactSummaries` for the Library grid.
 * Orders by `updated_at DESC, id DESC` (composite key matching the cursor) and
 * over-fetches one row to determine `hasMore`. Preserves the same owner/status
 * scoping and the same light projection (never the base64 JSONB columns).
 */
export async function getDesignArtifactSummariesPage(
  filter: DesignArtifactListFilter & { cursor?: string | null } = {}
): Promise<DesignArtifactSummariesPage> {
  const db = getDb();
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const cols = {
    id: handoffDesignArtifacts.id,
    title: handoffDesignArtifacts.title,
    description: handoffDesignArtifacts.description,
    status: handoffDesignArtifacts.status,
    userId: handoffDesignArtifacts.userId,
    imageUrl: handoffDesignArtifacts.imageUrl,
    assetsStatus: handoffDesignArtifacts.assetsStatus,
    specStatus: handoffDesignArtifacts.specStatus,
    publicAccess: handoffDesignArtifacts.publicAccess,
    metadata: handoffDesignArtifacts.metadata,
    createdAt: handoffDesignArtifacts.createdAt,
    updatedAt: handoffDesignArtifacts.updatedAt,
  };
  const clauses = [];
  if (filter.status?.trim()) {
    clauses.push(eq(handoffDesignArtifacts.status, filter.status.trim()));
  }
  if (filter.userId?.trim()) {
    clauses.push(eq(handoffDesignArtifacts.userId, filter.userId.trim()));
  }
  const cursor = filter.cursor ? decodeDesignArtifactCursor(filter.cursor) : null;
  if (cursor) {
    // Rows strictly "after" the cursor in `(updated_at DESC, id DESC)` order.
    clauses.push(
      or(
        lt(handoffDesignArtifacts.updatedAt, cursor.updatedAt),
        and(eq(handoffDesignArtifacts.updatedAt, cursor.updatedAt), lt(handoffDesignArtifacts.id, cursor.id))
      )
    );
  }
  const where = clauses.length ? and(...clauses) : undefined;
  const rows = await db
    .select(cols)
    .from(handoffDesignArtifacts)
    .where(where)
    .orderBy(desc(handoffDesignArtifacts.updatedAt), desc(handoffDesignArtifacts.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeDesignArtifactCursor(last) : null;
  return { rows: page, nextCursor };
}

/**
 * Status-only projection for the saved-design detail poll. The detail page polls
 * `assetsStatus`/`specStatus` every 4–5s; `getDesignArtifactById()` (SELECT *)
 * re-downloaded the entire multi-MB blob on every tick. Returns only what the
 * poll needs (incl. `assetsExtractionError` surfaced from metadata).
 */
export async function getDesignArtifactStatus(id: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: handoffDesignArtifacts.id,
      status: handoffDesignArtifacts.status,
      assetsStatus: handoffDesignArtifacts.assetsStatus,
      specStatus: handoffDesignArtifacts.specStatus,
      metadata: handoffDesignArtifacts.metadata,
      updatedAt: handoffDesignArtifacts.updatedAt,
    })
    .from(handoffDesignArtifacts)
    .where(eq(handoffDesignArtifacts.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    assetsStatus: row.assetsStatus,
    specStatus: row.specStatus,
    assetsExtractionError: assetsExtractionErrorFromMetadata(row.metadata),
    updatedAt: row.updatedAt,
  };
}

/** Reference materials for design-to-component LLM context. */
export async function listReferenceMaterials() {
  const db = getDb();
  return db.select().from(handoffReferenceMaterials).orderBy(handoffReferenceMaterials.id);
}

export async function getReferenceMaterialById(id: string) {
  const db = getDb();
  const [row] = await db.select().from(handoffReferenceMaterials).where(eq(handoffReferenceMaterials.id, id));
  return row ?? null;
}

export async function upsertReferenceMaterial(
  id: string,
  content: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  const db = getDb();
  const now = new Date();
  await db
    .insert(handoffReferenceMaterials)
    .values({ id, content, generatedAt: now, metadata })
    .onConflictDoUpdate({
      target: handoffReferenceMaterials.id,
      set: { content, generatedAt: now, metadata },
    });
}

export async function getDesignWorkspaceRow(): Promise<DesignWorkspaceRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(handoffDesignWorkspace)
    .where(eq(handoffDesignWorkspace.id, DESIGN_WORKSPACE_ID));
  return row ?? null;
}

export async function upsertDesignWorkspaceRow(
  patch: DesignWorkspacePatch,
  updatedByUserId: string | null
): Promise<DesignWorkspaceRow> {
  const db = getDb();
  const now = new Date();
  const existing = await getDesignWorkspaceRow();

  const values = {
    id: DESIGN_WORKSPACE_ID,
    designMd: patch.designMd ?? existing?.designMd ?? '',
    brandVoice: patch.brandVoice ?? (existing?.brandVoice as Record<string, string>) ?? {},
    includeFoundations: patch.includeFoundations ?? existing?.includeFoundations ?? true,
    customFoundationImageUrl: patch.customFoundationImageUrl ?? existing?.customFoundationImageUrl ?? '',
    componentReferences:
      patch.componentReferences ??
      (existing?.componentReferences as Record<string, { imageUrl: string; updatedAt?: string }>) ??
      {},
    updatedAt: now,
    updatedByUserId,
  };

  await db
    .insert(handoffDesignWorkspace)
    .values(values)
    .onConflictDoUpdate({
      target: handoffDesignWorkspace.id,
      set: {
        designMd: values.designMd,
        brandVoice: values.brandVoice,
        includeFoundations: values.includeFoundations,
        customFoundationImageUrl: values.customFoundationImageUrl,
        componentReferences: values.componentReferences,
        updatedAt: now,
        updatedByUserId,
      },
    });

  const row = await getDesignWorkspaceRow();
  return row!;
}

export type ComponentGenerationJobInsert = {
  artifactId: string;
  userId: string;
  componentId: string;
  renderer: string;
  maxIterations?: number;
  a11yStandard?: string;
  behaviorPrompt?: string;
  useExtractedAssets?: boolean;
};

export async function insertComponentGenerationJob(input: ComponentGenerationJobInsert): Promise<number> {
  const db = getDb();
  const [row] = await db
    .insert(componentGenerationJobs)
    .values({
      artifactId: input.artifactId,
      userId: input.userId,
      componentId: input.componentId,
      renderer: input.renderer,
      status: 'queued',
      maxIterations: input.maxIterations ?? 3,
      a11yStandard: input.a11yStandard ?? 'none',
      behaviorPrompt: input.behaviorPrompt ?? '',
      useExtractedAssets: input.useExtractedAssets ?? true,
    })
    .returning({ id: componentGenerationJobs.id });
  return row.id;
}

export async function getComponentGenerationJob(id: number) {
  const db = getDb();
  const [row] = await db.select().from(componentGenerationJobs).where(eq(componentGenerationJobs.id, id));
  return row ?? null;
}

export async function updateComponentGenerationJob(
  id: number,
  patch: Partial<{
    status: string;
    iteration: number;
    generationLog: unknown[];
    validationResults: Record<string, unknown>;
    visualScore: number | null;
    lastBuildJobId: number | null;
    error: string | null | undefined;
    completedAt: Date | null;
  }>
): Promise<void> {
  const db = getDb();
  const set: Partial<typeof componentGenerationJobs.$inferInsert> = {};
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.iteration !== undefined) set.iteration = patch.iteration;
  if (patch.generationLog !== undefined) set.generationLog = patch.generationLog as typeof componentGenerationJobs.$inferInsert.generationLog;
  if (patch.validationResults !== undefined)
    set.validationResults = patch.validationResults as typeof componentGenerationJobs.$inferInsert.validationResults;
  if (patch.visualScore !== undefined) set.visualScore = patch.visualScore != null ? String(patch.visualScore) : null;
  if (patch.lastBuildJobId !== undefined) set.lastBuildJobId = patch.lastBuildJobId;
  if (patch.error !== undefined) set.error = patch.error ?? null;
  if (patch.completedAt !== undefined) set.completedAt = patch.completedAt;
  await db.update(componentGenerationJobs).set(set).where(eq(componentGenerationJobs.id, id));
}

export async function getLatestComponentGenerationJobForArtifact(artifactId: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(componentGenerationJobs)
    .where(eq(componentGenerationJobs.artifactId, artifactId))
    .orderBy(desc(componentGenerationJobs.id))
    .limit(1);
  return row ?? null;
}

export type AiCostByUserRow = {
  userId: string | null;
  name: string | null;
  email: string | null;
  calls: number;
  failedCalls: number;
  totalCostUsd: number;
};

export async function getAiCostByUser({ from, to }: { from: Date; to: Date }): Promise<AiCostByUserRow[]> {
  if (!usePostgres()) return [];
  const db = getDb();
  const rows = await db
    .select({
      userId: handoffEventLog.actorUserId,
      name: users.name,
      email: users.email,
      calls: count(),
      failedCalls: sql<number>`count(*) filter (where ${handoffEventLog.status} = 'error')`,
      totalCostUsd: sql<string>`coalesce(sum(${handoffEventLog.estimatedCostUsd}), 0)`,
    })
    .from(handoffEventLog)
    .leftJoin(users, eq(users.id, handoffEventLog.actorUserId))
    .where(and(eq(handoffEventLog.category, 'ai'), gte(handoffEventLog.createdAt, from), lte(handoffEventLog.createdAt, to)))
    .groupBy(handoffEventLog.actorUserId, users.name, users.email)
    .orderBy(desc(sql`coalesce(sum(${handoffEventLog.estimatedCostUsd}), 0)`));

  return rows.map((r) => ({
    userId: r.userId,
    name: r.name ?? null,
    email: r.email ?? null,
    calls: Number(r.calls ?? 0),
    failedCalls: Number(r.failedCalls ?? 0),
    totalCostUsd: Number(r.totalCostUsd ?? 0),
  }));
}

// ── Design generation jobs ────────────────────────────────────────────────────

export type DesignGenerationJobInsert = {
  artifactId?: string | null;
  userId: string;
  requestParams: Record<string, unknown>;
};

export type DesignGenerationJobRow = typeof handoffDesignGenerationJobs.$inferSelect;

export async function insertDesignGenerationJob(input: DesignGenerationJobInsert): Promise<number> {
  const db = getDb();
  const [row] = await db
    .insert(handoffDesignGenerationJobs)
    .values({
      artifactId: input.artifactId ?? null,
      userId: input.userId,
      requestParams: input.requestParams,
    })
    .returning({ id: handoffDesignGenerationJobs.id });
  return row.id;
}

export async function getDesignGenerationJob(id: number): Promise<DesignGenerationJobRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(handoffDesignGenerationJobs)
    .where(eq(handoffDesignGenerationJobs.id, id))
    .limit(1);
  return row ?? null;
}

export async function updateDesignGenerationJob(
  id: number,
  patch: Partial<Pick<DesignGenerationJobRow, 'status' | 'stage' | 'imageUrl' | 'error' | 'artifactId'>>
): Promise<void> {
  const db = getDb();
  const values: Partial<typeof handoffDesignGenerationJobs.$inferInsert> = { updatedAt: new Date() };
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.stage !== undefined) values.stage = patch.stage;
  if (patch.imageUrl !== undefined) values.imageUrl = patch.imageUrl;
  if (patch.error !== undefined) values.error = patch.error;
  if (patch.artifactId !== undefined) values.artifactId = patch.artifactId;
  await db.update(handoffDesignGenerationJobs).set(values).where(eq(handoffDesignGenerationJobs.id, id));
}

export async function getActiveDesignGenerationJobsForUser(userId: string): Promise<DesignGenerationJobRow[]> {
  const db = getDb();
  return db
    .select()
    .from(handoffDesignGenerationJobs)
    .where(
      and(
        eq(handoffDesignGenerationJobs.userId, userId),
        or(
          eq(handoffDesignGenerationJobs.status, 'pending'),
          eq(handoffDesignGenerationJobs.status, 'running')
        )
      )
    )
    .orderBy(desc(handoffDesignGenerationJobs.createdAt))
    .limit(20);
}

/**
 * Fetch the oldest pending design generation jobs across all users, FIFO.
 * Drives the durable cron runner (`/api/handoff/ai/design-jobs/run`), which
 * processes detached MCP-queued jobs the way the SSE route processes inline ones.
 */
export async function getPendingDesignGenerationJobs(limit = 3): Promise<DesignGenerationJobRow[]> {
  const db = getDb();
  return db
    .select()
    .from(handoffDesignGenerationJobs)
    .where(eq(handoffDesignGenerationJobs.status, 'pending'))
    .orderBy(asc(handoffDesignGenerationJobs.createdAt))
    .limit(limit);
}

/** Delete a generation job row (e.g. dismissing a failed/stuck job). Owner-scoped. */
export async function deleteDesignGenerationJob(jobId: number, userId: string): Promise<boolean> {
  const db = getDb();
  const deleted = await db
    .delete(handoffDesignGenerationJobs)
    .where(and(eq(handoffDesignGenerationJobs.id, jobId), eq(handoffDesignGenerationJobs.userId, userId)))
    .returning({ id: handoffDesignGenerationJobs.id });
  return deleted.length > 0;
}

// ── Kill / force-fail stuck build tasks ──────────────────────────────────────

/** Mark a component Vite build job as failed (admin kill). Only affects queued/building rows. */
export async function killFigmaFetchJob(id: number): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(figmaFetchJobs)
    .set({ status: 'failed', error: 'Killed by admin', completedAt: new Date() })
    .where(and(eq(figmaFetchJobs.id, id), or(eq(figmaFetchJobs.status, 'queued'), eq(figmaFetchJobs.status, 'running'))))
    .returning({ id: figmaFetchJobs.id });
  return rows.length > 0;
}

export async function killComponentBuildJob(id: number): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(componentBuildJobs)
    .set({ status: 'failed', error: 'Killed by admin', completedAt: new Date() })
    .where(and(eq(componentBuildJobs.id, id), or(eq(componentBuildJobs.status, 'queued'), eq(componentBuildJobs.status, 'building'))))
    .returning({ id: componentBuildJobs.id });
  return rows.length > 0;
}

/** Mark a component generation job as failed (admin kill). Only affects non-terminal rows. */
export async function killComponentGenerationJob(id: number): Promise<boolean> {
  const db = getDb();
  const TERMINAL = ['complete', 'failed'];
  const [row] = await db.select({ status: componentGenerationJobs.status }).from(componentGenerationJobs).where(eq(componentGenerationJobs.id, id));
  if (!row || TERMINAL.includes(row.status)) return false;
  await updateComponentGenerationJob(id, { status: 'failed', error: 'Killed by admin', completedAt: new Date() });
  return true;
}

/** Mark a design asset extraction job as failed (admin kill). Only affects pending/extracting rows. */
export async function killDesignAssetExtractionJob(artifactId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ assetsStatus: handoffDesignArtifacts.assetsStatus, metadata: handoffDesignArtifacts.metadata })
    .from(handoffDesignArtifacts)
    .where(
      and(
        eq(handoffDesignArtifacts.id, artifactId),
        or(eq(handoffDesignArtifacts.assetsStatus, 'pending'), eq(handoffDesignArtifacts.assetsStatus, 'extracting'))
      )
    );
  if (!row) return false;
  const meta = (row.metadata as Record<string, unknown> | null) ?? {};
  await updateDesignArtifactById(artifactId, {
    assetsStatus: 'failed',
    // `assetsExtractionError` is the key the detail page and the Builds board read
    // (see assetsExtractionErrorFromMetadata) — writing anything else shows a failed
    // job with no reason.
    metadata: { ...meta, assetsExtractionError: 'Killed by admin' },
  });
  return true;
}

/**
 * Hard-delete one design artifact and the sharing rows that point at it.
 *
 * `handoff_resource_grant` and `handoff_share_link` address resources by
 * (`resource_type`, `resource_id`) text rather than a foreign key, so nothing cascades — without
 * this they would be left as orphans that a later artifact reusing the id could inherit.
 *
 * Authorization is the caller's responsibility (`permissions.canDelete`); this is the worker-level
 * primitive. Returns false when the artifact does not exist.
 */
export async function deleteDesignArtifactById(id: string): Promise<boolean> {
  const db = getDb();
  await db
    .delete(handoffResourceGrants)
    .where(and(eq(handoffResourceGrants.resourceType, 'design_artifact'), eq(handoffResourceGrants.resourceId, id)));
  await db
    .delete(handoffShareLinks)
    .where(and(eq(handoffShareLinks.resourceType, 'design_artifact'), eq(handoffShareLinks.resourceId, id)));
  const deleted = await db
    .delete(handoffDesignArtifacts)
    .where(eq(handoffDesignArtifacts.id, id))
    .returning({ id: handoffDesignArtifacts.id });
  return deleted.length > 0;
}

/** Non-terminal states for the two design-artifact background jobs. */
const STUCK_ASSET_STATUSES = ['pending', 'extracting'];
const STUCK_SPEC_STATUSES = ['pending', 'generating'];

/**
 * Sweep design-artifact jobs stranded in a non-terminal state into `failed`.
 *
 * Extraction and spec generation both run inside `after()` callbacks, which are bounded by
 * the serverless invocation. If the function dies between the claim (which sets `extracting`
 * / `generating`) and the finalize write — timeout, instance recycle, deploy — nothing else
 * ever moves the row, so the detail page and the Builds board poll it forever. Process death
 * is not catchable in-process, so an out-of-band sweep is the only durable guarantee. Driven
 * by the design-jobs cron.
 *
 * Age is measured from `updated_at`. An unrelated write to the artifact bumps that column and
 * restarts the clock, which can delay a reap but never strands a row permanently.
 */
export async function reapStuckDesignArtifactJobs(
  maxAgeMs: number = 15 * 60 * 1000
): Promise<{ extractions: number; specs: number }> {
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeMs);
  const reason = `Timed out — no progress for over ${Math.round(maxAgeMs / 60000)} minutes.`;

  const stale = or(lt(handoffDesignArtifacts.updatedAt, cutoff), isNull(handoffDesignArtifacts.updatedAt));

  const rows = await db
    .select({
      id: handoffDesignArtifacts.id,
      assetsStatus: handoffDesignArtifacts.assetsStatus,
      specStatus: handoffDesignArtifacts.specStatus,
      metadata: handoffDesignArtifacts.metadata,
    })
    .from(handoffDesignArtifacts)
    .where(
      and(
        stale,
        or(
          inArray(handoffDesignArtifacts.assetsStatus, STUCK_ASSET_STATUSES),
          inArray(handoffDesignArtifacts.specStatus, STUCK_SPEC_STATUSES)
        )
      )
    )
    .limit(200);

  let extractions = 0;
  let specs = 0;

  for (const row of rows) {
    const patch: Record<string, unknown> = {};
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    const nextMeta = { ...meta };

    // Flip only the status that is actually stuck — a row can have a healthy
    // extraction and a stranded spec, or vice versa.
    if (STUCK_ASSET_STATUSES.includes(row.assetsStatus)) {
      patch.assetsStatus = 'failed';
      nextMeta.assetsExtractionError = reason;
      extractions += 1;
    }
    if (STUCK_SPEC_STATUSES.includes(row.specStatus)) {
      patch.specStatus = 'failed';
      specs += 1;
    }
    if (Object.keys(patch).length === 0) continue;

    patch.metadata = nextMeta;
    await updateDesignArtifactById(row.id, patch as Parameters<typeof updateDesignArtifactById>[1]);
  }

  return { extractions, specs };
}

// ── Asset Inventory ───────────────────────────────────────────────────────────

// Collections

export async function listAssetCollections() {
  const db = getDb();
  return db.select().from(handoffAssetCollections).orderBy(handoffAssetCollections.name);
}

export async function getAssetCollection(id: string) {
  const db = getDb();
  const [row] = await db.select().from(handoffAssetCollections).where(eq(handoffAssetCollections.id, id));
  return row ?? null;
}

export async function insertAssetCollection(input: {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  sourceType?: string;
  figmaSectionId?: string | null;
  figmaFileKey?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const [row] = await db
    .insert(handoffAssetCollections)
    .values({ ...input, updatedAt: new Date() })
    .returning({ id: handoffAssetCollections.id });
  return row?.id ?? null;
}

export async function updateAssetCollection(
  id: string,
  patch: Partial<{ name: string; slug: string; description: string | null; metadata: Record<string, unknown> }>
) {
  const db = getDb();
  await db.update(handoffAssetCollections).set({ ...patch, updatedAt: new Date() }).where(eq(handoffAssetCollections.id, id));
}

// Icon Sets

export async function listIconSets() {
  const db = getDb();
  return db.select().from(handoffIconSets).orderBy(handoffIconSets.name);
}

export async function getIconSet(id: string) {
  const db = getDb();
  const [row] = await db.select().from(handoffIconSets).where(eq(handoffIconSets.id, id));
  return row ?? null;
}

export async function insertIconSet(input: {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  figmaComponentSetId?: string | null;
  figmaFileKey?: string | null;
}) {
  const db = getDb();
  const [row] = await db
    .insert(handoffIconSets)
    .values({ ...input, updatedAt: new Date() })
    .returning({ id: handoffIconSets.id });
  return row?.id ?? null;
}

// Assets

export type AssetInsert = {
  id: string;
  title: string;
  description?: string | null;
  altText?: string | null;
  assetType: string;
  mimeType?: string | null;
  fileSizeBytes?: number | null;
  nativeWidth?: number | null;
  nativeHeight?: number | null;
  storageUrl: string;
  storageKey?: string | null;
  thumbnailUrl?: string | null;
  svgContent?: string | null;
  iconSetId?: string | null;
  iconVariant?: string | null;
  collectionId?: string | null;
  sourceType?: string;
  sourceUrl?: string | null;
  sourceMetadata?: Record<string, unknown>;
  tags?: string[];
  status?: string;
  createdBy?: string | null;
};

export async function insertAsset(input: AssetInsert): Promise<string> {
  const db = getDb();
  const [row] = await db
    .insert(handoffAssets)
    .values({
      ...input,
      sourceMetadata: (input.sourceMetadata ?? {}) as typeof handoffAssets.$inferInsert.sourceMetadata,
      tags: (input.tags ?? []) as typeof handoffAssets.$inferInsert.tags,
      updatedAt: new Date(),
    })
    .returning({ id: handoffAssets.id });
  return row!.id;
}

export async function getAsset(id: string) {
  const db = getDb();
  const [row] = await db.select().from(handoffAssets).where(eq(handoffAssets.id, id));
  return row ?? null;
}

// ── DB-backed asset bytes (used when S3 is not configured) ───────────────────

/** Store/replace the raw bytes for an asset. */
export async function upsertAssetBlob(input: {
  assetId: string;
  /** Base64-encoded bytes */
  data: string;
  contentType: string;
  contentHash?: string | null;
}): Promise<void> {
  const db = getDb();
  await db
    .insert(handoffAssetBlobs)
    .values({
      assetId: input.assetId,
      data: input.data,
      contentType: input.contentType,
      contentHash: input.contentHash ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: handoffAssetBlobs.assetId,
      set: { data: input.data, contentType: input.contentType, contentHash: input.contentHash ?? null, updatedAt: new Date() },
    });
}

/** Fetch decoded bytes + content type for a DB-backed asset. */
export async function getAssetBlob(assetId: string): Promise<{ data: Buffer; contentType: string } | null> {
  const db = getDb();
  const [row] = await db
    .select({ data: handoffAssetBlobs.data, contentType: handoffAssetBlobs.contentType })
    .from(handoffAssetBlobs)
    .where(eq(handoffAssetBlobs.assetId, assetId))
    .limit(1);
  if (!row?.data) return null;
  return { data: Buffer.from(row.data, 'base64'), contentType: row.contentType };
}

/** Find an existing DB-backed asset by content hash (dedupe across components). */
export async function findAssetIdByContentHash(contentHash: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ assetId: handoffAssetBlobs.assetId })
    .from(handoffAssetBlobs)
    .where(eq(handoffAssetBlobs.contentHash, contentHash))
    .limit(1);
  return row?.assetId ?? null;
}

/**
 * Ingest a component-referenced image as a DB-backed library asset and link its
 * usage to the component. Idempotent: the asset id is content-addressed, so the
 * same image pushed by multiple components collapses to one asset + one blob,
 * with a usage row per component.
 */
export async function ingestFigmaFillAsset(input: {
  assetId: string;
  filename: string;
  mimeType: string;
  contentHash: string;
  /** Base64 bytes — required when S3 is not configured (DB blob path). */
  dataBase64?: string | null;
  /** Explicit CDN/S3 URL — when provided, overrides the /api/.../raw default and
   *  skips the DB blob write. Set this when uploading to S3. */
  storageUrl?: string | null;
  /** S3 object key — stored for lifecycle management and future invalidations. */
  storageKey?: string | null;
  /** CDN URL for the pre-generated thumbnail. */
  thumbnailUrl?: string | null;
  figmaFileKey: string;
  figmaImageRef: string;
  userId?: string | null;
}): Promise<void> {
  const db = getDb();
  const useS3 = Boolean(input.storageUrl);
  const resolvedStorageUrl = input.storageUrl ?? `/api/handoff/assets/${input.assetId}/raw`;

  await db
    .insert(handoffAssets)
    .values({
      id: input.assetId,
      title: input.filename,
      assetType: 'image',
      mimeType: input.mimeType,
      storageUrl: resolvedStorageUrl,
      storageKey: input.storageKey ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      sourceType: 'figma',
      sourceMetadata: {
        figmaFileKey: input.figmaFileKey,
        figmaImageRef: input.figmaImageRef,
      } as typeof handoffAssets.$inferInsert.sourceMetadata,
      status: 'active',
      createdBy: input.userId ?? null,
      tags: ['figma-image-fill'] as typeof handoffAssets.$inferInsert.tags,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: handoffAssets.id });

  if (!useS3 && input.dataBase64) {
    await upsertAssetBlob({
      assetId: input.assetId,
      data: input.dataBase64,
      contentType: input.mimeType,
      contentHash: input.contentHash,
    });
  }
}

export async function ingestReferencedImageAsset(input: {
  assetId: string;
  filename: string;
  mimeType: string;
  contentHash: string;
  dataBase64: string;
  componentId: string;
  refs: string[];
  userId?: string | null;
}): Promise<void> {
  const db = getDb();
  const storageUrl = `/api/handoff/assets/${input.assetId}/raw`;
  // Asset row — content-addressed + immutable, so do nothing on conflict.
  await db
    .insert(handoffAssets)
    .values({
      id: input.assetId,
      title: input.filename,
      assetType: 'image',
      mimeType: input.mimeType,
      storageUrl,
      sourceType: 'component',
      status: 'active',
      createdBy: input.userId ?? null,
      tags: ['component-referenced'] as typeof handoffAssets.$inferInsert.tags,
      updatedAt: new Date(),
    })
    .onConflictDoNothing({ target: handoffAssets.id });

  await upsertAssetBlob({
    assetId: input.assetId,
    data: input.dataBase64,
    contentType: input.mimeType,
    contentHash: input.contentHash,
  });

  await upsertAssetUsage({
    assetId: input.assetId,
    componentId: input.componentId,
    usageType: 'design_preview',
    notes: input.refs.length ? `Referenced as: ${input.refs.join(', ')}` : null,
  });
}

export async function getAssetWithUsages(id: string) {
  const db = getDb();
  const [asset] = await db.select().from(handoffAssets).where(eq(handoffAssets.id, id));
  if (!asset) return null;
  const usages = await db.select().from(handoffAssetUsages).where(eq(handoffAssetUsages.assetId, id));
  const collection = asset.collectionId
    ? await getAssetCollection(asset.collectionId)
    : null;
  const iconSet = asset.iconSetId ? await getIconSet(asset.iconSetId) : null;
  return { ...asset, usages, collection, iconSet };
}

export type AssetListFilter = {
  assetType?: string;
  collectionId?: string;
  iconSetId?: string;
  status?: string;
  search?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
};

export async function listAssets(filter: AssetListFilter = {}) {
  const db = getDb();
  const conditions = [];
  if (filter.assetType) conditions.push(eq(handoffAssets.assetType, filter.assetType));
  if (filter.collectionId) conditions.push(eq(handoffAssets.collectionId, filter.collectionId));
  if (filter.iconSetId) conditions.push(eq(handoffAssets.iconSetId, filter.iconSetId));
  if (filter.status) conditions.push(eq(handoffAssets.status, filter.status));
  if (filter.search) conditions.push(ilike(handoffAssets.title, `%${filter.search}%`));

  const limit = Math.min(filter.limit ?? 100, 500);
  const offset = filter.offset ?? 0;

  const rows = await db
    .select()
    .from(handoffAssets)
    .leftJoin(handoffAssetCollections, eq(handoffAssets.collectionId, handoffAssetCollections.id))
    .leftJoin(handoffIconSets, eq(handoffAssets.iconSetId, handoffIconSets.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(handoffAssets.updatedAt))
    .limit(limit)
    .offset(offset);

  let results = rows.map((r) => ({
    ...r.handoff_asset,
    collectionName: r.handoff_asset_collection?.name ?? null,
    iconSetName: r.handoff_icon_set?.name ?? null,
  }));

  if (filter.tags && filter.tags.length > 0) {
    const required = filter.tags;
    results = results.filter((r) => {
      const t = Array.isArray(r.tags) ? (r.tags as string[]) : [];
      return required.every((tag) => t.includes(tag));
    });
  }

  return results;
}

export async function updateAsset(
  id: string,
  patch: Partial<{
    title: string;
    description: string | null;
    altText: string | null;
    thumbnailUrl: string | null;
    storageUrl: string;
    fileSizeBytes: number | null;
    nativeWidth: number | null;
    nativeHeight: number | null;
    collectionId: string | null;
    iconSetId: string | null;
    iconVariant: string | null;
    tags: string[];
    status: string;
    sourceMetadata: Record<string, unknown>;
  }>
): Promise<boolean> {
  const db = getDb();
  const set: Partial<typeof handoffAssets.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.altText !== undefined) set.altText = patch.altText;
  if (patch.thumbnailUrl !== undefined) set.thumbnailUrl = patch.thumbnailUrl;
  if (patch.storageUrl !== undefined) set.storageUrl = patch.storageUrl;
  if (patch.fileSizeBytes !== undefined) set.fileSizeBytes = patch.fileSizeBytes;
  if (patch.nativeWidth !== undefined) set.nativeWidth = patch.nativeWidth;
  if (patch.nativeHeight !== undefined) set.nativeHeight = patch.nativeHeight;
  if (patch.collectionId !== undefined) set.collectionId = patch.collectionId;
  if (patch.iconSetId !== undefined) set.iconSetId = patch.iconSetId;
  if (patch.iconVariant !== undefined) set.iconVariant = patch.iconVariant;
  if (patch.tags !== undefined) set.tags = patch.tags as typeof handoffAssets.$inferInsert.tags;
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.sourceMetadata !== undefined) set.sourceMetadata = patch.sourceMetadata as typeof handoffAssets.$inferInsert.sourceMetadata;
  const rows = await db.update(handoffAssets).set(set).where(eq(handoffAssets.id, id)).returning({ id: handoffAssets.id });
  return rows.length > 0;
}

export async function deleteAsset(id: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db.select({ storageKey: handoffAssets.storageKey }).from(handoffAssets).where(eq(handoffAssets.id, id));
  if (!row) return null;
  await db.delete(handoffAssets).where(eq(handoffAssets.id, id));
  return row.storageKey;
}

// Asset usages

export type AssetUsageInsert = {
  assetId: string;
  componentId: string;
  usageType: string;
  propKey?: string | null;
  figmaContainerWidth?: number | null;
  figmaContainerHeight?: number | null;
  recommendedWidth?: number | null;
  recommendedHeight?: number | null;
  notes?: string | null;
};

export async function upsertAssetUsage(input: AssetUsageInsert): Promise<number> {
  const db = getDb();
  // Check for existing matching usage
  const [existing] = await db
    .select({ id: handoffAssetUsages.id })
    .from(handoffAssetUsages)
    .where(
      and(
        eq(handoffAssetUsages.assetId, input.assetId),
        eq(handoffAssetUsages.componentId, input.componentId),
        input.propKey ? eq(handoffAssetUsages.propKey, input.propKey) : sql`prop_key IS NULL`
      )
    );
  if (existing) {
    await db
      .update(handoffAssetUsages)
      .set({
        usageType: input.usageType,
        figmaContainerWidth: input.figmaContainerWidth ?? null,
        figmaContainerHeight: input.figmaContainerHeight ?? null,
        recommendedWidth: input.recommendedWidth ?? null,
        recommendedHeight: input.recommendedHeight ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(handoffAssetUsages.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(handoffAssetUsages)
    .values({ ...input, updatedAt: new Date() })
    .returning({ id: handoffAssetUsages.id });
  return row!.id;
}

export async function getAssetUsages(assetId: string) {
  const db = getDb();
  return db.select().from(handoffAssetUsages).where(eq(handoffAssetUsages.assetId, assetId));
}

export async function getComponentAssetUsages(componentId: string) {
  const db = getDb();
  const rows = await db
    .select()
    .from(handoffAssetUsages)
    .leftJoin(handoffAssets, eq(handoffAssetUsages.assetId, handoffAssets.id))
    .where(eq(handoffAssetUsages.componentId, componentId));
  // Flatten drizzle's join shape ({ handoff_asset_usage, handoff_asset }) into a
  // usage row with a nested `asset` (or null) for easy client consumption.
  return rows.map((r) => ({
    ...r.handoff_asset_usage,
    asset: r.handoff_asset ?? null,
  }));
}

export async function deleteAssetUsage(id: number): Promise<boolean> {
  const db = getDb();
  const rows = await db.delete(handoffAssetUsages).where(eq(handoffAssetUsages.id, id)).returning({ id: handoffAssetUsages.id });
  return rows.length > 0;
}
