import 'server-only';
import { and, desc, eq, gt, ilike, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { isPostgres } from './dialect';
import { getDb } from './index';
import { handoffDesignArtifacts, handoffPatterns, handoffResourceGrants, handoffShareLinks } from './schema';
import type { GrantLevel, MutateActor, ResourceGrant, ShareCapability } from '../authz/policy';
import { AuthorizationError, computePermissions, toVisibility } from '../authz/policy';
import { isWriteCapable, toShareCapabilities } from '../authz/vocab';
import { mintShareToken, parseShareToken, verifyShareSecret } from '../server/share-link-token';
import { clearedLockState, hashPassphrase, nextLockState, type LockState } from '../server/passphrase';

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
  if (!userId || !isPostgres()) return null;
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
  if (!userId || ids.length === 0 || !isPostgres()) return map;
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
  if (!isPostgres()) return { rows: [], nextCursor: null };
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
  if (!isPostgres()) return { rows: [], nextCursor: null };
  const db = getDb();
  const limit = clampLimit(args.limit);
  const isAdmin = args.actorRole === 'admin';

  // Archived = removed, as far as every list is concerned. See `removePattern`.
  const clauses = [ne(handoffPatterns.status, 'archived')];
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
/* 4b. Review queue (docs/GUEST-AUTHORING.md, Slice 2)                        */
/* -------------------------------------------------------------------------- */

/** Turn a stored `guest:<name>` provenance label into a display name. */
function stripGuestPrefix(label: string | null): string | null {
  if (!label) return null;
  const stripped = label.startsWith('guest:') ? label.slice('guest:'.length) : label;
  return stripped.trim() || null;
}

export interface ReviewQueueRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  visibility: string;
  source: string;
  updatedAt: Date | null;
  blockCount: number;
  /** The template it was built from, when it came from one. */
  templateId: string | null;
  templateTitle: string | null;
  /** The link that admitted the author — provenance, and what to revoke if something is off. */
  shareLinkToken: string | null;
  /** Owner (the link's creator for guest submissions). */
  ownerUserId: string | null;
  ownerName: string | null;
  /** Self-declared name of whoever submitted. Unverified — see the design note. */
  submittedByName: string | null;
  submittedAt: Date | null;
  /** The author's note to the reviewer, from the submitting change row. */
  submittedMessage: string | null;
}

/**
 * Everything awaiting a reviewer, newest submission first.
 *
 * One query. The submitter is the **latest** `handoff_pattern_change` for that pattern with a guest
 * trigger, resolved by a lateral join rather than a per-row lookup — a queue of fifty submissions would
 * otherwise be fifty extra round trips, the same N+1 the lane lists were built to avoid.
 *
 * Uses the `pattern_status_idx` added in `0027_guest_authoring`; before that this was a full scan.
 */
export async function listReviewQueue(limit = 100): Promise<ReviewQueueRow[]> {
  if (!isPostgres()) return [];
  const db = getDb();
  const capped = Math.min(Math.max(1, Math.trunc(limit)), 200);

  const result = await db.execute(sql`
    SELECT
      p.id,
      p.title,
      p.description,
      p.status,
      p.visibility,
      p.source,
      p.updated_at,
      p.template_id,
      p.share_link_token,
      p.user_id AS owner_user_id,
      t.title AS template_title,
      u.name AS owner_name,
      c.pushed_by_name AS submitted_by_name,
      c.pushed_at AS submitted_at,
      c.message AS submitted_message,
      COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(p.components) = 'array' THEN p.components ELSE '[]'::jsonb END), 0) AS block_count
    FROM handoff_pattern p
    LEFT JOIN handoff_pattern t ON t.id = p.template_id
    LEFT JOIN "user" u ON u.id = p.user_id
    LEFT JOIN LATERAL (
      SELECT pc.pushed_by_name, pc.pushed_at, pc.message
      FROM handoff_pattern_change pc
      WHERE pc.pattern_id = p.id AND pc.trigger = 'guest'
      ORDER BY pc.pushed_at DESC
      LIMIT 1
    ) c ON TRUE
    WHERE p.status = 'review'
    ORDER BY COALESCE(c.pushed_at, p.updated_at) DESC NULLS LAST
    LIMIT ${capped}
  `);

  const rows = (result.rows ?? result) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title ?? ''),
    description: (r.description as string | null) ?? null,
    status: String(r.status ?? ''),
    visibility: String(r.visibility ?? ''),
    source: String(r.source ?? ''),
    updatedAt: r.updated_at ? new Date(r.updated_at as string) : null,
    blockCount: Number(r.block_count ?? 0),
    templateId: (r.template_id as string | null) ?? null,
    templateTitle: (r.template_title as string | null) ?? null,
    shareLinkToken: (r.share_link_token as string | null) ?? null,
    ownerUserId: (r.owner_user_id as string | null) ?? null,
    ownerName: (r.owner_name as string | null) ?? null,
    /**
     * `history_label` stores `guest:<name>` so provenance is unambiguous next to a real user's label.
     * The prefix is plumbing, not part of anyone's name — stripped here so the queue doesn't render
     * "Submitted by guest:Casey Jordan".
     */
    submittedByName: stripGuestPrefix(r.submitted_by_name as string | null),
    submittedAt: r.submitted_at ? new Date(r.submitted_at as string) : null,
    submittedMessage: (r.submitted_message as string | null) ?? null,
  }));
}

