/**
 * Pattern meta + review decisions — who may change `visibility`/`status`, and what a review verdict does.
 *
 * Client-safe (no `server-only`) for the same two reasons as `./guest`: the review UI must render from the
 * rules it is enforced by, and these decisions deserve tests without a database.
 *
 * **Why this module exists at all.** The approve gate used to live inside the `setPatternMeta` *server
 * action*, which meant MCP could not reach it — the roadmap's own note says an MCP status setter would
 * have to duplicate it. Guest authoring makes that concrete: submissions land in `review` and someone has
 * to approve them from either surface. So the decision moved here, the write core enforces it, and both
 * callers share one gate. Same reason `assertCanMutatePattern` sits inside `pattern-write`.
 */

import type { ResourcePermissions } from './vocab';
import { LIFECYCLE, VISIBILITY } from './vocab';

export interface PatternMetaState {
  visibility: string;
  status: string;
}

export interface PatternMetaChange {
  visibility?: string;
  status?: string;
}

export interface MetaAllowed {
  ok: true;
  patch: PatternMetaChange;
}

export interface MetaDenied {
  ok: false;
  code: 'invalid' | 'forbidden';
  reason: string;
}

export type MetaDecision = MetaAllowed | MetaDenied;

/**
 * Narrow a decision to its denial.
 *
 * An explicit type guard rather than `if (!decision.ok)`, because the app compiles with
 * `strictNullChecks: false` and boolean-literal discriminants do not narrow without it — the union
 * silently collapses and `decision.reason` fails to typecheck. A guard narrows either way.
 */
export function isMetaDenied(decision: MetaDecision): decision is MetaDenied {
  return decision.ok === false;
}

const isVisibility = (v: string) => (VISIBILITY as readonly string[]).includes(v);
const isLifecycle = (v: string) => (LIFECYCLE as readonly string[]).includes(v);

/**
 * Decide a `visibility`/`status` change.
 *
 * Preserves the rules the server action already enforced, unchanged:
 * - visibility → `canChangeVisibility` (owner/admin)
 * - status `approved` → `canApprove` (maintainer only)
 * - any other status → `canEdit`
 *
 * Fields equal to their current value are dropped rather than refused: a UI that submits the whole meta
 * object shouldn't need approve rights to leave `status` where it already was.
 */
export function decidePatternMetaChange(
  current: PatternMetaState,
  requested: PatternMetaChange,
  perms: ResourcePermissions
): MetaDecision {
  const patch: PatternMetaChange = {};

  if (requested.visibility !== undefined && requested.visibility !== current.visibility) {
    if (!isVisibility(requested.visibility)) {
      return { ok: false, code: 'invalid', reason: 'Invalid visibility.' };
    }
    if (!perms.canChangeVisibility) {
      return { ok: false, code: 'forbidden', reason: "You do not have permission to change this pattern's visibility." };
    }
    patch.visibility = requested.visibility;
  }

  if (requested.status !== undefined && requested.status !== current.status) {
    if (!isLifecycle(requested.status)) {
      return { ok: false, code: 'invalid', reason: 'Invalid status.' };
    }
    if (requested.status === 'approved') {
      if (!perms.canApprove) {
        return { ok: false, code: 'forbidden', reason: 'Only a maintainer can approve a pattern.' };
      }
    } else if (!perms.canEdit) {
      return { ok: false, code: 'forbidden', reason: 'You do not have permission to modify this pattern.' };
    }
    patch.status = requested.status;
  }

  return { ok: true, patch };
}

/* -------------------------------------------------------------------------- */
/* Review verdicts                                                            */
/* -------------------------------------------------------------------------- */

export type ReviewDecision = 'approve' | 'reject';

/**
 * Turn a reviewer's verdict into a status change.
 *
 * Both verdicts require `canApprove`, not just `canEdit`. Rejecting is a review action with the same
 * weight as approving — it sends someone's work back — and letting `canEdit` do it would mean the
 * submission's *owner* (the link creator) could clear items out of the queue without being a maintainer.
 *
 * Only a pattern actually in `review` can be decided. Approving something already approved, or rejecting
 * a draft, is a stale queue view rather than an intent — refusing says so instead of silently rewriting
 * a status the reviewer never looked at.
 */
export function decideReview(
  current: PatternMetaState,
  decision: ReviewDecision,
  perms: ResourcePermissions
): MetaDecision {
  if (!perms.canApprove) {
    return { ok: false, code: 'forbidden', reason: 'Only a maintainer can review submissions.' };
  }
  if (current.status !== 'review') {
    return {
      ok: false,
      code: 'invalid',
      reason: `This page is not awaiting review (it is "${current.status}").`,
    };
  }
  /**
   * Reject returns it to `draft`, which is exactly what re-opens guest editing
   * (`canGuestEditPattern` requires `draft`) — so a rejection with a note is also the mechanism for
   * asking the author for another pass.
   */
  return { ok: true, patch: { status: decision === 'approve' ? 'approved' : 'draft' } };
}
