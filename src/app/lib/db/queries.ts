import { count, desc, eq, or } from 'drizzle-orm';
import { getDb } from './index';
import { componentBuildJobs, figmaFetchJobs, handoffComponents, handoffPatterns, handoffTokensSnapshots } from './schema';

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

export async function getRecentBuildJobs(limit = 50) {
  const db = getDb();
  if (!db) return [];
  return db
    .select()
    .from(componentBuildJobs)
    .orderBy(desc(componentBuildJobs.id))
    .limit(limit);
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
