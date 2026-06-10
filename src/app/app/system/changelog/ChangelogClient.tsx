'use client';

import { useEffect, useState, useCallback } from 'react';
import { GitCommit, FileText, Palette, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { handoffApiUrl } from '@/lib/api-path';
import type { UnifiedChangelogEntry } from '@/lib/db/changelog-queries';

// ─── Local type aliases for the three entry kinds ───────────────────────────

interface ChangeSummary {
  firstVersion: boolean;
  metadataChanged: boolean;
  fieldsChanged: string[];
  sourceAdded: string[];
  sourceModified: string[];
  sourceRemoved: string[];
  artifactsChanged: boolean;
}

// ─── Date grouping ────────────────────────────────────────────────────────────

interface DateGroup {
  label: string;
  date: string;
  entries: UnifiedChangelogEntry[];
}

type TimeRange = '7d' | '30d' | '90d' | 'all';
type EntityFilter = 'all' | 'component' | 'token' | 'page';

const TIME_RANGES: { value: TimeRange; label: string; days?: number }[] = [
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
  { value: 'all', label: 'All time' },
];

const ENTITY_FILTERS: { value: EntityFilter; label: string }[] = [
  { value: 'all', label: 'All changes' },
  { value: 'component', label: 'Components' },
  { value: 'token', label: 'Tokens' },
  { value: 'page', label: 'Pages' },
];

function getPushedAt(e: UnifiedChangelogEntry): string {
  return e.pushedAt;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const entry = new Date(d); entry.setHours(0, 0, 0, 0);
  if (entry.getTime() === today.getTime()) return 'Today';
  if (entry.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function relativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  const s = Math.floor(elapsed / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function groupByDate(entries: UnifiedChangelogEntry[]): DateGroup[] {
  const map = new Map<string, UnifiedChangelogEntry[]>();
  for (const e of entries) {
    const d = new Date(getPushedAt(e)); d.setHours(0, 0, 0, 0);
    const key = d.toISOString();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, entries]) => ({ label: formatDate(entries[0].pushedAt), date, entries }));
}

// ─── Change tags per entity type ─────────────────────────────────────────────

function ComponentChangeTags({ s }: { s: ChangeSummary }) {
  const tags: React.ReactNode[] = [];
  if (s.firstVersion) {
    return (
      <Badge variant="secondary" className="text-xs">
        Initial push
      </Badge>
    );
  }
  if (s.metadataChanged) {
    tags.push(
      <Badge key="meta" variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400 text-xs">
        metadata
      </Badge>
    );
  }
  const totalSrc = (s.sourceAdded?.length ?? 0) + (s.sourceModified?.length ?? 0) + (s.sourceRemoved?.length ?? 0);
  if (totalSrc > 0) {
    const parts: string[] = [];
    if (s.sourceAdded?.length) parts.push(`+${s.sourceAdded.length} added`);
    if (s.sourceModified?.length) parts.push(`~${s.sourceModified.length} modified`);
    if (s.sourceRemoved?.length) parts.push(`-${s.sourceRemoved.length} removed`);
    tags.push(
      <Badge key="src" variant="outline" className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-400 text-xs">
        {parts.join(', ')}
      </Badge>
    );
  }
  if (s.fieldsChanged?.length > 0) {
    tags.push(
      <Badge key="fields" variant="outline" className="border-purple-300 text-purple-700 dark:border-purple-700 dark:text-purple-400 text-xs">
        {s.fieldsChanged.length} {s.fieldsChanged.length === 1 ? 'field' : 'fields'} changed
      </Badge>
    );
  }
  if (s.artifactsChanged) {
    tags.push(
      <Badge key="art" variant="outline" className="border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400 text-xs">
        artifacts
      </Badge>
    );
  }
  return tags.length > 0 ? <div className="flex flex-wrap gap-1">{tags}</div> : null;
}

function TokenChangeTags({ entry }: { entry: Extract<UnifiedChangelogEntry, { entityType: 'token' }> }) {
  const tags: React.ReactNode[] = [];
  if (entry.addedCount > 0) {
    tags.push(
      <Badge key="added" variant="outline" className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-400 text-xs">
        +{entry.addedCount} added
      </Badge>
    );
  }
  if (entry.modifiedCount > 0) {
    tags.push(
      <Badge key="mod" variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400 text-xs">
        ~{entry.modifiedCount} modified
      </Badge>
    );
  }
  if (entry.removedCount > 0) {
    tags.push(
      <Badge key="rem" variant="outline" className="border-red-300 text-red-700 dark:border-red-700 dark:text-red-400 text-xs">
        -{entry.removedCount} removed
      </Badge>
    );
  }
  if (tags.length === 0) {
    tags.push(
      <Badge key="nc" variant="secondary" className="text-xs">
        no changes
      </Badge>
    );
  }
  return <div className="flex flex-wrap gap-1">{tags}</div>;
}

function PageChangeTags({ entry }: { entry: Extract<UnifiedChangelogEntry, { entityType: 'page' }> }) {
  const actionColors: Record<string, string> = {
    created: 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-400',
    updated: 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400',
    deleted: 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-400',
  };
  const color = actionColors[entry.pageAction] ?? actionColors.updated;
  const tags: React.ReactNode[] = [
    <Badge key="action" variant="outline" className={`${color} text-xs`}>
      {entry.pageAction}
    </Badge>,
  ];
  if (entry.pageAction === 'updated' && entry.markdownLengthBefore != null && entry.markdownLengthAfter != null) {
    const delta = entry.markdownLengthAfter - entry.markdownLengthBefore;
    if (delta !== 0) {
      tags.push(
        <Badge key="delta" variant="outline" className="text-xs text-muted-foreground">
          {delta > 0 ? `+${delta}` : delta} chars
        </Badge>
      );
    }
  }
  return <div className="flex flex-wrap gap-1">{tags}</div>;
}

// ─── Entry row ────────────────────────────────────────────────────────────────

function EntryRow({ entry }: { entry: UnifiedChangelogEntry }) {
  if (entry.entityType === 'component') {
    return (
      <div className="flex items-start gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/40">
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <GitCommit className="h-3.5 w-3.5 text-primary" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/system/component/${encodeURIComponent(entry.componentId)}`}
              className="text-sm font-medium hover:underline"
            >
              {entry.componentTitle}
            </Link>
            {entry.componentGroup && (
              <span className="text-xs text-muted-foreground">· {entry.componentGroup}</span>
            )}
            <span className="font-mono text-xs text-muted-foreground">v{entry.versionNumber}</span>
          </div>
          <ComponentChangeTags s={entry.changeSummary as ChangeSummary} />
        </div>
        <div className="shrink-0 text-right space-y-0.5">
          {entry.pushedByName && (
            <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              <span>{entry.pushedByName}</span>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{relativeTime(entry.pushedAt)}</p>
          <span className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {entry.trigger}
          </span>
        </div>
      </div>
    );
  }

  if (entry.entityType === 'token') {
    return (
      <div className="flex items-start gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/40">
        <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
          <Palette className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Token push</span>
            <span className="text-xs text-muted-foreground">· {entry.totalCount} total tokens</span>
          </div>
          <TokenChangeTags entry={entry} />
        </div>
        <div className="shrink-0 text-right space-y-0.5">
          <p className="text-xs text-muted-foreground">{relativeTime(entry.pushedAt)}</p>
          <span className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {entry.trigger}
          </span>
        </div>
      </div>
    );
  }

  // page
  const displayTitle = entry.titleAfter ?? entry.titleBefore ?? entry.slug;
  return (
    <div className="flex items-start gap-4 rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:bg-muted/40">
      <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
        <FileText className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{displayTitle}</span>
          <span className="font-mono text-xs text-muted-foreground">· {entry.slug}</span>
        </div>
        <PageChangeTags entry={entry} />
      </div>
      <div className="shrink-0 text-right space-y-0.5">
        {entry.pushedByName && (
          <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span>{entry.pushedByName}</span>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{relativeTime(entry.pushedAt)}</p>
        <span className="inline-block rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {entry.trigger}
        </span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ChangelogClient() {
  const [allEntries, setAllEntries] = useState<UnifiedChangelogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>('30d');
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');

  // Derived: filtered + grouped for display
  const filteredEntries = entityFilter === 'all'
    ? allEntries
    : allEntries.filter((e) => e.entityType === entityFilter);
  const groups = groupByDate(filteredEntries);
  const total = filteredEntries.length;

  // Check which entity types have data (to only show relevant filter chips)
  const presentTypes = new Set(allEntries.map((e) => e.entityType));

  const load = useCallback((range: TimeRange) => {
    setLoading(true);
    setError(null);
    setEntityFilter('all');
    const rangeDef = TIME_RANGES.find((r) => r.value === range);
    const params = new URLSearchParams({ limit: '200' });
    if (rangeDef?.days) {
      const since = new Date();
      since.setDate(since.getDate() - rangeDef.days);
      params.set('since', since.toISOString());
    }
    fetch(handoffApiUrl(`/api/handoff/changelog?${params.toString()}`), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { changes: UnifiedChangelogEntry[]; total: number };
        setAllEntries(data.changes ?? []);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load changelog'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(timeRange); }, [timeRange, load]);

  return (
    <div className="space-y-4">
      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Time range */}
        {TIME_RANGES.map((r) => (
          <Button
            key={r.value}
            variant={timeRange === r.value ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeRange(r.value)}
          >
            {r.label}
          </Button>
        ))}

        {/* Entity type filter — only shown when 2+ types present */}
        {!loading && presentTypes.size > 1 && (
          <>
            <div className="mx-1 h-5 w-px bg-border" />
            {ENTITY_FILTERS.filter(
              (f) => f.value === 'all' || presentTypes.has(f.value as 'component' | 'token' | 'page')
            ).map((f) => (
              <Button
                key={f.value}
                variant={entityFilter === f.value ? 'secondary' : 'outline'}
                size="sm"
                onClick={() => setEntityFilter(entityFilter === f.value && f.value !== 'all' ? 'all' : f.value)}
              >
                {f.label}
              </Button>
            ))}
          </>
        )}

        {!loading && total > 0 && (
          <span className="ml-auto text-sm text-muted-foreground">
            {total} {total === 1 ? 'change' : 'changes'}
          </span>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="space-y-6 pt-2">
          {Array.from({ length: 3 }).map((_, gi) => (
            <div key={gi} className="space-y-3">
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && groups.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-20 text-center text-muted-foreground">
          <GitCommit className="h-10 w-10 opacity-20" />
          <p className="text-sm">No changes found for this time range.</p>
        </div>
      )}

      {/* Timeline */}
      {!loading && !error && groups.length > 0 && (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.date} className="space-y-3">
              {/* Date header */}
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <h2 className="shrink-0 text-sm font-semibold text-muted-foreground">{group.label}</h2>
                <div className="h-px flex-1 bg-border" />
              </div>

              {/* Entries */}
              <div className="space-y-2">
                {group.entries.map((entry) => (
                  <EntryRow key={`${entry.entityType}-${entry.id}`} entry={entry} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
