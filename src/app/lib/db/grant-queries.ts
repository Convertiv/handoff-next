import 'server-only';
import { and, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { usePostgres } from './dialect';
import { getDb } from './index';
import { handoffDesignArtifacts, handoffPatterns, handoffResourceGrants, handoffShareLinks } from './schema';
import type { GrantLevel, MutateActor, ResourceGrant } from '../authz/policy';
import { AuthorizationError, computePermissions, toVisibility } from '../authz/policy';

/**
 * Grant resolution + lane-aware, visibility-filtered list queries + tokenized
 * share links (Phase B, Stage 2). Everything here is additive: no existing query
 * behaviour is changed — new lane list functions live alongside the untouched
 * defaults in `queries.ts`.
 */

export type ResourceType = 'pattern' | 'design_artifact';
export type Lane = 'yours' | 'shared' | 'team' | 'public';

/* -------------------------------------------------------------------------- */
/* 1. Grant resolution (no N+1)                                               */
/* -------------------------------------------------------------------------- */

/** Resolve the actor's explicit grant on ONE resource, or null. */
export async function getActorGrant(
  resourceType: ResourceType,
  resourceId: string,
  userId: string | null
): Promise<ResourceGrant | null> {
  if (!userId || !usePostgres()) return null;
  const db = getDb();
  const [row] = await db
    .select({ level: handoffResourceGrants.level })
    .from(handoffResourceGrants)
    .where(
      and(
        eq(handoffResourceGrants.resourceType, resourceType),
        eq(handoffResourceGrants.resourceId, resourceId),
        eq(handoffResourceGrants.granteeUserId, userId)
      )
    )
    .limit(1);
  if (!row) return null;
  return { level: (row.level === 'edit' ? 'edit' : 'view') as GrantLevel };
}

/**
 * Bulk-resolve the actor's grants for MANY resources in ONE query (the map that
 * `attachPermissions` consumes so a list never issues a grant query per row).
 */
export async function getActorGrantsForResources(
  resourceType: ResourceType,
  ids: string[],
  userId: string | null
): Promise<Map<string, ResourceGrant>> {
  const map = new Map<string, ResourceGrant>();
  if (!userId || ids.length === 0 || !usePostgres()) return map;
  const db = getDb();
  const rows = await db
    .select({ resourceId: handoffResourceGrants.resourceId, level: handoffResourceGrants.level })
    .from(handoffResourceGrants)
    .where(
      and(
        eq(handoffResourceGrants.resourceType, resourceType),
        eq(handoffResourceGrants.granteeUserId, userId),
        inArray(handoffResourceGrants.resourceId, ids)
      )
    );
  for (const row of rows) {
    map.set(row.resourceId, { level: (row.level === 'edit' ? 'edit' : 'view') as GrantLevel });
  }
  return map;
}

/* -------------------------------------------------------------------------- */
/* 2. Lane-aware, visibility-filtered LIST queries (SQL-level filtering)      */
/* -------------------------------------------------------------------------- */

/**
 * Opaque `(updated_at, id)` cursor shared by the lane lists. Same base64url
 * `iso|id` shape as the artifact cursor in `queries.ts` (interchangeable format,
 * but kept local so lane lists don't depend on the default path's helpers).
 */
function encodeCursor(row: { updatedAt: Date | string | null; id: string }): string {
  const d = row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt ?? 0);
  return Buffer.from(`${d.toISOString()}|${row.id}`, 'utf8').toString('base64url');
}

function decodeCursor(raw: string): { updatedAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(raw, 'base64url').toString('utf8');
    const sep = decoded.lastIndexOf('|');
    if (sep === -1) return null;
    const updatedAt = new Date(decoded.slice(0, sep));
    const id = decoded.slice(sep + 1);
    if (!id || Number.isNaN(updatedAt.getTime())) return null;
    return { updatedAt, id };
  } catch {
    return null;
  }
}

export interface LaneListArgs {
  lane: Lane;
  actorUserId: string | null;
  actorRole?: string | null;
  cursor?: string | null;
  limit?: number;
  /** Existing filters carried through so lane lists compose with them. */
  status?: string;
  source?: string;
  q?: string;
  group?: string;
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 50, 1), 200);
}

