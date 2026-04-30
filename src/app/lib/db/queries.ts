import { and, count, desc, eq, gte, ilike, lte, ne, or, sql } from 'drizzle-orm';
import type { AdminBuildTaskRow } from '../admin-build-tasks-types';
import { getDb } from './index';
import {
  componentBuildJobs,
  figmaFetchJobs,
  handoffComponents,
  handoffDesignArtifacts,
  handoffEventLog,
  handoffPatterns,
  handoffTokensSnapshots,
  users,
} from './schema';

export type { AdminBuildTaskRow };

export async function getDbComponents() {
  const db = getDb();
  if (!db) return [];
  return db.select().from(handoffComponents);
}

export async function getDbPatterns() {
  const db = getDb();
  if (!db) return [];
  return db.select().from(handoffPatterns);
}

export type DbPatternFilter = {
  source?: string;
  q?: string;
  group?: string;
};

export async function getDbPatternsFiltered(filters: DbPatternFilter) {
  const db = getDb();
  if (!db) return [];
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
    clauses.push(or(ilike(handoffPatterns.title, like), ilike(handoffPatterns.description, like))!);
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
  if (!db) return null;
  const [row] = await db.select().from(handoffPatterns).where(eq(handoffPatterns.id, id));
  return row ?? null;
}

export async function getRecentBuildJobs(limit = 50) {
  const db = getDb();
  if (!db) return [];
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
  if (!db) return [];
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
  if (row.updatedAt) return new Date(row.updatedAt).getTime();
  if (row.createdAt) return new Date(row.createdAt).getTime();
  return 0;
}

/** Merged timeline for the admin Builds dashboard (component Vite jobs + design asset extraction). */
export async function getMergedAdminBuildTasks(
  componentJobLimit = 100,
  artifactJobLimit = 100
): Promise<AdminBuildTaskRow[]> {
  const [jobs, artifacts] = await Promise.all([
    getRecentBuildJobs(componentJobLimit),
    getRecentDesignArtifactAssetJobs(artifactJobLimit),
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
  ];

  rows.sort((a, b) => adminBuildTaskSortTime(b) - adminBuildTaskSortTime(a));
  return rows;
}

/** Count jobs still in queue or actively building (used to cap concurrent builds). */
export async function countQueuedOrBuildingJobs(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(componentBuildJobs)
    .where(or(eq(componentBuildJobs.status, 'queued'), eq(componentBuildJobs.status, 'building')));
  return Number(row?.n ?? 0);
}

export async function getDbTokensSnapshot(): Promise<unknown | null> {
  const db = getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(handoffTokensSnapshots)
    .orderBy(desc(handoffTokensSnapshots.id))
    .limit(1);
  return rows[0]?.payload ?? null;
}

export async function insertFigmaFetchJob(triggeredByUserId: string): Promise<number> {
  const db = getDb();
  if (!db) throw new Error('Database unavailable');
  const [row] = await db.insert(figmaFetchJobs).values({ status: 'queued', triggeredByUserId }).returning({ id: figmaFetchJobs.id });
  return row.id;
}

export async function getFigmaFetchJob(jobId: number) {
  const db = getDb();
  if (!db) return null;
  const [row] = await db.select().from(figmaFetchJobs).where(eq(figmaFetchJobs.id, jobId));
  return row ?? null;
}

export async function countQueuedOrRunningFigmaFetchJobs(): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const [row] = await db
    .select({ n: count() })
    .from(figmaFetchJobs)
    .where(or(eq(figmaFetchJobs.status, 'queued'), eq(figmaFetchJobs.status, 'running')));
  return Number(row?.n ?? 0);
}

export type EventLogInsertInput = {
  category: string;
  eventType: string;
  status?: string;
  actorUserId?: string | null;
  route?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  durationMs?: number | null;
  error?: string | null;
  provider?: string | null;
  model?: string | null;
  estimatedInputTokens?: number | null;
  estimatedOutputTokens?: number | null;
  estimatedCostUsd?: number | null;
  requestPreview?: string | null;
  metadata?: Record<string, unknown>;
};

export async function insertEventLog(input: EventLogInsertInput): Promise<number | null> {
  const db = getDb();
  if (!db) return null;
  const [row] = await db
    .insert(handoffEventLog)
    .values({
      category: input.category,
      eventType: input.eventType,
      status: input.status ?? 'success',
      actorUserId: input.actorUserId ?? null,
      route: input.route ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      durationMs: input.durationMs ?? null,
      error: input.error ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      estimatedInputTokens: input.estimatedInputTokens ?? null,
      estimatedOutputTokens: input.estimatedOutputTokens ?? null,
      estimatedCostUsd: input.estimatedCostUsd != null ? String(input.estimatedCostUsd) : null,
      requestPreview: input.requestPreview ?? null,
      metadata: input.metadata ?? {},
    })
    .returning({ id: handoffEventLog.id });
  return row?.id ?? null;
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
  const db = getDb();
  if (!db) return [];
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
  const db = getDb();
  if (!db) {
    return { totalCalls: 0, successCalls: 0, failedCalls: 0, totalCostUsd: 0, byModel: [], byDay: [] };
  }
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
  publicAccess?: boolean;
};

