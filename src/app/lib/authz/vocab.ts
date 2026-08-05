/**
 * Client-safe authorization vocabulary — NO `server-only` import, so React client
 * components (badges, pickers, inspector) can import these types + value lists + UI
 * label maps directly. The server-only policy module (`policy.ts`) re-exports the
 * types/consts it needs, so existing server call sites are unchanged.
 */

/** Sharing visibility of a resource. */
export type Visibility = 'private' | 'shared' | 'team' | 'public';
export const VISIBILITY: readonly Visibility[] = ['private', 'shared', 'team', 'public'] as const;

/** Lifecycle status of a resource. */
export type Lifecycle = 'prototype' | 'draft' | 'review' | 'approved' | 'archived';
export const LIFECYCLE: readonly Lifecycle[] = ['prototype', 'draft', 'review', 'approved', 'archived'] as const;

/** Library relationship lane. */
export type Lane = 'yours' | 'shared' | 'team' | 'public';
export const LANES: readonly Lane[] = ['yours', 'shared', 'team', 'public'] as const;

/** Access level of an explicit per-user grant on a resource. */
export type GrantLevel = 'view' | 'edit';

/* -------------------------------------------------------------------------- */
/* Share-link capabilities (guest authoring — see docs/GUEST-AUTHORING.md)     */
/* -------------------------------------------------------------------------- */

/**
 * What a share link permits its bearer to do. A list, not a boolean `canEdit`, because the guest
 * authoring flow needs these axes independently: a link may let someone build a page from a template
 * without letting them submit it, or let them look without touching anything.
 *
 * **There is deliberately no image-generation capability.** Guests pick from the existing asset library
 * only (Brad, 2026-08-05): generation is metered spend behind an unauthenticated URL, and leaving the
 * capability out entirely is a stronger guarantee than a budget that has to be enforced correctly.
 * Adding one later means adding it here *and* to the worker's actor check — not just here.
 */
export type ShareCapability =
  | 'view'
  | 'create_from_template'
  | 'edit_own_submission'
  | 'use_asset_library'
  | 'submit_for_review';

export const SHARE_CAPABILITIES: readonly ShareCapability[] = [
  'view',
  'create_from_template',
  'edit_own_submission',
  'use_asset_library',
  'submit_for_review',
] as const;

/**
 * Capabilities that let the bearer change data. A link holding any of these is a write-capable link and
 * carries the extra requirements in `docs/GUEST-AUTHORING.md` (hashed secret, mandatory expiry).
 */
export const WRITE_CAPABILITIES: readonly ShareCapability[] = [
  'create_from_template',
  'edit_own_submission',
  'submit_for_review',
] as const;

/** The set handed to a guest authoring link — build a page from a template and submit it for review. */
export const AUTHORING_CAPABILITIES: readonly ShareCapability[] = [
  'view',
  'create_from_template',
  'edit_own_submission',
  'use_asset_library',
  'submit_for_review',
] as const;

export const SHARE_CAPABILITY_META: Record<ShareCapability, { label: string; desc: string }> = {
  view: { label: 'View', desc: 'Open the page or template read-only' },
  create_from_template: { label: 'Build from template', desc: 'Start a new page from the shared template' },
  edit_own_submission: { label: 'Edit their own page', desc: 'Keep changing it until they submit' },
  use_asset_library: { label: 'Use existing assets', desc: 'Pick from the asset library — no generating' },
  submit_for_review: { label: 'Submit for review', desc: 'Hand the finished page to a reviewer' },
};

/** Coerce stored jsonb into a known capability list, dropping anything unrecognized. */
export function toShareCapabilities(value: unknown): ShareCapability[] {
  if (!Array.isArray(value)) return [];
  const known = new Set<string>(SHARE_CAPABILITIES);
  // Deduped: a repeated capability in stored data must not make a `length` check mean something else.
  return [...new Set(value.filter((v): v is ShareCapability => typeof v === 'string' && known.has(v)))];
}

export function isWriteCapable(capabilities: readonly ShareCapability[]): boolean {
  return capabilities.some((c) => (WRITE_CAPABILITIES as readonly string[]).includes(c));
}

/** Effective permissions of an actor over a single resource (stamped on API rows). */
export interface ResourcePermissions {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canChangeVisibility: boolean;
  canApprove: boolean;
}

/** UI presentation for lifecycle states. `ghost` = dashed/outline treatment (prototype). */
export const LIFECYCLE_META: Record<Lifecycle, { label: string; short: string; ghost?: boolean }> = {
  prototype: { label: 'Prototype', short: 'Prototype', ghost: true },
  draft: { label: 'Draft', short: 'Draft' },
  review: { label: 'Ready for review', short: 'In review' },
  approved: { label: 'Approved', short: 'Approved' },
  archived: { label: 'Archived', short: 'Archived' },
};

/** UI presentation for visibility levels. `icon` names map to lucide-react components in the component layer. */
export const VISIBILITY_META: Record<Visibility, { label: string; desc: string; icon: 'lock' | 'users' | 'building' | 'globe' }> = {
  private: { label: 'Private', desc: 'Only you can see it', icon: 'lock' },
  shared: { label: 'Shared with people', desc: 'Named teammates you pick', icon: 'users' },
  team: { label: 'Team library', desc: 'Everyone in this workspace', icon: 'building' },
  public: { label: 'Public link', desc: 'Anyone with the link — read-only', icon: 'globe' },
};

/** UI presentation for the relationship lanes. */
export const LANE_META: Record<Lane, { label: string; sub: string }> = {
  yours: { label: 'Yours', sub: 'Assets you created — full control.' },
  shared: { label: 'Shared with you', sub: 'A teammate gave you access to these directly.' },
  team: { label: 'Team library', sub: 'Everything in the workspace you can reach.' },
  public: { label: 'Public links', sub: 'Assets exposed via a shareable link.' },
};