/* -------------------------------------------------------------------------- */
/* 5. Share links                                                             */
/* -------------------------------------------------------------------------- */

export type ShareLinkRow = typeof handoffShareLinks.$inferSelect;

/**
 * Default lifetime for a write-capable link when the caller names no expiry.
 *
 * `docs/GUEST-AUTHORING.md` calls expiry mandatory for write links. Defaulting rather than throwing is
 * what makes that true in practice: an immortal write link can't be created by forgetting a field.
 */
export const DEFAULT_WRITE_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Capabilities a link actually confers.
 *
 * Every row written before Slice 1 has an empty list, and those links are the read-only viewer's —
 * so empty means `['view']`, not "nothing". Anything else is taken literally.
 */
export function shareLinkCapabilities(link: Pick<ShareLinkRow, 'capabilities'>): ShareCapability[] {
  const stored = toShareCapabilities(link.capabilities);
  return stored.length ? stored : ['view'];
}

export interface CreatedShareLink {
  link: ShareLinkRow;
  /**
   * The token to put in the URL. For a write-capable link this is `<id>.<secret>` and is returned
   * **only here** — the secret is hashed at rest and cannot be recovered afterwards.
   */
  urlToken: string;
}

/**
 * Create an unguessable tokenized share link for a resource. Requires
 * `canChangeVisibility` (owner or admin) — enforced here so both UI and MCP
 * callers share one gate. Throws `AuthorizationError` on denial.
 *
 * Two token shapes, decided by whether the link can write (see `share-link-token.ts`):
 * - **write-capable** → `<id>.<secret>` with only `sha256(secret)` stored, and an expiry always set.
 * - **view-only** → the legacy single opaque token stored in plaintext, unchanged, so existing
 *   read-only viewer URLs and the code that builds them keep working exactly as before.
 */
