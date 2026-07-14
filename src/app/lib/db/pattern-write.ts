import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from './index';
import { insertSyncEvent } from './sync-queries';
import { editHistory, handoffPatterns, handoffPatternChanges } from './schema';

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
  /** Optional human "why" for this write — recorded on the pattern-change row. */
  message?: string | null;
  /** Where the write came from (changelog display): 'ui' | 'mcp' | … (default 'mcp'). */
  trigger?: string;
}

/** Record a pattern-change row (unified changelog + change-why source). Best-effort. */
async function recordPatternChange(
  db: ReturnType<typeof getDb>,
  args: { patternId: string; action: 'created' | 'updated' | 'deleted'; title?: string | null; blockCount?: number | null; actor: PatternWriteActor }
): Promise<void> {
  await db.insert(handoffPatternChanges).values({
    patternId: args.patternId,
    action: args.action,
    title: args.title ?? null,
    blockCount: args.blockCount ?? null,
    pushedByUserId: args.actor.userId,
    pushedByName: args.actor.historyLabel ?? null,
    trigger: args.actor.trigger ?? 'mcp',
    message: args.actor.message ?? null,
  });
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

  await recordPatternChange(db, {
    patternId: input.id,
    action: 'created',
    title: input.title,
    blockCount: Array.isArray(input.components) ? input.components.length : null,
    actor,
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

  await recordPatternChange(db, {
    patternId: id,
    action: 'updated',
    title: row?.title ?? (updates.title as string | undefined) ?? null,
    blockCount: Array.isArray(row?.components) ? (row!.components as unknown[]).length : null,
    actor,
  });
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

  await recordPatternChange(db, { patternId: id, action: 'deleted', actor });
}
