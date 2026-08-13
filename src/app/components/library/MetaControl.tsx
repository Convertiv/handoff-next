'use client';

import { useCallback, useState } from 'react';
import { Building2, Globe, Lock, Users, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { VisibilityPicker } from './VisibilityPicker';
import { LifecyclePicker } from './LifecyclePicker';
import { KindPicker } from './KindPicker';
import { setPatternMeta } from '@/app/actions/patterns';
import { handoffApiUrl } from '@/lib/api-path';
import { KIND_META, LIFECYCLE_META, VISIBILITY_META, patternKind, type Lifecycle, type PatternKind, type Visibility } from '@/lib/authz/vocab';

/**
 * Who can see this thing, and where it is in its lifecycle — **on the thing's own view**.
 *
 * Lives here, shared by the page editor and the saved-design detail page, because the rule is per-object and
 * not per-surface (roadmap E.7a; `INVITE-TO-BUILD.md`, "Lifecycle and visibility"). It used to be set from the
 * library's details sidebar, which meant a browse surface owned an object's settings and pages had two places
 * that could change them. One place now: wherever you actually work on the thing.
 *
 * It also replaced the old toolbar "Share" button, which minted a read-only link — a *third* way to hand a
 * page to someone, alongside visibility and "Invite to build", with the least clear semantics of the three.
 * What survives of it is the copy link under `public`, which is the delivery mechanism that setting needs.
 *
 * State is fetched when the menu opens rather than held in a context, because it is read once per interaction
 * and the playground's load path is shared with the guest editor — which must never see this control at all.
 * The playground gates on `editingPatternId`, which guests never have.
 */

/** Which kind of thing is being configured. The two differ only in their read and write endpoints. */
export type MetaResourceType = 'pattern' | 'design_artifact';

const VISIBILITY_ICON: Record<Visibility, LucideIcon> = {
  private: Lock,
  shared: Users,
  team: Building2,
  public: Globe,
};

interface Meta {
  visibility: Visibility;
  status: Lifecycle;
  /** Patterns only — a design artifact is neither a page nor a template. */
  kind: PatternKind;
  canChangeVisibility: boolean;
  canApprove: boolean;
}

export default function MetaControl({
  resourceType,
  resourceId,
  basePath = '',
}: {
  resourceType: MetaResourceType;
  resourceId: string;
  basePath?: string;
}) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The public view-only URL, once there is one. Null while unknown or when the page is not public. */
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Make sure a `public` page actually has a URL somebody can open (roadmap E.7b).
   *
   * `public` means "anyone with the link, view only" — a setting with no link is not a setting, it is a
   * dead end, which is exactly what removing the old share control left behind. So this reads the existing
   * view-only link and mints one only if there is none.
   *
   * Safe to mint on demand because a **view-only** link is not hashed (`createShareLink` only hashes
   * write-capable ones), so it stays recoverable on every later visit rather than being a copy-it-now-or-lose-it
   * secret. One link per page, reused, revocable.
   */
  const ensurePublicLink = useCallback(async () => {
    const query = `resourceType=${resourceType}&resourceId=${encodeURIComponent(resourceId)}`;
    const toUrl = (token: string) => `${window.location.origin}${basePath}/s/${token}`;
    try {
      const existing = await fetch(handoffApiUrl(`/api/handoff/share?${query}`), { credentials: 'include' });
      const found = (await existing.json()) as { token?: string | null; error?: string };
      if (existing.ok && found.token) {
        setPublicUrl(toUrl(found.token));
        return;
      }
      // Omitting `capabilities` is what makes this a read-only viewer link — see the share route.
      const created = await fetch(handoffApiUrl('/api/handoff/share'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ resourceType, resourceId }),
      });
      const minted = (await created.json()) as { token?: string; error?: string };
      if (!created.ok || !minted.token) throw new Error(minted.error || 'Could not create a link.');
      setPublicUrl(toUrl(minted.token));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not get a public link.');
    }
  }, [resourceType, resourceId, basePath]);

  /**
   * Loaded from the pattern detail endpoint, which already returns `permissions` computed by the same
   * `computePermissions` the server action enforces with. Reusing it means the control cannot offer a change
   * the write would refuse.
   */
  const load = useCallback(async () => {
    setError(null);
    try {
      const path =
        resourceType === 'pattern'
          ? `/api/handoff/patterns/${encodeURIComponent(resourceId)}`
          : `/api/handoff/ai/design-artifact/${encodeURIComponent(resourceId)}`;
      const res = await fetch(handoffApiUrl(path), { credentials: 'include' });
      // Both endpoints return `permissions` from the same `computePermissions`; they differ only in the key
      // holding the row, so the control can never offer a change its write would refuse.
      const json = (await res.json()) as {
        pattern?: { visibility?: string; status?: string; kind?: string };
        artifact?: { visibility?: string; status?: string };
        permissions?: { canChangeVisibility?: boolean; canApprove?: boolean };
        error?: string;
      };
      const row = json.pattern ?? json.artifact;
      if (!res.ok || !row) throw new Error(json.error || 'Could not load these settings.');
      const visibility = (row.visibility ?? 'private') as Visibility;
      setMeta({
        visibility,
        status: (row.status ?? 'draft') as Lifecycle,
        kind: patternKind((json.pattern as { kind?: string } | undefined)?.kind),
        canChangeVisibility: Boolean(json.permissions?.canChangeVisibility),
        canApprove: Boolean(json.permissions?.canApprove),
      });
      if (visibility === 'public') void ensurePublicLink();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load these settings.');
    }
  }, [resourceType, resourceId, ensurePublicLink]);

  /**
   * Optimistic, then reconciled by reverting on failure.
   *
   * The alternative — waiting for the round trip before moving the radio — makes the picker feel broken on a
   * slow connection. Reverting is honest about a refusal because the gate lives in `applyPatternMeta`, so a
   * change this UI thought was allowed can still be denied.
   */
  const apply = useCallback(
    async (change: { visibility?: Visibility; status?: Lifecycle; kind?: PatternKind }) => {
      if (!meta) return;
      const previous = meta;
      setMeta({ ...meta, ...change });
      setBusy(true);
      setError(null);
      try {
        if (resourceType === 'pattern') {
          await setPatternMeta(resourceId, change);
        } else {
          /**
           * The **collection** route, not `/design-artifact/[id]` — that one has no PATCH handler, so the
           * library's old artifact controls were posting into a 405 and every change failed silently with
           * "Could not update." (found 2026-08-06). The gate lives in this handler.
           */
          const res = await fetch(handoffApiUrl('/api/handoff/ai/design-artifact'), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ id: resourceId, ...change }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(body.error || 'Could not save that change.');
          }
        }
        // Only after the write lands — offering a link for a visibility change that was refused would be a lie.
        if (change.visibility === 'public') void ensurePublicLink();
      } catch (e) {
        setMeta(previous);
        setError(e instanceof Error ? e.message : 'Could not save that change.');
      } finally {
        setBusy(false);
      }
    },
    [meta, resourceType, resourceId, ensurePublicLink]
  );

  // Before the first load there is nothing truthful to show, so the trigger stays neutral rather than
  // guessing "Private" and correcting itself a moment later.
  const Icon = meta ? VISIBILITY_ICON[meta.visibility] : Lock;
  const label = meta ? VISIBILITY_META[meta.visibility].label : 'Settings';

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) void load();
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="h-8 gap-1 px-2">
          <Icon className="h-4 w-4" aria-hidden />
          <span className="text-xs">{label}</span>
          {meta ? (
            <span className="text-xs text-muted-foreground">
              {/* A template says so in the trigger: it changes what sharing this thing means, so it should not
                  take opening a menu to find out. A plain page needs no such announcement. */}
              {meta.kind === 'template' ? `· ${KIND_META.template.label} ` : ''}· {LIFECYCLE_META[meta.status].short}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 p-3">
        {error ? (
          <p role="alert" className="mb-2 text-xs text-amber-700 dark:text-amber-400">
            {error}
          </p>
        ) : null}

        {meta ? (
          <div className="space-y-4">
            {/**
              * Kind sits above visibility because it is the bigger question: "what is this" governs what
              * sharing it even means. Patterns only — a design artifact is neither a page nor a template.
              */}
            {resourceType === 'pattern' ? (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What it is</p>
                <KindPicker
                  value={meta.kind}
                  onChange={(kind) => void apply({ kind })}
                  disabled={!meta.canChangeVisibility || busy}
                />
                {!meta.canChangeVisibility ? (
                  <p className="text-xs text-muted-foreground">Only the owner or an admin can change this.</p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Who can see it</p>
              <VisibilityPicker
                value={meta.visibility}
                onChange={(visibility) => void apply({ visibility })}
                disabled={!meta.canChangeVisibility || busy}
              />
              {!meta.canChangeVisibility ? (
                <p className="text-xs text-muted-foreground">Only the owner or an admin can change this.</p>
              ) : null}

              {/**
                * The link that makes `public` mean something. Deliberately just the URL — capability picking,
                * expiry and max-uses belong to "Invite to build", which is a different act (Brad, 2026-08-05).
                */}
              {/**
                * Patterns only. A design artifact already has its own public-sharing control on its detail
                * page (`publicAccess` + `/design/library/<id>/share`), and adding a share-link URL here would
                * give artifacts two competing "public" mechanisms — the exact duplication E.7 removes.
                */}
              {meta.visibility === 'public' && resourceType === 'pattern' ? (
                <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
                  <p className="text-xs font-medium">Anyone with this link can view it</p>
                  {publicUrl ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        readOnly
                        value={publicUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-xs text-foreground"
                        aria-label="Public link"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={async () => {
                          await navigator.clipboard.writeText(publicUrl);
                          setCopied(true);
                          window.setTimeout(() => setCopied(false), 1500);
                        }}
                      >
                        {copied ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Getting the link…</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="space-y-2 border-t pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
              <LifecyclePicker
                value={meta.status}
                onChange={(status) => void apply({ status })}
                canApprove={meta.canApprove}
                disabled={busy}
              />
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{error ? '' : 'Loading…'}</p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
