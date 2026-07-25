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
