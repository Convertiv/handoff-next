/**
 * Guest (share-link) authorization predicates — see `docs/GUEST-AUTHORING.md`.
 *
 * Client-safe on purpose, like `./vocab`: NO `server-only` import. Two reasons. The guest authoring UI
 * needs the same rules to decide what to render (an Edit button on a submitted page is a lie), and
 * these are the decisions that stand between an unauthenticated URL and the pattern table — they should
 * be unit-testable without a Postgres connection or a react-server condition.
 *
 * The throwing `assert*` wrappers live in the server-only `./policy`, which re-exports everything here.
 */

import type { ShareCapability } from './vocab';

/**
 * An unauthenticated caller admitted by a share link.
 *
 * Not a user, and deliberately never given a `users` row: a guest is a *capability holder*.
 */
export interface GuestPrincipal {
  /** The share link that admitted them — the public link id, never the secret. */
  shareLinkId: string;
  capabilities: readonly ShareCapability[];
  /** Self-declared display name. Unverified; provenance only, never an identity claim. */
  name: string;
}

/**
 * The parts of a pattern a guest decision depends on.
 *
 * `shareLinkId` is the link the page was created through, and it is what scopes a guest to *their own*
 * submission: guest-created pages are owned by the link's creator (so they land in a real library and
 * clean up with that owner), which means ownership cannot do that job.
 */
export interface GuestPatternRef {
  /** `handoff_pattern.share_link_token` — the link this page was created through, if any. */
  shareLinkId: string | null;
  /** Lifecycle status, which decides whether editing is still open. */
  status: string;
}

/** Is this page the guest's own, created through the very link they hold? */
function isOwnSubmission(guest: GuestPrincipal, pattern: GuestPatternRef): boolean {
  // Both sides must be non-empty: two rows that each "have no link" are not the same link, and a
  // null/empty match would make every non-guest page editable by any guest.
  if (!guest.shareLinkId || !pattern.shareLinkId) return false;
  return pattern.shareLinkId === guest.shareLinkId;
}

/** A guest may start a page only from the exact template their link points at. */
export function canGuestCreateFromTemplate(guest: GuestPrincipal, templateId: string): boolean {
  if (!guest.capabilities.includes('create_from_template')) return false;
  return guest.shareLinkId.length > 0 && templateId.trim().length > 0;
}

/**
 * A guest may edit a page only while all three hold: their link says so, the page was created through
 * *that same link*, and it has not been submitted yet.
 *
 * Locking at `review` is deliberate — a guest still editing after submission would change what a
 * reviewer already looked at, and nothing in the record would say it moved.
 */
export function canGuestEditPattern(guest: GuestPrincipal, pattern: GuestPatternRef): boolean {
  if (!guest.capabilities.includes('edit_own_submission')) return false;
  if (!isOwnSubmission(guest, pattern)) return false;
  return pattern.status === 'draft';
}

/** A guest may submit their own unsubmitted page for review. */
export function canGuestSubmitPattern(guest: GuestPrincipal, pattern: GuestPatternRef): boolean {
  if (!guest.capabilities.includes('submit_for_review')) return false;
  if (!isOwnSubmission(guest, pattern)) return false;
  return pattern.status === 'draft';
}

/** A guest may browse existing assets when the link allows it. Read-only — see `ShareCapability`. */
export function canGuestUseAssetLibrary(guest: GuestPrincipal): boolean {
  return guest.capabilities.includes('use_asset_library');
}

/** A guest may view the shared resource itself. */
export function canGuestView(guest: GuestPrincipal): boolean {
  return guest.capabilities.includes('view');
}
