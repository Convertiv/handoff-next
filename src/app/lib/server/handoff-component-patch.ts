import { eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { insertSyncEvent } from '../db/sync-queries';
import { editHistory, handoffComponents } from '../db/schema';
import { getDb } from '../db';

function sessionUserIdForSync(user: { id?: string | null } | undefined): string | null {
  const id = user?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function rowToComponentPayload(row: typeof handoffComponents.$inferSelect) {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    description: row.description,
    group: row.group,
    image: row.image,
    type: row.type,
    properties: row.properties,
    previews: row.previews,
    data: row.data,
  };
}

export type ComponentPatchBody = {
  title?: string;
  description?: string;
  group?: string;
  type?: string;
  image?: string;
  path?: string;
  categories?: string[];
  tags?: string[];
  should_do?: string[];
  should_not_do?: string[];
  /** Shallow merge at top level; `entries` is merged one level deep when both are objects */
  data?: Record<string, unknown>;
};

function mergeDataJson(prev: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...prev };
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'entries' && value && typeof value === 'object' && !Array.isArray(value)) {
      const prevEntries = next.entries && typeof next.entries === 'object' && !Array.isArray(next.entries) ? (next.entries as Record<string, unknown>) : {};
      next.entries = { ...prevEntries, ...(value as Record<string, unknown>) };
    } else if (key === 'entrySources' && value && typeof value === 'object' && !Array.isArray(value)) {
      const prevEs = next.entrySources && typeof next.entrySources === 'object' && !Array.isArray(next.entrySources) ? (next.entrySources as Record<string, unknown>) : {};
      next.entrySources = { ...prevEs, ...(value as Record<string, unknown>) };
    } else {
      next[key] = value;
    }
  }
  return next;
}

/**
 * Applies a partial update to `handoff_component` (columns + merged `data` jsonb).
 * Records edit history + sync event like the server actions.
 */
export async function applyHandoffComponentPatch(session: Session | null, id: string, patch: ComponentPatchBody): Promise<void> {
  if (!session?.user) throw new Error('Unauthorized');
  const db = getDb();
  if (!db) throw new Error('Database unavailable');

  const [row] = await db.select().from(handoffComponents).where(eq(handoffComponents.id, id));
  if (!row) throw new Error('Not found');

  const prevData =
    row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? ({ ...(row.data as Record<string, unknown>) } as Record<string, unknown>) : {};

  const mergedFromFlat: Record<string, unknown> = { ...prevData };
  if (patch.categories !== undefined) mergedFromFlat.categories = patch.categories;
  if (patch.tags !== undefined) mergedFromFlat.tags = patch.tags;
  if (patch.should_do !== undefined) mergedFromFlat.should_do = patch.should_do;
  if (patch.should_not_do !== undefined) mergedFromFlat.should_not_do = patch.should_not_do;

  const nextData = patch.data !== undefined ? mergeDataJson(mergedFromFlat, patch.data) : mergedFromFlat;

  const setRow: Partial<typeof handoffComponents.$inferInsert> = {
    updatedAt: new Date(),
    data: nextData as typeof handoffComponents.$inferInsert['data'],
  };

  if (patch.title !== undefined) setRow.title = patch.title;
  if (patch.description !== undefined) setRow.description = patch.description;
  if (patch.group !== undefined) setRow.group = patch.group;
  if (patch.type !== undefined) setRow.type = patch.type;
  if (patch.image !== undefined) setRow.image = patch.image;
  if (patch.path !== undefined) setRow.path = patch.path;

  if (patch.title === undefined && typeof nextData.title === 'string') setRow.title = nextData.title;
  if (patch.description === undefined && typeof nextData.description === 'string') setRow.description = nextData.description;
  if (patch.group === undefined && typeof nextData.group === 'string') setRow.group = nextData.group;
  if (patch.type === undefined && typeof nextData.type === 'string') setRow.type = nextData.type;

  await db.update(handoffComponents).set(setRow).where(eq(handoffComponents.id, id));

  await db.insert(editHistory).values({
    entityType: 'component',
    entityId: id,
    userId: session.user.id ?? session.user.email ?? null,
    diff: { action: 'update', updates: patch },
  });

  const [updated] = await db.select().from(handoffComponents).where(eq(handoffComponents.id, id));
  if (updated) {
    await insertSyncEvent({
      entityType: 'component',
      entityId: id,
      action: 'update',
      payload: rowToComponentPayload(updated),
      userId: sessionUserIdForSync(session.user),
    });
  }
}

export async function getHandoffComponentRow(id: string) {
  const db = getDb();
  if (!db) return null;
  const [row] = await db.select().from(handoffComponents).where(eq(handoffComponents.id, id));
  return row ?? null;
}