/**
 * SQL WHERE clause for a lane over the design-artifact table.
 *
 * - `yours`:  user_id = actor
 * - `shared`: id ∈ (actor's grants) AND user_id <> actor
 * - `team`:   admin ⇒ all; else user_id = actor OR visibility IN ('team','public')
 *             OR user_id IS NULL OR id ∈ (actor's grants)
 * - `public`: visibility = 'public'
 */
function designArtifactLaneClause(lane: Lane, actorUserId: string | null, isAdmin: boolean) {
  const grantedIds = actorUserId
    ? db_grantSubquery('design_artifact', actorUserId)
    : null;
  switch (lane) {
    case 'yours':
      return actorUserId ? eq(handoffDesignArtifacts.userId, actorUserId) : sql`false`;
    case 'shared':
      if (!actorUserId || !grantedIds) return sql`false`;
      return and(inArray(handoffDesignArtifacts.id, grantedIds), ne(handoffDesignArtifacts.userId, actorUserId));
    case 'public':
      return eq(handoffDesignArtifacts.visibility, 'public');
    case 'team':
    default: {
      if (isAdmin) return undefined; // admin ⇒ every row
      const parts = [
        inArray(handoffDesignArtifacts.visibility, ['team', 'public']),
        isNull(handoffDesignArtifacts.userId),
      ];
      if (actorUserId) parts.push(eq(handoffDesignArtifacts.userId, actorUserId));
      if (grantedIds) parts.push(inArray(handoffDesignArtifacts.id, grantedIds));
      return or(...parts);
    }
  }
}

/** Subquery of resource ids the actor holds any grant on, for a resource type. */
function db_grantSubquery(resourceType: ResourceType, actorUserId: string) {
  const db = getDb();
  return db
    .select({ id: handoffResourceGrants.resourceId })
    .from(handoffResourceGrants)
    .where(
      and(eq(handoffResourceGrants.resourceType, resourceType), eq(handoffResourceGrants.granteeUserId, actorUserId))
    );
}

export type DesignArtifactLaneRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  userId: string;
  imageUrl: string;
  assetsStatus: string;
  specStatus: string;
  publicAccess: boolean;
  visibility: string;
  metadata: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type LanePage<T> = { rows: T[]; nextCursor: string | null };

