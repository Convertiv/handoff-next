import 'server-only';
import { and, eq } from 'drizzle-orm';
import { getDb } from './index';
import { insertSyncEvent } from './sync-queries';
import { editHistory, handoffPatterns, handoffPatternChanges } from './schema';
import {
  AuthorizationError,
  assertCanMutatePattern,
  assertGuestCanCreateFromTemplate,
  assertGuestCanEditPattern,
  assertGuestCanSubmitPattern,
  computePermissions,
  toVisibility,
  type GuestPrincipal,
  type MutateActor,
  type ResourceGrant,
} from '../authz/policy';
import {
  decidePatternMetaChange,
  decideReview,
  isMetaDenied,
  type PatternMetaChange,
  type ReviewDecision,
} from '../authz/review';

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

/* -------------------------------------------------------------------------- */
/* Review — the guarded meta path shared by UI, HTTP and MCP                  */
/* -------------------------------------------------------------------------- */

/**
 * Apply a `visibility`/`status` change with the gate enforced **here**, not by the caller.
 *
 * `setPatternMetaFields` deliberately stays the unguarded primitive (it only checks baseline
 * owner/admin), because the approve rule needs a resolved `grant` and the lifecycle vocabulary. That gate
 * used to live in the `setPatternMeta` server action, which is why MCP had no way to set status without
 * copying it. Now every surface calls this.
 *
 * `grant` is passed in rather than looked up so this stays one query cheaper for the common admin/MCP
 * case, matching how `computePermissions` is used everywhere else.
 */
export async function applyPatternMeta(
  id: string,
  meta: PatternMetaChange,
  actor: PatternWriteActor,
  grant: ResourceGrant | null = null
): Promise<{ changed: boolean }> {
  const db = getDb();
  const [row] = await db
    .select({ userId: handoffPatterns.userId, visibility: handoffPatterns.visibility, status: handoffPatterns.status })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, id))
    .limit(1);
  if (!row) throw new AuthorizationError('Pattern not found.');

  const mutateActor: MutateActor = { userId: actor.userId, role: actor.role ?? null };
  const perms = computePermissions(
    mutateActor,
    { ownerUserId: row.userId ?? null, visibility: toVisibility(row.visibility) },
    grant
  );

  const decision = decidePatternMetaChange({ visibility: row.visibility, status: row.status }, meta, perms);
  if (isMetaDenied(decision)) {
    // `invalid` is a bad request, not a permission problem; callers map the two to different statuses.
    if (decision.code === 'forbidden') throw new AuthorizationError(decision.reason);
    throw new Error(decision.reason);
  }
  if (!Object.keys(decision.patch).length) return { changed: false };

  await setPatternMetaFields(id, decision.patch, actor);
  return { changed: true };
}

/**
 * Record a reviewer's verdict on a submitted page.
 *
 * Approve → `approved`. Reject → `draft`, which is also what re-opens guest editing, so a rejection with
 * a note is how you ask the author for another pass. Visibility is never touched: promoting a page into a
 * wider audience is a separate, deliberate act.
 *
 * The reviewer's note rides on the actor as the change's "why", so the queue's decisions read in the same
 * changelog as the guest's edits.
 */
