import { desc } from 'drizzle-orm';
import { getDb } from './index';
import { handoffComponents, handoffPatterns, handoffTokensSnapshots } from './schema';

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
