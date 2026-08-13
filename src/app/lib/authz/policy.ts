import 'server-only';
import type { GrantLevel, Visibility, ResourcePermissions } from './vocab';
import { VISIBILITY } from './vocab';
import {
  canGuestCreateFromTemplate,
  canGuestEditPattern,
  canGuestSubmitPattern,
  type GuestPatternRef,
  type GuestPrincipal,
} from './guest';

/**
 * Authorization policy layer (Phase A of the Workbench/Playground multiuser roadmap).
 *
 * Single place that answers "can this actor mutate this resource?", called by BOTH
 * the browser server-actions path and the MCP write path so enforcement can't be
 * bypassed by reaching the shared write core (`pattern-write.ts`) through a
 * different caller.
 *
 * Tenancy = team within one deployment: per-user ownership + team sharing, NO org
 * entity. `MutateActor` carries an optional `orgId` seam so an org tier can be added
 * later without changing call sites.
 */

export class AuthorizationError extends Error {
  readonly code = 'FORBIDDEN';
  constructor(message = 'You do not have permission to perform this action.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export function isAuthorizationError(e: unknown): e is AuthorizationError {
  return (
    e instanceof AuthorizationError ||
    (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'FORBIDDEN')
  );
}

export interface MutateActor {
  /** Authenticated actor id. Null for legacy/token callers (which are role 'admin'). */
  userId: string | null;
  /** Actor role; 'admin' bypasses ownership. Covers registry admins + service/workspace actors. */
  role?: string | null;
  /** Reserved seam for a future org/tenant tier — unused today. */
  orgId?: string | null;
  /**
   * Set only for share-link callers. Its presence **removes** every ownership-derived permission —
   * a guest can act solely through the `canGuest*` functions below.
   */
  guest?: GuestPrincipal | null;
}

/** True when this actor is a share-link bearer rather than an authenticated user. */
export function isGuestActor(actor: MutateActor): boolean {
  return actor.guest != null;
}

/**
 * Team-within-deployment rule for mutating a playground pattern:
 * - admins (incl. the service/workspace MCP actors, which are role 'admin') may mutate any;
 * - a set owner may be mutated only by that owner;
 * - null-owner (legacy/unowned) patterns are team-editable by any authenticated actor.
 *
 * Reads are intentionally team-wide and NOT gated here — visibility lands in Phase B.
 */
export function canMutatePattern(actor: MutateActor, ownerUserId: string | null | undefined): boolean {
  /**
   * Guests first, and unconditionally. A guest has `userId: null`, so without this line the
   * null-owner clause below would hand every legacy/unowned pattern in the deployment to anyone
   * holding any share link — and a caller that forgot the guest case would look correct.
   * Guest writes are authorized only by `canGuestEditPattern` / `canGuestCreateFromTemplate`.
   */
  if (actor.guest != null) return false;
  if (actor.role === 'admin') return true;
  if (ownerUserId == null) return true;
  return actor.userId != null && actor.userId === ownerUserId;
}

export function assertCanMutatePattern(actor: MutateActor, ownerUserId: string | null | undefined): void {
  if (!canMutatePattern(actor, ownerUserId)) {
    throw new AuthorizationError('You do not have permission to modify this pattern.');
  }
}

/* -------------------------------------------------------------------------- */
/* Phase B — visibility & lifecycle (foundation only; not yet wired to reads)  */
/* -------------------------------------------------------------------------- */

// Vocabulary (types + value lists) lives in the client-safe `./vocab` module; re-exported
// here so existing server-side imports from '@/lib/authz/policy' are unchanged. Client
// components import from './vocab' directly (this file is server-only).
export type { Visibility, Lifecycle, GrantLevel, ResourcePermissions, ShareCapability } from './vocab';
export {
  VISIBILITY,
  LIFECYCLE,
  SHARE_CAPABILITIES,
  WRITE_CAPABILITIES,
  AUTHORING_CAPABILITIES,
  toShareCapabilities,
  isWriteCapable,
} from './vocab';

/** A per-user grant the current actor holds on a resource (looked up by the caller in Stage 2). */
export interface ResourceGrant {
  level: GrantLevel;
}

/** Minimal ownership + visibility descriptor the policy needs to decide access. */
export interface OwnedResource {
  /** Owner id; null = legacy/unowned (team-editable, consistent with `canMutatePattern`). */
  ownerUserId: string | null;
  visibility: Visibility;
}

/**
 * Compute the effective permissions of `actor` over `resource`, optionally given the
 * actor's explicit `grant` on it. Pure — the caller supplies the already-resolved grant.
 *
 * - canView: admin OR owner OR visibility team/public OR any grant.
 * - canEdit: admin OR owner OR edit-grant. Null owner stays team-editable (matches `canMutatePattern`).
 * - canDelete / canChangeVisibility: admin OR owner.
 * - canApprove: admin only (maintainer-gated lifecycle 'approved').
 */
export function computePermissions(
  actor: MutateActor,
  resource: OwnedResource,
  grant?: ResourceGrant | null
): ResourcePermissions {
  /**
   * A guest holds capabilities, not permissions over resources. Returning early keeps them out of
   * every clause below — `isUnowned`, `visibility === 'team'` and a stray grant row would all
   * otherwise read as access. The one thing a link can confer here is view.
   */
  if (actor.guest != null) {
    const canView = actor.guest.capabilities.includes('view');
    return { canView, canEdit: false, canDelete: false, canChangeVisibility: false, canApprove: false };
  }

  const isAdmin = actor.role === 'admin';
  const isOwner = resource.ownerUserId != null && actor.userId != null && actor.userId === resource.ownerUserId;
  const isUnowned = resource.ownerUserId == null;
  const hasGrant = grant != null;
  const hasEditGrant = grant?.level === 'edit';

  const canView =
    isAdmin ||
    isOwner ||
    isUnowned || // legacy/unowned = team resource: viewable as well as editable (consistent with canEdit)
    resource.visibility === 'team' ||
    resource.visibility === 'public' ||
    hasGrant;

  // Null-owner resources remain team-editable, consistent with canMutatePattern.
  const canEdit = isAdmin || isOwner || isUnowned || hasEditGrant;

  const canDelete = isAdmin || isOwner;
  const canChangeVisibility = isAdmin || isOwner;
  const canApprove = isAdmin;

  return { canView, canEdit, canDelete, canChangeVisibility, canApprove };
}

/* -------------------------------------------------------------------------- */
/* Guest authoring — throwing wrappers (docs/GUEST-AUTHORING.md)               */
/* -------------------------------------------------------------------------- */

// The predicates themselves live in the client-safe `./guest` so the authoring UI can render from the
// same rules it is enforced by, and so they can be unit-tested without a server condition.
export type { GuestPrincipal, GuestPatternRef } from './guest';
export {
  canGuestCreateFromTemplate,
  canGuestEditPattern,
  canGuestSubmitPattern,
  canGuestUseAssetLibrary,
  canGuestView,
  isGuestOwnPage,
} from './guest';

export function assertGuestCanCreateFromTemplate(guest: GuestPrincipal, templateId: string): void {
  if (!canGuestCreateFromTemplate(guest, templateId)) {
    throw new AuthorizationError('This link does not allow creating a page from this template.');
  }
}

export function assertGuestCanEditPattern(guest: GuestPrincipal, pattern: GuestPatternRef): void {
  if (!canGuestEditPattern(guest, pattern)) {
    // Deliberately does not distinguish "not yours" from "already submitted": the first would confirm
    // to a token holder that some other page exists.
    throw new AuthorizationError('This page can no longer be edited with this link.');
  }
}

export function assertGuestCanSubmitPattern(guest: GuestPrincipal, pattern: GuestPatternRef): void {
  if (!canGuestSubmitPattern(guest, pattern)) {
    throw new AuthorizationError('This page cannot be submitted with this link.');
  }
}

/** Coerce an arbitrary stored string into a known `Visibility` (defaults to 'private'). */
export function toVisibility(value: unknown): Visibility {
  return (VISIBILITY as readonly string[]).includes(value as string) ? (value as Visibility) : 'private';
}

/**
 * Attach a computed `permissions` object to each row of a list, using the already
 * bulk-resolved grant map (avoids per-row grant queries — the N+1 the caller must
 * pre-solve with `getActorGrantsForResources`). Pure and additive: it only adds a
 * `permissions` field, never mutates or drops existing fields.
 *
 * Rows only need `id` + `userId`; `visibility` is optional (light list projections
 * that omit it are treated as 'private', which is harmless because those default
 * paths only surface owner/admin rows where visibility does not change the result).
 */
export function attachPermissions<T extends { id: string; userId: string | null; visibility?: string | null }>(
  rows: T[],
  actor: MutateActor,
  grants: Map<string, ResourceGrant>
): (T & { permissions: ResourcePermissions })[] {
  return rows.map((row) => ({
    ...row,
    permissions: computePermissions(
      actor,
      { ownerUserId: row.userId, visibility: toVisibility(row.visibility) },
      grants.get(row.id) ?? null
    ),
  }));
}