export async function reviewPattern(
  id: string,
  decision: ReviewDecision,
  actor: PatternWriteActor,
  opts: { message?: string | null; grant?: ResourceGrant | null } = {}
): Promise<{ status: string }> {
  const db = getDb();
  const [row] = await db
    .select({ userId: handoffPatterns.userId, visibility: handoffPatterns.visibility, status: handoffPatterns.status })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, id))
    .limit(1);
  if (!row) throw new AuthorizationError('Pattern not found.');

  const mutateActor: MutateActor = { userId: actor.userId, role: actor.role ?? null };
  const perms = computePermissions(
    mutateActor,
    { ownerUserId: row.userId ?? null, visibility: toVisibility(row.visibility) },
    opts.grant ?? null
  );

  const verdict = decideReview({ visibility: row.visibility, status: row.status }, decision, perms);
  if (isMetaDenied(verdict)) {
    if (verdict.code === 'forbidden') throw new AuthorizationError(verdict.reason);
    throw new Error(verdict.reason);
  }

  const nextStatus = verdict.patch.status!;
  /**
   * Guarded in the WHERE clause too: two reviewers acting on the same queue row must not both record a
   * verdict. The loser gets the same "not awaiting review" answer a stale view deserves.
   */
  const updated = await db
    .update(handoffPatterns)
    .set({ status: nextStatus, updatedAt: new Date() })
    .where(and(eq(handoffPatterns.id, id), eq(handoffPatterns.status, 'review')))
    .returning({ id: handoffPatterns.id });
  if (!updated.length) throw new Error('This page is no longer awaiting review.');

  const reviewActor: PatternWriteActor = {
    ...actor,
    trigger: actor.trigger ?? 'review',
    message: opts.message ?? actor.message ?? null,
  };

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: id,
    userId: historyUserId(reviewActor),
    diff: { action: 'review', decision, status: nextStatus, by: reviewActor.historyLabel ?? null },
  });

  const [after] = await db.select().from(handoffPatterns).where(eq(handoffPatterns.id, id));
  await recordPatternChange(db, {
    patternId: id,
    action: 'updated',
    title: after?.title ?? null,
    blockCount: Array.isArray(after?.components) ? (after!.components as unknown[]).length : null,
    actor: reviewActor,
  });

  return { status: nextStatus };
}

/* -------------------------------------------------------------------------- */
/* Guest authoring (docs/GUEST-AUTHORING.md)                                  */
/* -------------------------------------------------------------------------- */

/**
 * Guest writes get their own three functions rather than a `guest` flag on the actor.
 *
 * `writePattern` has no authorization check at all (create is unguarded for authenticated users) and
 * writes `userId: actor.userId` — a guest reaching it would create unlimited unowned rows. `patchPattern`
 * would ask `assertCanMutatePattern`, which denies every guest by design. So neither can serve this
 * flow, and the narrow surface below is deliberate: a guest can create a draft from a template, edit
 * that draft, and submit it. Nothing else, and never `visibility`, `status` (except via submit),
 * `userId` or `templateId`.
 */

/** The fields a guest is permitted to change. Anything outside this is dropped, not rejected. */
export interface GuestPatternEdit {
  title?: string;
  description?: string;
  components?: unknown[];
  data?: Record<string, unknown>;
  thumbnail?: string | null;
}

function guestWriteActor(guest: GuestPrincipal, ownerUserId: string | null, message?: string | null): PatternWriteActor {
  return {
    // Attribution, not identity: the row belongs to the link's owner, and the *name* is the guest's own
    // unverified label. `trigger: 'guest'` is what lets the changelog and review queue tell them apart.
    userId: ownerUserId,
    role: null,
    historyLabel: `guest:${guest.name}`,
    trigger: 'guest',
    message: message ?? null,
  };
}

/** Read the two fields every guest decision needs. */
async function guestPatternRef(
  db: ReturnType<typeof getDb>,
  id: string
): Promise<{ shareLinkId: string | null; status: string } | null> {
  const [row] = await db
    .select({ shareLinkToken: handoffPatterns.shareLinkToken, status: handoffPatterns.status })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, id))
    .limit(1);
  return row ? { shareLinkId: row.shareLinkToken, status: row.status } : null;
}

/**
 * Create a guest's draft from the template their link points at.
 *
 * `ownerUserId` is the link's creator: the page has to belong to a real user so it lands in a library,
 * cleans up with that owner, and never leaves a null-owner row behind (which would be team-editable by
 * everyone). The guest's claim on it is `shareLinkToken`, not ownership.
 */
