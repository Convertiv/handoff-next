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
  /**
   * What the link points at (reflow R.3).
   *
   * Two kinds of link now exist and they claim different things. A **template link** says "you may build from
   * this template", and the guest's claim over what they make is the token stamped on it. A **return link**
   * says "you may edit this one page", and its claim is the page it points at — the page was created through a
   * different token, so the stamp cannot do that job.
   *
   * Read from the live link row on every request, never from the cookie, so a revoked link stops claiming
   * anything immediately.
   */
  resourceId?: string;
}

/**
 * The parts of a pattern a guest decision depends on.
 *
 * `shareLinkId` is the link the page was created through, and it is what scopes a guest to *their own*
 * submission: guest-created pages are owned by the link's creator (so they land in a real library and
 * clean up with that owner), which means ownership cannot do that job.
 */
export interface GuestPatternRef {
  /** The page's own id — what a return link points at. */
  id?: string;
  /** `handoff_pattern.share_link_token` — the link this page was created through, if any. */
  shareLinkId: string | null;
  /** Lifecycle status, which decides whether editing is still open. */
  status: string;
}

/** Does the guest hold a link that points **at this page**? That is a return link (reflow R.3). */
function holdsReturnLink(guest: GuestPrincipal, pattern: GuestPatternRef): boolean {
  // Both sides must be non-empty, for the same reason as below: two absences are not a match.
  if (!guest.resourceId || !pattern.id) return false;
  return guest.resourceId === pattern.id;
}

/**
 * Is this page the guest's own?
 *
 * Two ways to be, and they are genuinely different claims:
 * - the page was **created through the link they hold** (a template link, and this is their draft), or
 * - the link they hold **points at this page** (a return link, issued to them when they submitted).
 */
function isOwnSubmission(guest: GuestPrincipal, pattern: GuestPatternRef): boolean {
  if (holdsReturnLink(guest, pattern)) return true;
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
 * May this guest edit this page?
 *
 * Their link must say so, the page must be theirs, and its status must still be open to them.
 *
 * **The status rule differs by link kind, deliberately** (reflow R.3):
 * - A **template link** holder is mid-build: `draft` only. Locking at `review` is what stops a guest changing
 *   what a reviewer already looked at with nothing in the record to say it moved.
 * - A **return link** holder was *given* the link precisely so they could come back — "get back and make
 *   changes to the page they created" — so `review` stays open to them. A submitted page is under
 *   consideration, not sealed.
 *
 * Neither may touch `approved` or `archived`: a decision has been made, and editing under it would rewrite
 * what was decided.
 */
export function canGuestEditPattern(guest: GuestPrincipal, pattern: GuestPatternRef): boolean {
  if (!guest.capabilities.includes('edit_own_submission')) return false;
  if (!isOwnSubmission(guest, pattern)) return false;
  if (holdsReturnLink(guest, pattern)) return pattern.status === 'draft' || pattern.status === 'review';
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
