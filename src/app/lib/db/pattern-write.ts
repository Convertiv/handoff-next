import 'server-only';
import { eq } from 'drizzle-orm';
import { getDb } from './index';
import { insertSyncEvent } from './sync-queries';
import { editHistory, handoffPatterns, handoffPatternChanges } from './schema';
import { assertCanMutatePattern } from '../authz/policy';

/**
 * Shared pattern (playground page) write core — actor-parameterized so BOTH the
 * session-gated server actions (`app/actions/patterns.ts`) and the MCP page
 * tools use one code path (DB write + editHistory + sync event). Keeps the
 * "every write is tracked" guarantee identical regardless of caller.
 */
export interface PatternWriteActor {
  /** User id for sync attribution (null for token/legacy callers). */
  userId: string | null;
  /** Actor role; 'admin' bypasses pattern ownership (registry admins + service/workspace MCP actors). */
  role?: string | null;
  /** Label for the edit-history row (id or email); defaults to userId. */
  historyLabel?: string | null;
  /** Optional human "why" for this write — recorded on the pattern-change row. */
  message?: string | null;
  /** Where the write came from (changelog display): 'ui' | 'mcp' | … (default 'mcp'). */
  trigger?: string;
}


/**
 * The value for `edit_history.user_id`, which is a FOREIGN KEY to `users.id`.
 *
 * `historyLabel` is a provenance string ("mcp:<id>", "cli:<id>") — a label, not a user. Writing it into
 * the FK column violated the constraint on every MCP-authored write, so `handoff_create_page` failed
 * 100% of the time at the audit insert while the UI, which sets no label, worked fine. The label now
 * travels in the `diff` jsonb where it belongs, and the column gets a real id or null.
 *
 * Null is legitimate here: the column is nullable, and service/workspace tokens are not users.
 */
function historyUserId(actor: { userId?: string | null }): string | null {
  return actor.userId ?? null;
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
    userId: historyUserId(actor),
    diff: { action: 'create', data: input, by: actor.historyLabel ?? null },
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

  // Authorize BEFORE mutating: owner or admin only (null-owner = team-editable).
  const [existing] = await db
    .select({ userId: handoffPatterns.userId })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, id))
    .limit(1);
  if (existing) assertCanMutatePattern(actor, existing.userId);

  await db
    .update(handoffPatterns)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(handoffPatterns.id, id));

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: id,
    userId: historyUserId(actor),
    diff: { action: 'update', updates, by: actor.historyLabel ?? null },
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

/**
 * Persist a pattern's Phase B meta (`visibility` / `status`) only. Baseline
 * owner/admin gate is enforced here via `assertCanMutatePattern`; the EXTRA
 * lifecycle gates (approve = maintainer, change-visibility = owner/admin) are
 * enforced by the caller (`setPatternMeta` server action) with `computePermissions`.
 * Records edit-history + a pattern-change row so the write stays tracked.
 */
export async function setPatternMetaFields(
  id: string,
  meta: { visibility?: string; status?: string },
  actor: PatternWriteActor
): Promise<void> {
  const db = getDb();

  const [existing] = await db
    .select({ userId: handoffPatterns.userId })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, id))
    .limit(1);
  if (existing) assertCanMutatePattern(actor, existing.userId);

  const set: Partial<typeof handoffPatterns.$inferInsert> = { updatedAt: new Date() };
  if (meta.visibility !== undefined) set.visibility = meta.visibility;
  if (meta.status !== undefined) set.status = meta.status;
  await db.update(handoffPatterns).set(set).where(eq(handoffPatterns.id, id));

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: id,
    userId: historyUserId(actor),
    diff: { action: 'meta', meta, by: actor.historyLabel ?? null },
  });

  const [row] = await db.select().from(handoffPatterns).where(eq(handoffPatterns.id, id));
  await recordPatternChange(db, {
    patternId: id,
    action: 'updated',
    title: row?.title ?? null,
    blockCount: Array.isArray(row?.components) ? (row!.components as unknown[]).length : null,
    actor,
  });
}

export async function removePattern(id: string, actor: PatternWriteActor): Promise<void> {
  const db = getDb();

  // Authorize BEFORE deleting: owner or admin only (null-owner = team-editable).
  const [existing] = await db
    .select({ userId: handoffPatterns.userId })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, id))
    .limit(1);
  if (existing) assertCanMutatePattern(actor, existing.userId);

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
    userId: historyUserId(actor),
    diff: { action: 'delete', by: actor.historyLabel ?? null },
  });

  await recordPatternChange(db, { patternId: id, action: 'deleted', actor });
}
