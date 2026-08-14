'use client';

import type { PatternListObject } from '@handoff/transformers/preview/types';
import { Layout, PenNib, Stack } from '@phosphor-icons/react';
import { ChevronDown, Info, Loader2, PlusIcon, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AssetCard, type LibraryAsset } from '@/components/library';
import NameNewRecordDialog from '@/components/library/NameNewRecordDialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  LANES,
  LANE_META,
  patternKind,
  type Lane,
  type Lifecycle,
  type PatternKind,
  type ResourcePermissions,
  type Visibility,
} from '@/lib/authz/vocab';
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

/** Pattern lane row shape, as `/api/handoff/patterns?lane=` returns it. */
type PatternRow = PatternListObject & {
  _source?: string | null;
  /** `page` | `template` | `brief` — see `patternRowToListEntry`. Absent on a pre-0029 response. */
  _kind?: string;
  _thumbnail?: string | null;
  _updatedAt?: string | null;
  visibility: string;
  status: string;
  permissions: ResourcePermissions | null;
  owner: Owner;
  isMe: boolean;
};

/**
 * The three kinds a person browses — Designs, Pages, Templates (reflow R.1).
 *
 * `design` maps to its own stream; `page` and `template` are both patterns, split by `kind`. The facet is
 * what someone is looking for, which is not the same axis as which endpoint the row came from.
 */
type TypeFacet = 'all' | 'design' | 'page' | 'template';

/** What facet an asset belongs to — its user-facing kind, not its storage type. */
function facetOf(asset: LibraryAsset): Exclude<TypeFacet, 'all'> {
  if (asset.type === 'design') return 'design';
  return asset.kind === 'template' ? 'template' : 'page';
}

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

/**
 * Rows that are not first-class library objects.
 *
 * **Only briefs now** (reflow R.1). They are the frozen snapshots the reflow retires — versioned children of
 * one page, with no independent visibility (they inherit their parent's), so listing them would imply a
 * sharing state they do not own. Migration 0029 marks them `kind: 'brief'`; `_source` is the fallback for a
 * row read from a database where that migration has not run yet.
 *
 * ⚠️ **Guest submissions are no longer hidden.** Under E.6 they were "someone else's work against your brief,
 * not an asset of yours". The reflow's whole point is that they *are* pages, owned by the template's owner —
 * so hiding them would leave a library that omits the pages the product exists to produce.
 */
function isNotALibraryObject(row: PatternRow): boolean {
  return row._kind === 'brief' || (row._kind === undefined && row._source === 'template');
}

