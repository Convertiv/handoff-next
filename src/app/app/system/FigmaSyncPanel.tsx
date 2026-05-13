'use client';

import type { FigmaAuditApiResponse, FigmaSyncApiResponse } from '@/lib/figma-sync-types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { handoffApiUrl } from '@/lib/api-path';
import { AlertCircle, ExternalLink, RefreshCw, Sparkles, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type Row =
  {
    kind: 'child';
    id: string;
    title: string;
    description: string;
    status: 'matched' | 'unlinked' | 'missing_in_handoff';
    matchedBy: 'component_key' | 'figma_component_id' | 'runtime_id' | null;
    missingMetadata: string[];
    imageCount: number;
    componentId?: string;
    suggestedComponentId: string;
    figmaComponentKey: string;
    figmaSlug: string;
    figmaHref?: string;
    thumb?: string;
    parentName?: string;
    variantLabel?: string;
  };

const toFigmaUrl = (fileKey?: string, nodeId?: string): string | undefined => {
  if (!fileKey || !nodeId) return undefined;
  return `https://www.figma.com/file/${fileKey}/?node-id=${encodeURIComponent(nodeId.replace(/:/g, '-'))}`;
};

function statusBadgeVariant(status: Row['status']): 'default' | 'secondary' | 'outline' {
  if (status === 'matched') return 'secondary';
  if (status === 'missing_in_handoff') return 'default';
  return 'outline';
}

function buildRows(data: FigmaAuditApiResponse | null): Row[] {
  if (!data) return [];

  return data.figmaComponents
    .map((entry) => ({
      kind: 'child' as const,
      id: `figma:${entry.figma.figmaComponentKey}`,
      title: entry.figma.figmaComponentName,
      description: entry.figma.figmaDescription || entry.component?.description || '',
      status: entry.status,
      matchedBy: entry.matchedBy,
      missingMetadata: entry.missingMetadata,
      imageCount: entry.figma.figmaImages?.length ?? 0,
      componentId: entry.component?.id,
      suggestedComponentId: entry.component?.id || entry.figma.slug,
      figmaComponentKey: entry.figma.figmaComponentKey,
      figmaSlug: entry.figma.slug,
      figmaHref: entry.figma.figma || toFigmaUrl(entry.figma.figmaFileKey, entry.figma.figmaNodeId),
      thumb: entry.figma.figmaThumbnailUrl || entry.component?.image || '',
      parentName: entry.figma.figmaComponentSetName,
      variantLabel: entry.figma.figmaVariantLabel,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function FigmaSyncPanel() {
  const { data: session, status } = useSession();
  const canManage = status === 'authenticated' && Boolean(session?.user) && session.user.role === 'admin';

  const [data, setData] = useState<FigmaAuditApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');

  const refresh = useCallback(async () => {
    if (!canManage) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/figma/components'), { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((json as { error?: string }).error || 'Failed to load Figma component audit.');
      setData(json as FigmaAuditApiResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Figma component audit.');
    } finally {
      setLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return buildRows(data).filter((row) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'missing_in_handoff' && row.status === 'missing_in_handoff') ||
        (filter === 'missing_metadata' && row.missingMetadata.length > 0) ||
        (filter === 'linked' && (row.status === 'matched' || row.status === 'unlinked'));
      if (!matchesFilter) return false;
      if (!q) return true;
      return [row.title, row.description, row.parentName, row.variantLabel, row.componentId, row.suggestedComponentId].some((value) =>
        value?.toLowerCase().includes(q)
      );
    });
  }, [data, filter, search]);

  const componentIssues = useMemo(
    () => (data?.components ?? []).filter((entry) => entry.status === 'ambiguous' || entry.status === 'missing_in_figma'),
    [data]
  );

  const runAction = useCallback(
    async (row: Row, action: 'create_component' | 'sync_metadata') => {
      if (action === 'sync_metadata' && !row.componentId) {
        setError('No linked Handoff component was found for this Figma child.');
        return;
      }
      setBusyRow(row.id);
      setMessage(null);
      setError(null);
      try {
        const res = await fetch(handoffApiUrl('/api/handoff/figma/components/sync'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            action,
            componentId: action === 'create_component' ? row.suggestedComponentId : row.componentId,
            figmaComponentKey: row.figmaComponentKey,
            figmaSlug: row.figmaSlug,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as FigmaSyncApiResponse & { error?: string };
        if (!res.ok) throw new Error(json.error || 'Sync failed.');
        setMessage(json.message || (action === 'create_component' ? 'Component created.' : 'Metadata synced.'));
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Sync failed.');
      } finally {
        setBusyRow(null);
      }
    },
    [refresh]
  );

  if (!canManage) return null;

  return (
    <section className="mb-10 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-medium">Figma Sync</h2>
            <p className="text-sm text-muted-foreground">
              Review published Figma child components, scaffold missing Handoff components, and backfill metadata without leaving `/system`.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh audit
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Figma child components</div>
            <div className="mt-1 text-2xl font-semibold">{data?.summary.figmaComponents ?? '—'}</div>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Matched + unlinked</div>
            <div className="mt-1 text-2xl font-semibold">
              {data ? data.summary.matched + data.summary.unlinked : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Missing in Handoff</div>
            <div className="mt-1 text-2xl font-semibold">{data?.summary.missingInHandoff ?? '—'}</div>
          </div>
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Metadata gaps</div>
            <div className="mt-1 text-2xl font-semibold">{data?.summary.metadataGaps ?? '—'}</div>
          </div>
        </div>

        {!data?.connected ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Figma is not connected for this admin session yet. Connect it and run a fresh fetch to update the audit snapshot.
            </div>
          </div>
        ) : null}

        {data?.linkedFile ? (
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Linked Figma file</div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="font-medium">{data.linkedFile.title}</span>
              <Badge variant="outline" className="font-mono text-[11px]">{data.linkedFile.fileKey}</Badge>
              <Button asChild variant="ghost" size="sm" className="h-7 gap-1.5 px-2">
                <a href={data.linkedFile.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open file
                </a>
              </Button>
            </div>
          </div>
        ) : null}

        {message ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p> : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}

        <div className="flex flex-col gap-3 md:flex-row">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by component or Figma name…"
            className="md:max-w-sm"
          />
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="md:w-[220px]">
              <SelectValue placeholder="Filter rows" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All rows</SelectItem>
              <SelectItem value="missing_in_handoff">Missing in Handoff</SelectItem>
              <SelectItem value="missing_metadata">Missing metadata</SelectItem>
              <SelectItem value="linked">Linked or unlinked</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          {rows.length === 0 && !loading ? (
            <p className="text-sm text-muted-foreground">No matching Figma sync rows.</p>
          ) : null}

          {rows.map((row) => (
            <div key={row.id} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="flex gap-3">
                  {row.thumb ? (
                    <img
                      src={row.thumb}
                      alt=""
                      className="h-12 w-12 rounded-md border border-border object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                      <Sparkles className="h-4 w-4" />
                    </div>
                  )}
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{row.title}</h3>
                      <Badge variant={statusBadgeVariant(row.status)}>{row.status.replace(/_/g, ' ')}</Badge>
                      {row.matchedBy ? <Badge variant="outline">matched by {row.matchedBy.replace(/_/g, ' ')}</Badge> : null}
                      {row.missingMetadata.length ? <Badge variant="outline">{row.missingMetadata.length} metadata gaps</Badge> : null}
                      {row.imageCount > 0 ? <Badge variant="outline">{row.imageCount} figma images</Badge> : null}
                      {row.variantLabel ? <Badge variant="outline">{row.variantLabel}</Badge> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="font-mono">{row.figmaSlug}</span>
                      {row.parentName && row.parentName !== row.title ? <span>Set: {row.parentName}</span> : null}
                      {row.componentId ? <span>Handoff: <span className="font-mono">{row.componentId}</span></span> : null}
                    </div>
                    {row.description ? <p className="text-sm text-muted-foreground">{row.description}</p> : null}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {row.status === 'missing_in_handoff' ? (
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void runAction(row, 'create_component')}
                      disabled={busyRow === row.id}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {busyRow === row.id ? 'Creating…' : 'Create component'}
                    </Button>
                  ) : (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => void runAction(row, 'sync_metadata')}
                        disabled={busyRow === row.id}
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        {busyRow === row.id ? 'Syncing…' : 'Sync metadata'}
                      </Button>
                      {row.componentId ? (
                        <Button asChild variant="outline" size="sm" className="gap-1.5">
                          <Link href={handoffApiUrl(`/system/component/${row.componentId}`)}>View details</Link>
                        </Button>
                      ) : null}
                    </>
                  )}
                  {row.figmaHref ? (
                    <Button asChild variant="ghost" size="sm" className="gap-1.5">
                      <a href={row.figmaHref} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-3.5 w-3.5" />
                        Figma
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>

              {row.missingMetadata.length ? (
                <div className="text-xs text-muted-foreground">
                  Missing metadata: {row.missingMetadata.join(', ')}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        {componentIssues.length ? (
          <div className="space-y-3 rounded-lg border border-border bg-background p-4">
            <div>
              <h3 className="font-medium">Legacy component issues</h3>
              <p className="text-sm text-muted-foreground">
                These Handoff components still resolve only at the parent-set level or no longer exist in Figma.
              </p>
            </div>
            {componentIssues.map((entry) => (
              <div key={entry.component.id} className="rounded-md border border-border/80 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{entry.component.title || entry.component.id}</span>
                  <Badge variant="outline">{entry.status.replace(/_/g, ' ')}</Badge>
                  {entry.matchedBy ? <Badge variant="outline">matched by {entry.matchedBy.replace(/_/g, ' ')}</Badge> : null}
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{entry.component.id}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