export async function createGuestSubmission(
  input: { id: string; templateId: string; title: string; components?: unknown[]; data?: Record<string, unknown> },
  guest: GuestPrincipal,
  ownerUserId: string | null
): Promise<void> {
  assertGuestCanCreateFromTemplate(guest, input.templateId);
  const db = getDb();
  const actor = guestWriteActor(guest, ownerUserId);

  await db.insert(handoffPatterns).values({
    id: input.id,
    title: input.title,
    description: '',
    group: '',
    tags: [],
    components: input.components ?? [],
    data: input.data ?? {},
    userId: ownerUserId,
    source: 'guest',
    templateId: input.templateId,
    shareLinkToken: guest.shareLinkId,
    // Not negotiable by the caller: a guest submission starts private and unsubmitted.
    visibility: 'private',
    status: 'draft',
  });

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: input.id,
    userId: historyUserId(actor),
    diff: { action: 'create', data: input, by: actor.historyLabel, via: guest.shareLinkId },
  });

  await insertSyncEvent({
    entityType: 'pattern',
    entityId: input.id,
    action: 'create',
    payload: {
      id: input.id,
      title: input.title,
      description: '',
      group: '',
      components: input.components ?? [],
      data: input.data ?? {},
    },
    userId: ownerUserId,
  });

  await recordPatternChange(db, {
    patternId: input.id,
    action: 'created',
    title: input.title,
    blockCount: Array.isArray(input.components) ? input.components.length : null,
    actor,
  });
}

/** Edit a guest's own still-unsubmitted draft. Authorized by link + provenance + status. */
export async function patchGuestSubmission(
  id: string,
  edit: GuestPatternEdit,
  guest: GuestPrincipal
): Promise<void> {
  const db = getDb();
  const ref = await guestPatternRef(db, id);
  if (!ref) throw new AuthorizationError('This page can no longer be edited with this link.');
  assertGuestCanEditPattern(guest, ref);

  /**
   * Rebuilt field by field rather than spread. A spread would carry whatever the HTTP layer happened to
   * put on the object — `status`, `userId`, `visibility`, `templateId` — straight into the UPDATE, which
   * is precisely the escalation this function exists to prevent.
   */
  const set: Partial<typeof handoffPatterns.$inferInsert> = { updatedAt: new Date() };
  if (edit.title !== undefined) set.title = edit.title;
  if (edit.description !== undefined) set.description = edit.description;
  if (edit.components !== undefined) set.components = edit.components;
  if (edit.data !== undefined) set.data = edit.data;
  if (edit.thumbnail !== undefined) set.thumbnail = edit.thumbnail;

  const [owner] = await db
    .select({ userId: handoffPatterns.userId })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, id))
    .limit(1);
  const actor = guestWriteActor(guest, owner?.userId ?? null);

  await db.update(handoffPatterns).set(set).where(eq(handoffPatterns.id, id));

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: id,
    userId: historyUserId(actor),
    diff: { action: 'update', updates: edit, by: actor.historyLabel, via: guest.shareLinkId },
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
    title: row?.title ?? null,
    blockCount: Array.isArray(row?.components) ? (row!.components as unknown[]).length : null,
    actor,
  });
}

/**
 * Hand a guest's draft to the reviewers: `draft` → `review`, and nothing else.
 *
 * Visibility is untouched on purpose. Submitting is a request for attention, not a grant of access —
 * promoting the page is the reviewer's action (Slice 2), and it is the only place `approved` may be set.
 */
export async function submitGuestSubmission(
  id: string,
  guest: GuestPrincipal,
  message?: string | null
): Promise<void> {
  const db = getDb();
  const ref = await guestPatternRef(db, id);
  if (!ref) throw new AuthorizationError('This page cannot be submitted with this link.');
  assertGuestCanSubmitPattern(guest, ref);

  const [owner] = await db
    .select({ userId: handoffPatterns.userId })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.id, id))
    .limit(1);
  const actor = guestWriteActor(guest, owner?.userId ?? null, message);

  /**
   * Guarded in the WHERE clause as well as by the check above: two submits racing must not both record
   * a submission, and re-reading the status here would be the same read-then-write the check already did.
   */
  const updated = await db
    .update(handoffPatterns)
    .set({ status: 'review', updatedAt: new Date() })
    .where(and(eq(handoffPatterns.id, id), eq(handoffPatterns.status, 'draft')))
    .returning({ id: handoffPatterns.id });
  if (!updated.length) throw new AuthorizationError('This page cannot be submitted with this link.');

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: id,
    userId: historyUserId(actor),
    diff: { action: 'submit', status: 'review', by: actor.historyLabel, via: guest.shareLinkId },
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