function normalizePattern(row: PatternRow): LibraryAsset {
  return {
    type: 'pattern',
    kind: patternKind(row._kind),
    id: row.id,
    title: row.title,
    thumbnailUrl: row._thumbnail ?? null,
    owner: row.owner,
    isMe: row.isMe,
    visibility: row.visibility as Visibility,
    status: row.status as Lifecycle,
    permissions: row.permissions,
    updatedAt: row._updatedAt ?? null,
    // The list API prefixes its extra fields: `_source`, not `source` (see `patternRowToListEntry`).
    source: row._source ?? null,
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

export default function LibraryClient({
  isLoggedIn,
  isMaintainer = false,
  pendingReviews = 0,
}: {
  isLoggedIn: boolean;
  isMaintainer?: boolean;
  pendingReviews?: number;
}) {
  const router = useRouter();
  const basePath = handoffBasePath();

  const [lane, setLane] = useState<Lane>('yours');
  const [typeFacet, setTypeFacet] = useState<TypeFacet>('all');
  const [designAssets, setDesignAssets] = useState<LibraryAsset[]>([]);
  const [patternAssets, setPatternAssets] = useState<LibraryAsset[]>([]);
  // Per-type next-page cursors (null once that stream is exhausted).
  const [designCursor, setDesignCursor] = useState<string | null>(null);
  const [patternCursor, setPatternCursor] = useState<string | null>(null);
  /** Which kind the naming dialog is open for, or null when it is closed. */
  const [naming, setNaming] = useState<PatternKind | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      /**
       * The kind facet is applied **in SQL**, not to whatever happens to be on screen.
       *
       * Filtering client-side meant "Templates" showed nothing whenever the first page was all pages, and the
       * only way to find out otherwise was to click Load more blindly (Brad: "we can't see all the data").
       */
      if (typeFacet === 'page' || typeFacet === 'template') patternParams.set('kind', typeFacet);

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
      setPatternAssets((patternJson.patterns ?? []).filter((r) => !isNotALibraryObject(r)).map(normalizePattern));
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
    // `typeFacet` is in the query now, so it belongs here: without it, changing the facet would filter the
    // rows already on screen and never ask the server for the ones it does not have.
  }, [isLoggedIn, lane, typeFacet]);

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
            if (typeFacet === 'page' || typeFacet === 'template') patternParams.set('kind', typeFacet);
            patternParams.set('limit', String(PAGE_SIZE));
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
            setPatternAssets((prev) => [
              ...prev,
              ...(json.patterns ?? []).filter((r) => !isNotALibraryObject(r)).map(normalizePattern),
            ]);
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
  }, [isLoggedIn, loadingMore, lane, designCursor, patternCursor, typeFacet]);

  // Re-fetch both surfaces whenever the lane changes.
  useEffect(() => {
    void load();
  }, [load]);

  // Merge both types and sort newest-first.
  const mergedAssets = useMemo(() => {
    return [...designAssets, ...patternAssets].sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt));
  }, [designAssets, patternAssets]);

  const visibleAssets = useMemo(() => {
    if (typeFacet === 'all') return mergedAssets;
    return mergedAssets.filter((a) => facetOf(a) === typeFacet);
  }, [mergedAssets, typeFacet]);

  /**
   * Whether the current facet still has a next page to fetch.
   *
   * Pages and templates share one stream — the API paginates patterns, not kinds — so both watch the pattern
   * cursor. A template-only view can therefore say "more available" and then load a page of pages; that is
   * honest about the cursor, and the alternative (a per-kind cursor) is a server change for a facet most
   * libraries will never paginate.
   */
  const hasMore =
    typeFacet === 'design'
      ? Boolean(designCursor)
      : typeFacet === 'page' || typeFacet === 'template'
        ? Boolean(patternCursor)
        : Boolean(designCursor || patternCursor);

  const handleLaneChange = useCallback((next: Lane) => {
    setLane(next);
    setError(null);
  }, []);

  const openAsset = useCallback(
    (asset: LibraryAsset) => {
      if (asset.type === 'design') {
        router.push(`${basePath}/design/library/${asset.id}/`);
      } else {
        // Real route (roadmap E.3). The query form still works, but this is the shape to link.
        router.push(`${basePath}/playground/${encodeURIComponent(asset.id)}`);
      }
    },
    [router, basePath],
  );

  const launchButtons = (
    <>
      {/* The way into the review queue. Shown only to maintainers, and only worth a badge when something
          is actually waiting — a permanent "0" trains people to ignore it. */}
      {isMaintainer ? (
        <Button asChild size="sm" variant={pendingReviews > 0 ? 'default' : 'outline'} className="gap-1">
          <Link href={`${basePath}/review`}>
            Review queue
            {pendingReviews > 0 ? (
              <span className="ml-1 rounded-full bg-background/20 px-1.5 text-xs font-semibold">{pendingReviews}</span>
            ) : null}
          </Link>
        </Button>
      ) : null}
      <Button asChild size="sm" className="gap-1">
        <Link href={`${basePath}/design`}>
          <Sparkles className="h-4 w-4" aria-hidden />
          New design
        </Link>
      </Button>
      <Button asChild size="sm" variant="secondary" className="gap-1">
        <Link href={`${basePath}/playground`}>
          <PlusIcon className="h-4 w-4" aria-hidden />
          New page
        </Link>
      </Button>
    </>
  );

  const typeFacets: { value: TypeFacet; label: string }[] = [
    { value: 'all', label: 'All types' },
    { value: 'design', label: 'Designs' },
    { value: 'page', label: 'Pages' },
    { value: 'template', label: 'Templates' },
  ];

  return (
    <>
    <div className="flex h-full min-h-0 overflow-hidden bg-background">
      {/* Main area — slim top bar + scrolling card grid. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Slim top bar */}
        <div className="shrink-0 border-b border-gray-200 bg-gray-100/50 dark:border-gray-800 dark:bg-gray-900/50 py-3">
          <div className="container mx-auto flex max-w-[1500px] items-center justify-between gap-3 px-8">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold tracking-tight">Library</h1>
            {isLoggedIn && !loading && visibleAssets.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                {visibleAssets.length} item{visibleAssets.length === 1 ? '' : 's'}
                {hasMore ? ' · more available' : ''}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <Select value={typeFacet} onValueChange={(v) => setTypeFacet(v as TypeFacet)}>
              <SelectTrigger className="h-8 w-[120px] text-xs" aria-label="Filter by type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {typeFacets.map((f) => (
                  <SelectItem key={f.value} value={f.value} className="text-xs">
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={lane} onValueChange={(v) => handleLaneChange(v as Lane)}>
              <SelectTrigger className="h-8 w-[130px] text-xs" aria-label="Filter by lane">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANES.map((l) => (
                  <SelectItem key={l} value={l} className="text-xs">
                    {l === 'yours' ? 'My files' : LANE_META[l].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger className="ml-5 flex h-8 items-center gap-1.5 rounded-md bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring">
                New
                <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`${basePath}/design`} className="flex items-center gap-2">
                    <PenNib className="h-4 w-4" aria-hidden />
                    Design
                  </Link>
                </DropdownMenuItem>
                {/* Both open the naming dialog first — see `NameNewRecordDialog` for why the name is asked
                    for here rather than discovered later in the toolbar. */}
                <DropdownMenuItem onSelect={() => setNaming('page')} className="flex items-center gap-2">
                  <Layout className="h-4 w-4" aria-hidden />
                  Page
                </DropdownMenuItem>
                {/**
                  * **Template, from scratch** (Brad, 2026-08-13).
                  *
                  * Promotion from a page stays the common path — sharing a page offers it — but a template is a
                  * thing someone sets out to make, and requiring them to make a page first and convert it is the
                  * dev-shaped version of that. Same editor, same tool; only what the first save writes differs.
                  */}
                <DropdownMenuItem onSelect={() => setNaming('template')} className="flex items-center gap-2">
                  <Stack className="h-4 w-4" aria-hidden />
                  Template
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <NameNewRecordDialog
              kind={naming ?? 'page'}
              open={naming !== null}
              onOpenChange={(open) => {
                if (!open) setNaming(null);
              }}
              basePath={basePath}
            />
          </div>
          </div>
        </div>

        {/* Scroll region */}
        <div className="flex-1 overflow-y-auto py-10">
          <div className="container mx-auto max-w-[1500px] px-8">
          <h2 className="text-center text-4xl font-semibold tracking-tight">Prototype Library</h2>
          <p className="mx-auto mb-10 mt-3 max-w-2xl text-center text-lg font-light leading-relaxed text-muted-foreground">
            Designs and pages built with your design system - generate them with AI, refine them in chat, and share
            the results with your team.
          </p>
          {/* Notices */}
          {error ? (
            <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <Info className="h-4 w-4 shrink-0" aria-hidden />
              <span>{error}</span>
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
              <ul className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visibleAssets.map((asset) => (
                  <AssetCard
                    key={keyOf(asset)}
                    asset={asset}
                    onOpen={() => openAsset(asset)}
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
      </div>
    </div>

    </>
  );
}
