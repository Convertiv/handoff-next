'use client';

import type { PatternListObject } from '@handoff/transformers/preview/types';
import { Info, Loader2, PlusIcon, Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { setPatternMeta } from '@/app/actions/patterns';
import { AssetCard, AssetInspector, type LibraryAsset } from '@/components/library';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { LANES, LANE_META, type Lane, type Lifecycle, type ResourcePermissions, type Visibility } from '@/lib/authz/vocab';
import { handoffApiUrl, handoffBasePath } from '@/lib/api-path';

type Owner = { id: string; name?: string | null; image?: string | null } | null;

/** Design-artifact lane row shape (mirrors DesignClient's LibraryArtifactRow). */
type DesignRow = {
  id: string;
  title: string;
  description?: string;
  status: string;
  imageUrl?: string | null;
  updatedAt?: string | null;
  visibility: string;
  permissions: ResourcePermissions | null;
  owner: Owner;
  isMe: boolean;
};

/** Pattern lane row shape (mirrors PatternPicker's PatternListEntry). */
type PatternRow = PatternListObject & {
  _thumbnail?: string | null;
  _updatedAt?: string | null;
  visibility: string;
  status: string;
  permissions: ResourcePermissions | null;
  owner: Owner;
  isMe: boolean;
};

type TypeFacet = 'all' | 'design' | 'pattern';

// Each type paginates independently via its own `nextCursor`; the shared "Load more"
// control advances whichever streams still have a next page, then re-merges the two
// accumulated lists into one newest-first view (approximate frontier ordering is fine).
const PAGE_SIZE = 50;

function normalizeDesign(row: DesignRow): LibraryAsset {
  return {
    type: 'design',
    id: row.id,
    title: row.title,
    thumbnailUrl: row.imageUrl ?? null,
    owner: row.owner,
    isMe: row.isMe,
    visibility: row.visibility as Visibility,
    status: row.status as Lifecycle,
    permissions: row.permissions,
    updatedAt: row.updatedAt ?? null,
  };
}

function normalizePattern(row: PatternRow): LibraryAsset {
  return {
    type: 'pattern',
    id: row.id,
    title: row.title,
    thumbnailUrl: row._thumbnail ?? null,
    owner: row.owner,
    isMe: row.isMe,
    visibility: row.visibility as Visibility,
    status: row.status as Lifecycle,
    permissions: row.permissions,
    updatedAt: row._updatedAt ?? null,
  };
}

function toMillis(value: LibraryAsset['updatedAt']): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/** Composite key so a design and a pattern can never collide in local maps. */
function keyOf(asset: Pick<LibraryAsset, 'type' | 'id'>): string {
  return `${asset.type}:${asset.id}`;
}

export default function LibraryClient({ isLoggedIn }: { isLoggedIn: boolean }) {
  const router = useRouter();
  const basePath = handoffBasePath();

  const [lane, setLane] = useState<Lane>('yours');
  const [typeFacet, setTypeFacet] = useState<TypeFacet>('all');
  const [q, setQ] = useState('');
  const [committedQ, setCommittedQ] = useState('');

  const [designAssets, setDesignAssets] = useState<LibraryAsset[]>([]);
  const [patternAssets, setPatternAssets] = useState<LibraryAsset[]>([]);
  // Per-type next-page cursors (null once that stream is exhausted).
  const [designCursor, setDesignCursor] = useState<string | null>(null);
  const [patternCursor, setPatternCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Inspector state.
  const [inspectorKey, setInspectorKey] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Public share links minted this session, keyed by composite asset key.
  const [shareUrls, setShareUrls] = useState<Record<string, string | null>>({});

  const load = useCallback(async () => {
    if (!isLoggedIn) {
      setDesignAssets([]);
      setPatternAssets([]);
      setDesignCursor(null);
      setPatternCursor(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const patternParams = new URLSearchParams();
      patternParams.set('lane', lane);
      patternParams.set('limit', String(PAGE_SIZE));
      if (committedQ.trim()) patternParams.set('q', committedQ.trim());

      const [designRes, patternRes] = await Promise.all([
        fetch(handoffApiUrl(`/api/handoff/ai/design-artifact?limit=${PAGE_SIZE}&lane=${lane}`), {
          credentials: 'include',
        }),
        fetch(handoffApiUrl(`/api/handoff/patterns?${patternParams.toString()}`), {
          credentials: 'include',
        }),
      ]);

      const designJson = (await designRes.json().catch(() => ({}))) as {
        artifacts?: DesignRow[];
        nextCursor?: string | null;
        error?: string;
      };
      const patternJson = (await patternRes.json().catch(() => ({}))) as {
        patterns?: PatternRow[];
        nextCursor?: string | null;
        error?: string;
      };

      if (!designRes.ok) throw new Error(designJson.error || `Failed to load designs (${designRes.status})`);
      if (!patternRes.ok) throw new Error(patternJson.error || `Failed to load patterns (${patternRes.status})`);

      setDesignAssets((designJson.artifacts ?? []).map(normalizeDesign));
      setPatternAssets((patternJson.patterns ?? []).map(normalizePattern));
      setDesignCursor(designJson.nextCursor ?? null);
      setPatternCursor(patternJson.nextCursor ?? null);
    } catch (e) {
      setDesignAssets([]);
      setPatternAssets([]);
      setDesignCursor(null);
      setPatternCursor(null);
      setError(e instanceof Error ? e.message : 'Could not load the library.');
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, lane, committedQ]);

  // Advance whichever streams still have a next page, appending to the accumulated
  // per-type lists. The merged/sorted view is re-derived downstream in `mergedAssets`.
  const loadMore = useCallback(async () => {
    if (!isLoggedIn || loadingMore) return;
    if (!designCursor && !patternCursor) return;
    setLoadingMore(true);
    setError(null);
    try {
      const tasks: Promise<void>[] = [];
      if (designCursor) {
        tasks.push(
          (async () => {
            const res = await fetch(
              handoffApiUrl(
                `/api/handoff/ai/design-artifact?limit=${PAGE_SIZE}&lane=${lane}&cursor=${encodeURIComponent(designCursor)}`,
              ),
              { credentials: 'include' },
            );
            const json = (await res.json().catch(() => ({}))) as {
              artifacts?: DesignRow[];
              nextCursor?: string | null;
              error?: string;
            };
            if (!res.ok) throw new Error(json.error || `Failed to load designs (${res.status})`);
            setDesignAssets((prev) => [...prev, ...(json.artifacts ?? []).map(normalizeDesign)]);
            setDesignCursor(json.nextCursor ?? null);
          })(),
        );
      }
      if (patternCursor) {
        tasks.push(
          (async () => {
            const patternParams = new URLSearchParams();
            patternParams.set('lane', lane);
            patternParams.set('limit', String(PAGE_SIZE));
            if (committedQ.trim()) patternParams.set('q', committedQ.trim());
            patternParams.set('cursor', patternCursor);
            const res = await fetch(handoffApiUrl(`/api/handoff/patterns?${patternParams.toString()}`), {
              credentials: 'include',
            });
            const json = (await res.json().catch(() => ({}))) as {
              patterns?: PatternRow[];
              nextCursor?: string | null;
              error?: string;
            };
            if (!res.ok) throw new Error(json.error || `Failed to load patterns (${res.status})`);
            setPatternAssets((prev) => [...prev, ...(json.patterns ?? []).map(normalizePattern)]);
            setPatternCursor(json.nextCursor ?? null);
          })(),
        );
      }
      await Promise.all(tasks);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load more items.');
    } finally {
      setLoadingMore(false);
    }
  }, [isLoggedIn, loadingMore, lane, committedQ, designCursor, patternCursor]);

  // Re-fetch both surfaces whenever the lane or the committed search changes.
  useEffect(() => {
    void load();
  }, [load]);

  // Merge both types and sort newest-first. Search `q` filters patterns via the
  // API already; designs have no server-side search, so filter them by title here.
  const mergedAssets = useMemo(() => {
    const query = committedQ.trim().toLowerCase();
    const designs = query
      ? designAssets.filter((a) => a.title.toLowerCase().includes(query))
      : designAssets;
    return [...designs, ...patternAssets].sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
  }, [designAssets, patternAssets, committedQ]);

  const visibleAssets = useMemo(() => {
    if (typeFacet === 'all') return mergedAssets;
    return mergedAssets.filter((a) => a.type === typeFacet);
  }, [mergedAssets, typeFacet]);

  // Whether the current facet still has a next page to fetch.
  const hasMore =
    typeFacet === 'design'
      ? Boolean(designCursor)
      : typeFacet === 'pattern'
        ? Boolean(patternCursor)
        : Boolean(designCursor || patternCursor);

  const selected = useMemo(
    () => visibleAssets.find((a) => keyOf(a) === inspectorKey) ?? mergedAssets.find((a) => keyOf(a) === inspectorKey) ?? null,
    [visibleAssets, mergedAssets, inspectorKey],
  );

  // When the inspector opens for an asset, surface any EXISTING public link (not
  // just links minted this session). `undefined` = not yet checked; `null` = known
  // to have none. Non-owners get a quiet 403 and simply see no link.
  useEffect(() => {
    if (!inspectorOpen || !selected) return;
    const key = keyOf(selected);
    if (shareUrls[key] !== undefined) return;
    const resourceType = selected.type === 'design' ? 'design_artifact' : 'pattern';
    const resourceId = selected.id;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          handoffApiUrl(`/api/handoff/share?resourceType=${resourceType}&resourceId=${encodeURIComponent(resourceId)}`),
          { credentials: 'include' },
        );
        if (cancelled) return;
        if (!res.ok) {
          setShareUrls((prev) => (prev[key] === undefined ? { ...prev, [key]: null } : prev));
          return;
        }
        const json = (await res.json().catch(() => ({}))) as { token?: string | null };
        if (cancelled) return;
        const url = json.token ? `${window.location.origin}${basePath}/s/${json.token}` : null;
        setShareUrls((prev) => (prev[key] === undefined ? { ...prev, [key]: url } : prev));
      } catch {
        /* quiet — no existing link surfaced */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inspectorOpen, selected, shareUrls, basePath]);

  const submitSearch = useCallback(() => setCommittedQ(q), [q]);

  const handleLaneChange = useCallback((next: Lane) => {
    setLane(next);
    setError(null);
    setNotice(null);
  }, []);

  const openAsset = useCallback(
    (asset: LibraryAsset) => {
      if (asset.type === 'design') {
        router.push(`${basePath}/design/library/${asset.id}/`);
      } else {
        router.push(`${basePath}/playground?pattern=${encodeURIComponent(asset.id)}`);
      }
    },
    [router, basePath],
  );

  const openDetails = useCallback((asset: LibraryAsset) => {
    setInspectorKey(keyOf(asset));
    setInspectorOpen(true);
  }, []);

  // ---- Local optimistic patch of a normalized asset ------------------------
  const patchLocal = useCallback((asset: LibraryAsset, patch: Partial<LibraryAsset>) => {
    const setter = asset.type === 'design' ? setDesignAssets : setPatternAssets;
    setter((prev) => prev.map((a) => (a.id === asset.id ? { ...a, ...patch } : a)));
  }, []);

  // ---- Design PATCH helper (mirrors DesignClient) --------------------------
  const patchArtifactFields = useCallback(
    async (id: string, patch: { visibility?: Visibility; status?: Lifecycle; publicAccess?: boolean }) => {
      const res = await fetch(handoffApiUrl('/api/handoff/ai/design-artifact'), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...patch }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        id?: string;
        visibility?: Visibility;
        status?: Lifecycle;
        publicAccess?: boolean;
        error?: string;
      };
      if (!res.ok) throw new Error(json.error || `Update failed (${res.status})`);
      return json;
    },
    [],
  );

  const handleSetLifecycle = useCallback(
    async (status: Lifecycle) => {
      if (!selected) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        if (selected.type === 'design') {
          const updated = await patchArtifactFields(selected.id, { status });
          patchLocal(selected, { status: (updated.status as Lifecycle | undefined) ?? status });
        } else {
          await setPatternMeta(selected.id, { status });
          patchLocal(selected, { status });
        }
        setNotice('Lifecycle updated.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not update lifecycle.');
      } finally {
        setBusy(false);
      }
    },
    [selected, patchArtifactFields, patchLocal],
  );

  const handleSetVisibility = useCallback(
    async (visibility: Visibility) => {
      if (!selected) return;
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        if (selected.type === 'design') {
          // One PATCH applies visibility + legacy publicAccess together; sync local
          // state from the returned row so the badge reflects the server's decision.
          const updated = await patchArtifactFields(selected.id, {
            visibility,
            publicAccess: visibility === 'public',
          });
          patchLocal(selected, { visibility: (updated.visibility as Visibility | undefined) ?? visibility });
        } else {
          await setPatternMeta(selected.id, { visibility });
          patchLocal(selected, { visibility });
        }
        setNotice('Visibility updated.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not update visibility.');
      } finally {
        setBusy(false);
      }
    },
    [selected, patchArtifactFields, patchLocal],
  );

  const handleDuplicate = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (selected.type === 'design') {
        const res = await fetch(handoffApiUrl(`/api/handoff/ai/design-artifact/${selected.id}/clone`), {
          method: 'POST',
          credentials: 'include',
        });
        const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
        if (!res.ok) throw new Error(json.error || `Could not duplicate design (${res.status})`);
        await load();
        if (json.id) setInspectorKey(`design:${json.id}`);
        setNotice('Design duplicated.');
      } else {
        const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${selected.id}/clone`), {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json().catch(() => ({}))) as { id?: string };
        await load();
        if (json.id) setInspectorKey(`pattern:${json.id}`);
        setNotice('Pattern duplicated.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not duplicate.');
    } finally {
      setBusy(false);
    }
  }, [selected, load]);

  const handleCreateShare = useCallback(async () => {
    if (!selected) return;
    const key = keyOf(selected);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/share'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceType: selected.type === 'design' ? 'design_artifact' : 'pattern',
          resourceId: selected.id,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
      if (!res.ok || !json.token) throw new Error(json.error || `Could not create link (${res.status})`);
      // Human-friendly public viewer page (base-path aware), not the JSON endpoint.
      const url = `${window.location.origin}${basePath}/s/${json.token}`;
      setShareUrls((prev) => ({ ...prev, [key]: url }));
      setNotice('Public link created.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create public link.');
    } finally {
      setBusy(false);
    }
  }, [selected, basePath]);

  const handleRevokeShare = useCallback(async () => {
    if (!selected) return;
    const key = keyOf(selected);
    const url = shareUrls[key];
    const token = url ? url.split('/').pop() : null;
    if (!token) {
      setShareUrls((prev) => ({ ...prev, [key]: null }));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/share?token=${encodeURIComponent(token)}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || `Could not revoke link (${res.status})`);
      setShareUrls((prev) => ({ ...prev, [key]: null }));
      setNotice('Public link revoked.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke public link.');
    } finally {
      setBusy(false);
    }
  }, [selected, shareUrls]);

  const launchButtons = (
    <>
      <Button asChild size="sm" className="gap-1">
        <Link href={`${basePath}/design`}>
          <Sparkles className="h-4 w-4" aria-hidden />
          New design
        </Link>
      </Button>
      <Button asChild size="sm" variant="secondary" className="gap-1">
        <Link href={`${basePath}/playground`}>
          <PlusIcon className="h-4 w-4" aria-hidden />
          New pattern
        </Link>
      </Button>
    </>
  );

  // Full-width stacked variant for the sidebar (same targets, vertical layout).
  const launchButtonsStacked = (
    <>
      <Button asChild size="sm" className="w-full justify-start gap-2">
        <Link href={`${basePath}/design`}>
          <Sparkles className="h-4 w-4" aria-hidden />
          New design
        </Link>
      </Button>
      <Button asChild size="sm" variant="secondary" className="w-full justify-start gap-2">
        <Link href={`${basePath}/playground`}>
          <PlusIcon className="h-4 w-4" aria-hidden />
          New pattern
        </Link>
      </Button>
    </>
  );

  const typeFacets: { value: TypeFacet; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'design', label: 'Designs' },
    { value: 'pattern', label: 'Patterns' },
  ];

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background">
      {/* Left sidebar — facets, lanes, search, launch (mirrors the builder shells). */}
      <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r bg-background">
        {/* Create */}
        <div className="flex flex-col gap-2 border-b p-3">
          <p className="text-xs font-medium text-muted-foreground">Create</p>
          {launchButtonsStacked}
        </div>

        {/* Type facet */}
        <div className="flex flex-col gap-2 border-b p-3">
          <p className="text-xs font-medium text-muted-foreground">Type</p>
          <nav className="flex flex-col gap-1">
            {typeFacets.map((f) => {
              const active = f.value === typeFacet;
              return (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTypeFacet(f.value)}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Lane selector — vertical list from the authz vocab. */}
        <div className="flex flex-col gap-2 border-b p-3">
          <p className="text-xs font-medium text-muted-foreground">Lane</p>
          <nav role="tablist" aria-label="Library lanes" className="flex flex-col gap-1">
            {LANES.map((l) => {
              const active = l === lane;
              return (
                <button
                  key={l}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleLaneChange(l)}
                  className={cn(
                    'rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
                    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  {LANE_META[l].label}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Search */}
        <div className="flex flex-col gap-2 p-3">
          <p className="text-xs font-medium text-muted-foreground">Search</p>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSearch();
              }}
            />
          </div>
          <Button type="button" variant="secondary" size="sm" className="w-full" onClick={submitSearch}>
            Search
          </Button>
        </div>
      </aside>

      {/* Main area — slim top bar + scrolling card grid. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Slim top bar */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Library</h1>
          {isLoggedIn && !loading && visibleAssets.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {visibleAssets.length} item{visibleAssets.length === 1 ? '' : 's'}
              {hasMore ? ' · more available' : ''}
            </p>
          ) : null}
        </div>

        {/* Scroll region */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Notices */}
          {error ? (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <Info className="h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
            </div>
          ) : null}
          {notice ? (
            <div className="mb-3 flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <Info className="h-4 w-4 shrink-0" aria-hidden />
              <span>{notice}</span>
            </div>
          ) : null}

          {/* Body */}
          {!isLoggedIn ? (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm text-muted-foreground">Sign in to browse and manage your library.</p>
              <div className="flex items-center gap-2">{launchButtons}</div>
            </div>
          ) : loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : visibleAssets.length === 0 ? (
            <div className="flex flex-col items-center gap-4 rounded-lg border border-dashed py-16 text-center">
              <p className="text-sm text-muted-foreground">
                Nothing here yet — start in the Workbench or Playground.
              </p>
              <div className="flex items-center gap-2">{launchButtons}</div>
            </div>
          ) : (
            <>
              <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visibleAssets.map((asset) => (
                  <AssetCard
                    key={keyOf(asset)}
                    asset={asset}
                    onOpen={() => openAsset(asset)}
                    onDetails={() => openDetails(asset)}
                    onDuplicate={() => openDetails(asset)}
                  />
                ))}
              </ul>
              {hasMore ? (
                <div className="mt-4 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                        Loading…
                      </>
                    ) : (
                      'Load more'
                    )}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* Inspector */}
      <AssetInspector
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        asset={
          selected
            ? {
                id: selected.id,
                title: selected.title,
                thumbnailUrl: selected.thumbnailUrl ?? null,
                owner: selected.owner,
                isMe: selected.isMe,
                visibility: selected.visibility,
                status: selected.status,
                surface: selected.type,
              }
            : null
        }
        permissions={selected?.permissions ?? null}
        busy={busy}
        onSetLifecycle={(s) => void handleSetLifecycle(s)}
        onSetVisibility={(v) => void handleSetVisibility(v)}
        onOpen={() => selected && openAsset(selected)}
        onDuplicate={() => void handleDuplicate()}
        shareUrl={selected ? shareUrls[keyOf(selected)] ?? null : null}
        onCreateShare={() => void handleCreateShare()}
        onRevokeShare={() => void handleRevokeShare()}
      />
    </div>
  );
}