export async function createShareLink(
  resourceType: ResourceType,
  resourceId: string,
  actor: MutateActor,
  opts: {
    expiresAt?: Date | null;
    /**
     * Opt out of the default TTL entirely (reflow R.3).
     *
     * ⚠️ Needed because `expiresAt: null` cannot say "never": it is indistinguishable from "not supplied", and
     * a write-capable link with neither gets `DEFAULT_WRITE_LINK_TTL_MS` — which is the right default and must
     * stay the default. `/api/handoff/share` relies on exactly that. The one link that must not expire is the
     * **return link**: it is an author's only way back to their own page, and an expiry would strand it
     * silently. Revocation is the control there, and it is deliberate rather than accidental.
     */
    neverExpires?: boolean;
    capabilities?: readonly string[];
    label?: string | null;
    maxUses?: number | null;
    /** Plain passphrase; stored only as a scrypt hash + salt. Never persisted or returned as given. */
    passphrase?: string | null;
  } = {}
): Promise<CreatedShareLink> {
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

  const capabilities = opts.capabilities ? toShareCapabilities(opts.capabilities) : (['view'] as ShareCapability[]);
  const writeCapable = isWriteCapable(capabilities);

  let token: string;
  let tokenHash: string | null;
  let urlToken: string;
  if (writeCapable) {
    const minted = mintShareToken();
    token = minted.id;
    tokenHash = minted.secretHash;
    urlToken = minted.urlToken;
  } else {
    // Unguessable token: two UUIDs, hyphens stripped, base64url of the random bytes.
    token = Buffer.from(`${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ''), 'hex').toString('base64url');
    tokenHash = null;
    urlToken = token;
  }

  const expiresAt = opts.neverExpires
    ? null
    : (opts.expiresAt ?? (writeCapable ? new Date(Date.now() + DEFAULT_WRITE_LINK_TTL_MS) : null));

  // Hashed here rather than by the caller, so no route can persist a plain passphrase by forgetting to.
  const passphrase = opts.passphrase?.trim() ? hashPassphrase(opts.passphrase) : null;

  const [row] = await db
    .insert(handoffShareLinks)
    .values({
      token,
      resourceType,
      resourceId,
      createdByUserId: actor.userId,
      capabilities,
      tokenHash,
      label: opts.label?.trim() || null,
      maxUses: opts.maxUses ?? null,
      passphraseHash: passphrase?.hash ?? null,
      passphraseSalt: passphrase?.salt ?? null,
      expiresAt,
    })
    .returning();
  return { link: row, urlToken };
}

/**
 * Revoke a share link (sets `revoked_at`). Requires `canChangeVisibility` on the resource.
 *
 * Accepts either the public id or a full `<id>.<secret>` URL token: for a hashed link the id is all an
 * operator ever has, and requiring the secret would make a leaked link unrevokable. Authorization here
 * is ownership of the resource, not possession of the token, so accepting the id grants nothing.
 */
export async function revokeShareLink(token: string, actor: MutateActor): Promise<boolean> {
  const db = getDb();
  const id = parseShareToken(token)?.id ?? token.trim();
  const [link] = await db.select().from(handoffShareLinks).where(eq(handoffShareLinks.token, id)).limit(1);
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
    .where(and(eq(handoffShareLinks.token, id), isNull(handoffShareLinks.revokedAt)))
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
  if (!resourceId.trim() || !isPostgres()) return null;
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

/** How many pages are waiting on a reviewer — for the nav badge. Uses `pattern_status_idx`. */
export async function countReviewQueue(): Promise<number> {
  if (!isPostgres()) return 0;
  const db = getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(handoffPatterns)
    .where(eq(handoffPatterns.status, 'review'));
  return Number(row?.n ?? 0);
}

/** A share link as an operator sees it — **never** the secret, which is not recoverable anyway. */
export interface ShareLinkSummary {
  /** Public link id. Safe to show and to log; on its own it grants nothing. */
  id: string;
  label: string | null;
  capabilities: ShareCapability[];
  writeCapable: boolean;
  /** False when the secret is hashed, i.e. the full URL cannot be shown again. */
  secretRecoverable: boolean;
  /** Whether a passphrase is needed as well as the link. Never the passphrase itself. */
  passphraseRequired: boolean;
  /** Locked out by failed passphrase attempts until this moment, if at all. */
  lockedUntil: Date | null;
  useCount: number;
  maxUses: number | null;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date | null;
  /** How many pages have been created through this link. */
  submissionCount: number;
}

/**
 * Every active link for a resource, with usage — what a links list needs.
 *
 * Deliberately a summary rather than the row: something that *cannot* leak a secret is safer to hand to a
 * UI than a row that merely happens not to contain one today. `submissionCount` comes from
 * `handoff_pattern.share_link_token` in one grouped query rather than one per link.
 */
export async function listShareLinks(
  resourceType: ResourceType,
  resourceId: string
): Promise<ShareLinkSummary[]> {
  if (!resourceId.trim() || !isPostgres()) return [];
  const db = getDb();
  const now = new Date();

  const links = await db
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
    .orderBy(desc(handoffShareLinks.createdAt));
  if (!links.length) return [];

  const counts = new Map<string, number>();
  const rows = await db
    .select({ token: handoffPatterns.shareLinkToken, n: sql<number>`count(*)::int` })
    .from(handoffPatterns)
    .where(
      inArray(
        handoffPatterns.shareLinkToken,
        links.map((l) => l.token)
      )
    )
    .groupBy(handoffPatterns.shareLinkToken);
  for (const row of rows) if (row.token) counts.set(row.token, Number(row.n));

  return links.map((link) => {
    const capabilities = shareLinkCapabilities(link);
    return {
      id: link.token,
      label: link.label,
      capabilities,
      writeCapable: isWriteCapable(capabilities),
      secretRecoverable: link.tokenHash == null,
      passphraseRequired: Boolean(link.passphraseHash),
      lockedUntil: link.lockedUntil,
      useCount: link.useCount ?? 0,
      maxUses: link.maxUses,
      lastUsedAt: link.lastUsedAt,
      expiresAt: link.expiresAt,
      createdAt: link.createdAt,
      submissionCount: counts.get(link.token) ?? 0,
    };
  });
}

/**
 * Resolve an active (not revoked, not expired) share link from a URL token, or null.
 *
 * Handles both token shapes: the id half is the primary key either way, so this stays one indexed
 * lookup, and `verifyShareSecret` decides whether the presented secret proves possession. A bare id
 * from a hashed row never verifies, which is what keeps the (loggable) id from being a credential.
 */
export async function resolveShareLink(token: string): Promise<ShareLinkRow | null> {
  const parsed = parseShareToken(token);
  if (!parsed) return null;
  const db = getDb();
  const [link] = await db.select().from(handoffShareLinks).where(eq(handoffShareLinks.token, parsed.id)).limit(1);
  if (!link) return null;
  if (!verifyShareSecret(parsed, { token: link.token, tokenHash: link.tokenHash })) return null;
  if (link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return null;
  return link;
}

/**
 * Fetch an active link by its public id, **without** requiring the secret.
 *
 * For an established guest session only: the secret was verified at the door by `consumeShareLink`, and
 * the signed session cookie is the credential from then on. The active checks stay here rather than in
 * the cookie so revoking or expiring a link ends every session on it at once.
 */
export async function getActiveShareLinkById(id: string): Promise<ShareLinkRow | null> {
  const trimmed = id.trim();
  if (!trimmed) return null;
  const db = getDb();
  const [link] = await db.select().from(handoffShareLinks).where(eq(handoffShareLinks.token, trimmed)).limit(1);
  if (!link) return null;
  if (link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return null;
  return link;
}

/**
 * Record a failed passphrase attempt and return the resulting lock state.
 *
 * Written even on a wrong guess — that is the point. A counter only advanced on success would make the
 * lockout decorative.
 */
export async function recordPassphraseFailure(linkId: string): Promise<LockState> {
  const db = getDb();
  const [link] = await db
    .select({ attemptCount: handoffShareLinks.attemptCount })
    .from(handoffShareLinks)
    .where(eq(handoffShareLinks.token, linkId))
    .limit(1);
  const next = nextLockState(link?.attemptCount ?? 0);
  await db
    .update(handoffShareLinks)
    .set({ attemptCount: next.attemptCount, lockedUntil: next.lockedUntil })
    .where(eq(handoffShareLinks.token, linkId));
  return next;
}

/** Clear the counter after a correct passphrase, so a lock is a speed bump rather than a trap. */
export async function clearPassphraseFailures(linkId: string): Promise<void> {
  const db = getDb();
  const cleared = clearedLockState();
  await db
    .update(handoffShareLinks)
    .set({ attemptCount: cleared.attemptCount, lockedUntil: cleared.lockedUntil })
    .where(eq(handoffShareLinks.token, linkId));
}

/**
 * Resolve a link **and** count the visit — used when a guest starts an authoring session.
 *
 * Separate from `resolveShareLink` because a use is a session, not a request: incrementing on every
 * poll or preview render would make `maxUses` meaningless and `useCount` unreadable.
 *
 * The cap is enforced in the UPDATE's own WHERE clause rather than by reading then writing, so two
 * guests arriving at once on the last remaining use can't both be admitted.
 */
export async function consumeShareLink(token: string): Promise<ShareLinkRow | null> {
  const link = await resolveShareLink(token);
  if (!link) return null;

  const db = getDb();
  const now = new Date();
  const [updated] = await db
    .update(handoffShareLinks)
    .set({ useCount: sql`${handoffShareLinks.useCount} + 1`, lastUsedAt: now })
    .where(
      and(
        eq(handoffShareLinks.token, link.token),
        isNull(handoffShareLinks.revokedAt),
        or(
          isNull(handoffShareLinks.maxUses),
          lt(handoffShareLinks.useCount, sql`coalesce(${handoffShareLinks.maxUses}, 2147483647)`)
        )
      )
    )
    .returning();
  return updated ?? null;
}
