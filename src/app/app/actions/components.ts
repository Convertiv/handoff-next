'use server';

import { eq } from 'drizzle-orm';
import { auth } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { insertSyncEvent } from '../../lib/db/sync-queries';
import { editHistory, handoffComponents } from '../../lib/db/schema';
import { isDynamic } from '../../lib/mode';

function guardDynamic() {
  if (!isDynamic()) throw new Error('Actions require HANDOFF_MODE=dynamic');
}

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

export async function createComponent(data: {
  id: string;
  title: string;
  description?: string;
  group?: string;
  type?: string;
  payload?: Record<string, unknown>;
}) {
  guardDynamic();
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const db = getDb()!;

  await db.insert(handoffComponents).values({
    id: data.id,
    title: data.title,
    description: data.description ?? '',
    group: data.group ?? '',
    type: data.type ?? 'element',
    data: data.payload ?? {},
  });

  await db.insert(editHistory).values({
    entityType: 'component',
    entityId: data.id,
    userId: session.user.id ?? session.user.email ?? null,
    diff: { action: 'create', data },
  });

  await insertSyncEvent({
    entityType: 'component',
    entityId: data.id,
    action: 'create',
    payload: {
      id: data.id,
      title: data.title,
      description: data.description ?? '',
      group: data.group ?? '',
      type: data.type ?? 'element',
      data: data.payload ?? {},
    },
    userId: sessionUserIdForSync(session.user),
  });

  return { success: true };
}

export async function updateComponent(
  id: string,
  updates: Partial<{ title: string; description: string; group: string; type: string; data: Record<string, unknown> }>
) {
  guardDynamic();
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const db = getDb()!;

  await db
    .update(handoffComponents)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(handoffComponents.id, id));

  await db.insert(editHistory).values({
    entityType: 'component',
    entityId: id,
    userId: session.user.id ?? session.user.email ?? null,
    diff: { action: 'update', updates },
  });

  const [row] = await db.select().from(handoffComponents).where(eq(handoffComponents.id, id));
  if (row) {
    await insertSyncEvent({
      entityType: 'component',
      entityId: id,
      action: 'update',
      payload: rowToComponentPayload(row),
      userId: sessionUserIdForSync(session.user),
    });
  }

  return { success: true };
}

export async function deleteComponent(id: string) {
  guardDynamic();
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const db = getDb()!;

  await insertSyncEvent({
    entityType: 'component',
    entityId: id,
    action: 'delete',
    payload: { id },
    userId: sessionUserIdForSync(session.user),
  });

  await db.delete(handoffComponents).where(eq(handoffComponents.id, id));

  await db.insert(editHistory).values({
    entityType: 'component',
    entityId: id,
    userId: session.user.id ?? session.user.email ?? null,
    diff: { action: 'delete' },
  });

  return { success: true };
}