/** Lane-filtered, cursor-paginated design artifacts. Light projection (no base64 blobs). */
export async function listDesignArtifactsByLane(args: LaneListArgs): Promise<LanePage<DesignArtifactLaneRow>> {
  if (!usePostgres()) return { rows: [], nextCursor: null };
  const db = getDb();
  const limit = clampLimit(args.limit);
  const isAdmin = args.actorRole === 'admin';

  const cols = {
    id: handoffDesignArtifacts.id,
    title: handoffDesignArtifacts.title,
    description: handoffDesignArtifacts.description,
    status: handoffDesignArtifacts.status,
    userId: handoffDesignArtifacts.userId,
    imageUrl: handoffDesignArtifacts.imageUrl,
    assetsStatus: handoffDesignArtifacts.assetsStatus,
    specStatus: handoffDesignArtifacts.specStatus,
    publicAccess: handoffDesignArtifacts.publicAccess,
    visibility: handoffDesignArtifacts.visibility,
    metadata: handoffDesignArtifacts.metadata,
    createdAt: handoffDesignArtifacts.createdAt,
    updatedAt: handoffDesignArtifacts.updatedAt,
  };

  const clauses = [];
  const laneClause = designArtifactLaneClause(args.lane, args.actorUserId, isAdmin);
  if (laneClause) clauses.push(laneClause);
  if (args.status?.trim()) clauses.push(eq(handoffDesignArtifacts.status, args.status.trim()));

  const cursor = args.cursor ? decodeCursor(args.cursor) : null;
  if (cursor) {
    clauses.push(
      or(
        lt(handoffDesignArtifacts.updatedAt, cursor.updatedAt),
        and(eq(handoffDesignArtifacts.updatedAt, cursor.updatedAt), lt(handoffDesignArtifacts.id, cursor.id))
      )
    );
  }

  const where = clauses.length ? and(...clauses) : undefined;
  const rows = await db
    .select(cols)
    .from(handoffDesignArtifacts)
    .where(where)
    .orderBy(desc(handoffDesignArtifacts.updatedAt), desc(handoffDesignArtifacts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last) : null;
  return { rows: page as DesignArtifactLaneRow[], nextCursor };
}

/** SQL WHERE clause for a lane over the pattern table (mirrors the artifact rules). */
function patternLaneClause(lane: Lane, actorUserId: string | null, isAdmin: boolean) {
  const grantedIds = actorUserId ? db_grantSubquery('pattern', actorUserId) : null;
  switch (lane) {
    case 'yours':
      return actorUserId ? eq(handoffPatterns.userId, actorUserId) : sql`false`;
    case 'shared':
      if (!actorUserId || !grantedIds) return sql`false`;
      return and(inArray(handoffPatterns.id, grantedIds), ne(handoffPatterns.userId, actorUserId));
    case 'public':
      return eq(handoffPatterns.visibility, 'public');
    case 'team':
    default: {
      if (isAdmin) return undefined;
      const parts = [
        inArray(handoffPatterns.visibility, ['team', 'public']),
        isNull(handoffPatterns.userId),
      ];
      if (actorUserId) parts.push(eq(handoffPatterns.userId, actorUserId));
      if (grantedIds) parts.push(inArray(handoffPatterns.id, grantedIds));
      return or(...parts);
    }
  }
}

export type PatternLaneRow = typeof handoffPatterns.$inferSelect;

/** Lane-filtered, cursor-paginated patterns. Returns full rows (for `patternRowToListEntry`). */
export async function listPatternsByLane(args: LaneListArgs): Promise<LanePage<PatternLaneRow>> {
  if (!usePostgres()) return { rows: [], nextCursor: null };
  const db = getDb();
  const limit = clampLimit(args.limit);
  const isAdmin = args.actorRole === 'admin';

  const clauses = [];
  const laneClause = patternLaneClause(args.lane, args.actorUserId, isAdmin);
  if (laneClause) clauses.push(laneClause);
  if (args.source?.trim()) clauses.push(eq(handoffPatterns.source, args.source.trim()));
  if (args.group?.trim()) clauses.push(eq(handoffPatterns.group, args.group.trim()));
  const q = args.q?.trim();
  if (q) {
    const like = `%${q.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    clauses.push(or(ilike(handoffPatterns.title, like), ilike(handoffPatterns.description, like))!);
  }

  const cursor = args.cursor ? decodeCursor(args.cursor) : null;
  if (cursor) {
    clauses.push(
      or(
        lt(handoffPatterns.updatedAt, cursor.updatedAt),
        and(eq(handoffPatterns.updatedAt, cursor.updatedAt), lt(handoffPatterns.id, cursor.id))
      )
    );
  }

  const where = clauses.length ? and(...clauses) : undefined;
  const rows = await db
    .select()
    .from(handoffPatterns)
    .where(where)
    .orderBy(desc(handoffPatterns.updatedAt), desc(handoffPatterns.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last) : null;
  return { rows: page, nextCursor };
}

/* -------------------------------------------------------------------------- */
/* 3. Resource owner lookup (for authz on share-link mutations)               */
/* -------------------------------------------------------------------------- */

/** Minimal owner/visibility lookup for a resource of either type, or null if missing. */
export async function getResourceOwner(
  resourceType: ResourceType,
  resourceId: string
): Promise<{ ownerUserId: string | null; visibility: string } | null> {
  const db = getDb();
  if (resourceType === 'pattern') {
    const [row] = await db
      .select({ userId: handoffPatterns.userId, visibility: handoffPatterns.visibility })
      .from(handoffPatterns)
      .where(eq(handoffPatterns.id, resourceId))
      .limit(1);
    return row ? { ownerUserId: row.userId ?? null, visibility: row.visibility } : null;
  }
  const [row] = await db
    .select({ userId: handoffDesignArtifacts.userId, visibility: handoffDesignArtifacts.visibility })
    .from(handoffDesignArtifacts)
    .where(eq(handoffDesignArtifacts.id, resourceId))
    .limit(1);
  return row ? { ownerUserId: row.userId, visibility: row.visibility } : null;
}

/* -------------------------------------------------------------------------- */
/* 5. Share links                                                             */
/* -------------------------------------------------------------------------- */

export type ShareLinkRow = typeof handoffShareLinks.$inferSelect;

/**
 * Create an unguessable tokenized share link for a resource. Requires
 * `canChangeVisibility` (owner or admin) — enforced here so both UI and MCP
 * callers share one gate. Throws `AuthorizationError` on denial.
 */
export async function createShareLink(
  resourceType: ResourceType,
  resourceId: string,
  actor: MutateActor,
  opts: { expiresAt?: Date | null } = {}
): Promise<ShareLinkRow> {
  const db = getDb();
  const owner = await getResourceOwner(resourceType, resourceId);
  if (!owner) throw new AuthorizationError('Resource not found.');
  const perms = computePermissions(
    actor,
    { ownerUserId: owner.ownerUserId, visibility: toVisibility(owner.visibility) },
    null
  );
  if (!perms.canChangeVisibility) {
    throw new AuthorizationError('You do not have permission to share this resource.');
  }
  // Unguessable token: two UUIDs, hyphens stripped, base64url of the random bytes.
  const token = Buffer.from(`${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ''), 'hex').toString(
    'base64url'
  );
  const [row] = await db
    .insert(handoffShareLinks)
    .values({
      token,
      resourceType,
      resourceId,
      createdByUserId: actor.userId,
      expiresAt: opts.expiresAt ?? null,
    })
    .returning();
  return row;
}

/** Revoke a share link (sets `revoked_at`). Requires `canChangeVisibility` on the resource. */
export async function revokeShareLink(token: string, actor: MutateActor): Promise<boolean> {
  const db = getDb();
  const [link] = await db.select().from(handoffShareLinks).where(eq(handoffShareLinks.token, token)).limit(1);
  if (!link) return false;
  const owner = await getResourceOwner(link.resourceType as ResourceType, link.resourceId);
  const perms = computePermissions(
    actor,
    { ownerUserId: owner?.ownerUserId ?? null, visibility: toVisibility(owner?.visibility) },
    null
  );
  if (!perms.canChangeVisibility) {
    throw new AuthorizationError('You do not have permission to revoke this share link.');
  }
  const updated = await db
    .update(handoffShareLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(handoffShareLinks.token, token), isNull(handoffShareLinks.revokedAt)))
    .returning({ token: handoffShareLinks.token });
  return updated.length > 0;
}