export async function insertDesignArtifact(input: DesignArtifactInsert) {
  const db = getDb();
  if (!db) throw new Error('Database unavailable');
  const [row] = await db
    .insert(handoffDesignArtifacts)
    .values({
      ...(input.id ? { id: input.id } : {}),
      title: input.title,
      description: input.description,
      status: input.status ?? 'review',
      userId: input.userId,
      imageUrl: input.imageUrl,
      sourceImages: (input.sourceImages ?? []) as Record<string, unknown>,
      componentGuides: (input.componentGuides ?? []) as Record<string, unknown>,
      foundationContext: (input.foundationContext ?? {}) as Record<string, unknown>,
      conversationHistory: (input.conversationHistory ?? []) as Record<string, unknown>,
      metadata: (input.metadata ?? {}) as Record<string, unknown>,
      assets: (input.assets ?? []) as typeof handoffDesignArtifacts.$inferInsert.assets,
      assetsStatus: input.assetsStatus ?? 'none',
      publicAccess: input.publicAccess ?? false,
    })
    .returning({ id: handoffDesignArtifacts.id });
  return row?.id ?? null;
}

export async function updateDesignArtifact(
  id: string,
  userId: string,
  patch: Partial<Omit<DesignArtifactInsert, 'id' | 'userId'>>
): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
  const values: Partial<typeof handoffDesignArtifacts.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.imageUrl !== undefined) values.imageUrl = patch.imageUrl;
  if (patch.sourceImages !== undefined) values.sourceImages = patch.sourceImages as typeof handoffDesignArtifacts.$inferInsert.sourceImages;
  if (patch.componentGuides !== undefined)
    values.componentGuides = patch.componentGuides as typeof handoffDesignArtifacts.$inferInsert.componentGuides;
  if (patch.foundationContext !== undefined)
    values.foundationContext = patch.foundationContext as typeof handoffDesignArtifacts.$inferInsert.foundationContext;
  if (patch.conversationHistory !== undefined)
    values.conversationHistory = patch.conversationHistory as typeof handoffDesignArtifacts.$inferInsert.conversationHistory;
  if (patch.metadata !== undefined) values.metadata = patch.metadata as typeof handoffDesignArtifacts.$inferInsert.metadata;
  if (patch.assets !== undefined) values.assets = patch.assets as typeof handoffDesignArtifacts.$inferInsert.assets;
  if (patch.assetsStatus !== undefined) values.assetsStatus = patch.assetsStatus;
  if (patch.publicAccess !== undefined) values.publicAccess = patch.publicAccess;
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
  if (!db) return false;
  const values: Partial<typeof handoffDesignArtifacts.$inferInsert> = { updatedAt: new Date() };
  if (patch.title !== undefined) values.title = patch.title;
  if (patch.description !== undefined) values.description = patch.description;
  if (patch.status !== undefined) values.status = patch.status;
  if (patch.imageUrl !== undefined) values.imageUrl = patch.imageUrl;
  if (patch.sourceImages !== undefined) values.sourceImages = patch.sourceImages as typeof handoffDesignArtifacts.$inferInsert.sourceImages;
  if (patch.componentGuides !== undefined)
    values.componentGuides = patch.componentGuides as typeof handoffDesignArtifacts.$inferInsert.componentGuides;
  if (patch.foundationContext !== undefined)
    values.foundationContext = patch.foundationContext as typeof handoffDesignArtifacts.$inferInsert.foundationContext;
  if (patch.conversationHistory !== undefined)
    values.conversationHistory = patch.conversationHistory as typeof handoffDesignArtifacts.$inferInsert.conversationHistory;
  if (patch.metadata !== undefined) values.metadata = patch.metadata as typeof handoffDesignArtifacts.$inferInsert.metadata;
  if (patch.assets !== undefined) values.assets = patch.assets as typeof handoffDesignArtifacts.$inferInsert.assets;
  if (patch.assetsStatus !== undefined) values.assetsStatus = patch.assetsStatus;
  if (patch.publicAccess !== undefined) values.publicAccess = patch.publicAccess;
  const updated = await db
    .update(handoffDesignArtifacts)
    .set(values)
    .where(eq(handoffDesignArtifacts.id, id))
    .returning({ id: handoffDesignArtifacts.id });
  return updated.length > 0;
}

export async function getDesignArtifactById(id: string) {
  const db = getDb();
  if (!db) return null;
  const [row] = await db.select().from(handoffDesignArtifacts).where(eq(handoffDesignArtifacts.id, id));
  return row ?? null;
}

/** Atomically move `assets_status` from `pending` to `extracting`. Returns false if another worker claimed or status changed. */
export async function claimDesignArtifactForExtraction(id: string): Promise<boolean> {
  const db = getDb();
  if (!db) return false;
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
  if (!db) throw new Error('Database unavailable');
  const row = await getDesignArtifactById(id);
  const prevMeta =
    row?.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
      ? { ...(row.metadata as Record<string, unknown>) }
      : {};
  if (opts.extractionError) prevMeta.assetsExtractionError = opts.extractionError;
  else delete prevMeta.assetsExtractionError;

  await db
    .update(handoffDesignArtifacts)
    .set({
      assets: opts.assets as typeof handoffDesignArtifacts.$inferInsert.assets,
      assetsStatus: opts.assetsStatus,
      metadata: prevMeta as typeof handoffDesignArtifacts.$inferInsert.metadata,
      updatedAt: new Date(),
    })
    .where(eq(handoffDesignArtifacts.id, id));
}

export type DesignArtifactListFilter = {
  status?: string;
  userId?: string;
  limit?: number;
};

export async function getDesignArtifacts(filter: DesignArtifactListFilter = {}) {
  const db = getDb();
  if (!db) return [];
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
