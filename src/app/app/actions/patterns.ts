'use server';

import { eq } from 'drizzle-orm';
import { auth } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { insertSyncEvent } from '../../lib/db/sync-queries';
import { editHistory, handoffPatterns } from '../../lib/db/schema';

function sessionUserIdForSync(user: { id?: string | null } | undefined): string | null {
  const id = user?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function rowToPatternPayload(row: typeof handoffPatterns.$inferSelect) {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    description: row.description,
    group: row.group,
    tags: row.tags,
    components: row.components,
    data: row.data,
  };
}

export async function createPattern(data: {
  id: string;
  title: string;
  description?: string;
  group?: string;
  components?: unknown[];
  payload?: Record<string, unknown>;
  tags?: unknown[];
  source?: string;
  thumbnail?: string | null;
}) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const db = getDb();

  const userId = typeof session.user.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  const source = data.source?.trim() || 'playground';

  await db.insert(handoffPatterns).values({
    id: data.id,
    title: data.title,
    description: data.description ?? '',
    group: data.group ?? '',
    tags: data.tags ?? [],
    components: data.components ?? [],
    data: data.payload ?? {},
    userId,
    source,
    thumbnail: data.thumbnail ?? null,
  });

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: data.id,
    userId: session.user.id ?? session.user.email ?? null,
    diff: { action: 'create', data },
  });

  await insertSyncEvent({
    entityType: 'pattern',
    entityId: data.id,
    action: 'create',
    payload: {
      id: data.id,
      title: data.title,
      description: data.description ?? '',
      group: data.group ?? '',
      components: data.components ?? [],
      data: data.payload ?? {},
    },
    userId: sessionUserIdForSync(session.user),
  });

  return { success: true };
}

export async function updatePattern(
  id: string,
  updates: Partial<{
    title: string;
    description: string;
    group: string;
    components: unknown[];
    data: Record<string, unknown>;
    tags: unknown[];
    source: string;
    thumbnail: string | null;
  }>
) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const db = getDb();

  await db
    .update(handoffPatterns)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(handoffPatterns.id, id));

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: id,
    userId: session.user.id ?? session.user.email ?? null,
    diff: { action: 'update', updates },
  });

  const [row] = await db.select().from(handoffPatterns).where(eq(handoffPatterns.id, id));
  if (row) {
    await insertSyncEvent({
      entityType: 'pattern',
      entityId: id,
      action: 'update',
      payload: rowToPatternPayload(row),
      userId: sessionUserIdForSync(session.user),
    });
  }

  return { success: true };
}

export async function deletePattern(id: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const db = getDb();

  await insertSyncEvent({
    entityType: 'pattern',
    entityId: id,
    action: 'delete',
    payload: { id },
    userId: sessionUserIdForSync(session.user),
  });

  await db.delete(handoffPatterns).where(eq(handoffPatterns.id, id));

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: id,
    userId: session.user.id ?? session.user.email ?? null,
    diff: { action: 'delete' },
  });

  return { success: true };
}