/**
 * Return the most-recent ACTIVE (not revoked, not expired) share link for a
 * resource, or null. Used by the share GET endpoint so the UI can surface an
 * existing link instead of minting a new one on every open.
 */
export async function getActiveShareLink(
  resourceType: ResourceType,
  resourceId: string
): Promise<ShareLinkRow | null> {
  if (!resourceId.trim() || !usePostgres()) return null;
  const db = getDb();
  const now = new Date();
  const [link] = await db
    .select()
    .from(handoffShareLinks)
    .where(
      and(
        eq(handoffShareLinks.resourceType, resourceType),
        eq(handoffShareLinks.resourceId, resourceId),
        isNull(handoffShareLinks.revokedAt),
        or(isNull(handoffShareLinks.expiresAt), gt(handoffShareLinks.expiresAt, now))
      )
    )
    .orderBy(desc(handoffShareLinks.createdAt))
    .limit(1);
  return link ?? null;
}

/** Resolve an active (not revoked, not expired) share link by token, or null. */
export async function resolveShareLink(token: string): Promise<ShareLinkRow | null> {
  if (!token.trim()) return null;
  const db = getDb();
  const [link] = await db.select().from(handoffShareLinks).where(eq(handoffShareLinks.token, token.trim())).limit(1);
  if (!link) return null;
  if (link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return null;
  return link;
}
