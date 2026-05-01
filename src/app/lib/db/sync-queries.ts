import { desc, eq, gt, sql } from 'drizzle-orm';
import type { SyncAction, SyncChange, SyncChangeset, SyncEntityType, SyncStatusResponse } from '@handoff/types/handoff-sync';
import { getDb } from './index';
import {
  handoffComponents,
  handoffPages,
  handoffPatterns,
  syncEvents,
} from './schema';

export type InsertSyncEventInput = {
  entityType: SyncEntityType;
  entityId: string;
  action: SyncAction;
  payload?: Record<string, unknown> | null;
  userId?: string | null;
};

export async function insertSyncEvent(input: InsertSyncEventInput): Promise<number | null> {
  const db = getDb();
  const [row] = await db
    .insert(syncEvents)
    .values({
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      payload: input.payload ?? null,
      userId: input.userId ?? null,
    })
    .returning({ id: syncEvents.id });
  return row?.id ?? null;
}

export async function getLatestSyncEventId(): Promise<number> {
  const db = getDb();
  const rows = await db.select({ id: syncEvents.id }).from(syncEvents).orderBy(desc(syncEvents.id)).limit(1);
  return rows[0]?.id ?? 0;
}

export async function fetchSyncChangesSince(since: number): Promise<SyncChangeset> {
  const db = getDb();
  const latest = await getLatestSyncEventId();
  const rows = await db
    .select()
    .from(syncEvents)
    .where(gt(syncEvents.id, since))
    .orderBy(syncEvents.id);

  const changes: SyncChange[] = rows.map((r) => ({
    version: r.id,
    entityType: r.entityType as SyncEntityType,
    entityId: r.entityId,
    action: r.action as SyncAction,
    updatedAt: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as string)).toISOString(),
    data: (r.payload as SyncChange['data']) ?? null,
  }));

  return { version: latest, changes };
}

export async function getSyncStatus(): Promise<SyncStatusResponse> {
  const db = getDb();
  const latestVersion = await getLatestSyncEventId();

  const [comp] = await db.select({ c: sql<number>`count(*)` }).from(handoffComponents);
  const [pat] = await db.select({ c: sql<number>`count(*)` }).from(handoffPatterns);
  const [pg] = await db.select({ c: sql<number>`count(*)` }).from(handoffPages);
  const [ev] = await db.select({ c: sql<number>`count(*)` }).from(syncEvents);

  return {
    latestVersion,
    counts: {
      components: comp?.c ?? 0,
      patterns: pat?.c ?? 0,
      pages: pg?.c ?? 0,
      syncEvents: ev?.c ?? 0,
    },
  };
}

/** Apply one uploaded change from CLI and append a sync_event (same shape as remote edits). */
export async function applyUploadedChange(input: {
  entityType: SyncEntityType;
  entityId: string;
  action: SyncAction;
  data?: Record<string, unknown> | null;
  userId?: string | null;
}): Promise<void> {
  const db = getDb();

  const { entityType, entityId, action, data, userId } = input;

  if (entityType === 'component') {
    if (action === 'delete') {
      await db.delete(handoffComponents).where(eq(handoffComponents.id, entityId));
      await insertSyncEvent({
        entityType,
        entityId,
        action: 'delete',
        payload: { id: entityId },
        userId,
      });
      return;
    }
    const d = (data ?? {}) as Record<string, unknown>;
    const row = {
      id: String(d.id ?? entityId),
      path: d.path != null ? String(d.path) : null,
      title: String(d.title ?? entityId),
      description: d.description != null ? String(d.description) : '',
      group: d.group != null ? String(d.group) : '',
      image: d.image != null ? String(d.image) : null,
      type: d.type != null ? String(d.type) : 'element',
      properties: (d.properties as object) ?? null,
      previews: (d.previews as object) ?? null,
      data: (d.data as object) ?? (d as object),
      source: typeof d.source === 'string' && d.source.length > 0 ? String(d.source) : 'disk',
      updatedAt: new Date(),
    };
    await db
      .insert(handoffComponents)
      .values({
        ...row,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: handoffComponents.id,
        set: {
          path: row.path,
          title: row.title,
          description: row.description,
          group: row.group,
          image: row.image,
          type: row.type,
          properties: row.properties,
          previews: row.previews,
          data: row.data,
          source: row.source,
          updatedAt: row.updatedAt,
        },
      });
    await insertSyncEvent({
      entityType,
      entityId: row.id,
      action: action === 'create' ? 'create' : 'update',
      payload: d,
      userId,
    });
    return;
  }

  if (entityType === 'pattern') {
    if (action === 'delete') {
      await db.delete(handoffPatterns).where(eq(handoffPatterns.id, entityId));
      await insertSyncEvent({
        entityType,
        entityId,
        action: 'delete',
        payload: { id: entityId },
        userId,
      });
      return;
    }
    const d = (data ?? {}) as Record<string, unknown>;
    const row = {
      id: String(d.id ?? entityId),
      path: d.path != null ? String(d.path) : null,
      title: String(d.title ?? entityId),
      description: d.description != null ? String(d.description) : '',
      group: d.group != null ? String(d.group) : '',
      tags: (d.tags as object) ?? null,
      components: (d.components as object) ?? null,
      data: (d.data as object) ?? (d as object),
      updatedAt: new Date(),
    };
    await db
      .insert(handoffPatterns)
      .values({
        ...row,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: handoffPatterns.id,
        set: {
          path: row.path,
          title: row.title,
          description: row.description,
          group: row.group,
          tags: row.tags,
          components: row.components,
          data: row.data,
          updatedAt: row.updatedAt,
        },
      });
    await insertSyncEvent({
      entityType,
      entityId: row.id,
      action: action === 'create' ? 'create' : 'update',
      payload: d,
      userId,
    });
    return;
  }

  if (entityType === 'page') {
    if (action === 'delete') {
      await db.delete(handoffPages).where(eq(handoffPages.slug, entityId));
      await insertSyncEvent({
        entityType,
        entityId,
        action: 'delete',
        payload: { slug: entityId },
        userId,
      });
      return;
    }
    const d = (data ?? {}) as Record<string, unknown>;
    const slug = String(d.slug ?? entityId);
    const frontmatter = (d.frontmatter as Record<string, unknown>) ?? {};
    const markdown = String(d.markdown ?? '');
    await db
      .insert(handoffPages)
      .values({
        slug,
        frontmatter,
        markdown,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: handoffPages.slug,
        set: {
          frontmatter,
          markdown,
          updatedAt: new Date(),
        },
      });
    await insertSyncEvent({
      entityType,
      entityId: slug,
      action: action === 'create' ? 'create' : 'update',
      payload: { slug, frontmatter, markdown },
      userId,
    });
    return;
  }
}
