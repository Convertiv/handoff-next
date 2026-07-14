import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from './index';
import { insertSyncEvent } from './sync-queries';
import { editHistory, handoffPatterns } from './schema';

/**
 * Shared pattern (playground page) write core — actor-parameterized so BOTH the
 * session-gated server actions (`app/actions/patterns.ts`) and the MCP page
 * tools use one code path (DB write + editHistory + sync event). Keeps the
 * "every write is tracked" guarantee identical regardless of caller.
 */
export interface PatternWriteActor {
  /** User id for sync attribution (null for token/legacy callers). */
  userId: string | null;
  /** Label for the edit-history row (id or email); defaults to userId. */
  historyLabel?: string | null;
}

export interface PatternInput {
  id: string;
  title: string;
  description?: string;
  group?: string;
  components?: unknown[];
  data?: Record<string, unknown>;
  tags?: unknown[];
  source?: string;
  thumbnail?: string | null;
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

export async function writePattern(input: PatternInput, actor: PatternWriteActor): Promise<void> {
  const db = getDb();
  const source = input.source?.trim() || 'playground';

  await db.insert(handoffPatterns).values({
    id: input.id,
    title: input.title,
    description: input.description ?? '',
    group: input.group ?? '',
    tags: input.tags ?? [],
    components: input.components ?? [],
    data: input.data ?? {},
    userId: actor.userId,
    source,
    thumbnail: input.thumbnail ?? null,
  });

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: input.id,
    userId: actor.historyLabel ?? actor.userId,
    diff: { action: 'create', data: input },
  });

  await insertSyncEvent({
    entityType: 'pattern',
    entityId: input.id,
    action: 'create',
    payload: {
      id: input.id,
      title: input.title,
      description: input.description ?? '',
      group: input.group ?? '',
      components: input.components ?? [],
      data: input.data ?? {},
    },
    userId: actor.userId,
  });
}

export async function patchPattern(
  id: string,
  updates: Partial<Omit<PatternInput, 'id'>>,
  actor: PatternWriteActor
): Promise<void> {
  const db = getDb();

  await db
    .update(handoffPatterns)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(handoffPatterns.id, id));

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: id,
    userId: actor.historyLabel ?? actor.userId,
    diff: { action: 'update', updates },
  });

  const [row] = await db.select().from(handoffPatterns).where(eq(handoffPatterns.id, id));
  if (row) {
    await insertSyncEvent({
      entityType: 'pattern',
      entityId: id,
      action: 'update',
      payload: rowToPatternPayload(row),
      userId: actor.userId,
    });
  }
}

export async function removePattern(id: string, actor: PatternWriteActor): Promise<void> {
  const db = getDb();

  await insertSyncEvent({
    entityType: 'pattern',
    entityId: id,
    action: 'delete',
    payload: { id },
    userId: actor.userId,
  });

  await db.delete(handoffPatterns).where(eq(handoffPatterns.id, id));

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: id,
    userId: actor.historyLabel ?? actor.userId,
    diff: { action: 'delete' },
  });
}
