'use client';

import { useCallback, useState } from 'react';
import { Building2, Globe, Lock, Users, type LucideIcon } from 'lucide-react';
import { Button } from '../ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { VisibilityPicker } from '../library/VisibilityPicker';
import { LifecyclePicker } from '../library/LifecyclePicker';
import { setPatternMeta } from '@/app/actions/patterns';
import { handoffApiUrl } from '@/lib/api-path';
import { LIFECYCLE_META, VISIBILITY_META, type Lifecycle, type Visibility } from '@/lib/authz/vocab';

/**
 * Who can see this page, and where it is in its lifecycle — on the page itself.
 *
 * Replaces the old "Share" button in the toolbar (Brad, 2026-08-05). That button minted a read-only share
 * link, which was a *third* way to hand a page to someone alongside visibility and "Invite to build", with
 * the least clear semantics of the three. Sending a page out is now one flow; this control answers the
 * different question of who the page is for.
 *
 * State is fetched when the menu opens rather than held in `PlaygroundContext`, because it is read once per
 * interaction and the context's load path is shared with the guest editor — which must never see this
 * control at all. The caller gates on `editingPatternId`, which guests never have.
 */

const VISIBILITY_ICON: Record<Visibility, LucideIcon> = {
  private: Lock,
  shared: Users,
  team: Building2,
  public: Globe,
};

interface Meta {
  visibility: Visibility;
  status: Lifecycle;
  canChangeVisibility: boolean;
  canApprove: boolean;
}

export default function PageMetaControl({ patternId }: { patternId: string }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Loaded from the pattern detail endpoint, which already returns `permissions` computed by the same
   * `computePermissions` the server action enforces with. Reusing it means the control cannot offer a change
   * the write would refuse.
   */
  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(patternId)}`), {
        credentials: 'include',
      });
      const json = (await res.json()) as {
        pattern?: { visibility?: string; status?: string };
        permissions?: { canChangeVisibility?: boolean; canApprove?: boolean };
        error?: string;
      };
      if (!res.ok || !json.pattern) throw new Error(json.error || 'Could not load this page’s settings.');
      setMeta({
        visibility: (json.pattern.visibility ?? 'private') as Visibility,
        status: (json.pattern.status ?? 'draft') as Lifecycle,
        canChangeVisibility: Boolean(json.permissions?.canChangeVisibility),
        canApprove: Boolean(json.permissions?.canApprove),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this page’s settings.');
    }
  }, [patternId]);

  /**
   * Optimistic, then reconciled by reverting on failure.
   *
   * The alternative — waiting for the round trip before moving the radio — makes the picker feel broken on a
   * slow connection. Reverting is honest about a refusal because the gate lives in `applyPatternMeta`, so a
   * change this UI thought was allowed can still be denied.
   */
  const apply = useCallback(
    async (change: { visibility?: Visibility; status?: Lifecycle }) => {
      if (!meta) return;
      const previous = meta;
      setMeta({ ...meta, ...change });
      setBusy(true);
      setError(null);
      try {
        await setPatternMeta(patternId, change);
      } catch (e) {
        setMeta(previous);
        setError(e instanceof Error ? e.message : 'Could not save that change.');
      } finally {
        setBusy(false);
      }
    },
    [meta, patternId]
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
            <span className="text-xs text-muted-foreground">· {LIFECYCLE_META[meta.status].short}</span>
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
