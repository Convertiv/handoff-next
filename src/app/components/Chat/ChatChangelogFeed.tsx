'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, GitCommit, FileText, Palette } from 'lucide-react';
import { Badge } from '@handoff/app/components/ui/badge';
import { handoffApiUrl } from '@/lib/api-path';
import type { UnifiedChangelogEntry } from '@/lib/db/changelog-queries';

interface DateGroup {
  label: string;
  entries: UnifiedChangelogEntry[];
}

interface Props {
  basePath?: string;
  onClose?: () => void;
  /** Number of days back to show — passed through from the AI get_recent_changes action */
  days?: number;
  /** Max entries to return — passed through from the AI get_recent_changes action */
  limit?: number;
}

function relativeTime(iso: string): string {
  const elapsed = Date.now() - new Date(iso).getTime();
  const s = Math.floor(elapsed / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const entry = new Date(d); entry.setHours(0, 0, 0, 0);
  if (entry.getTime() === today.getTime()) return 'Today';
  if (entry.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function groupByDate(entries: UnifiedChangelogEntry[]): DateGroup[] {
  const map = new Map<string, UnifiedChangelogEntry[]>();
  for (const e of entries) {
    const label = dateLabel(e.pushedAt);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(e);
  }
  return Array.from(map.entries()).map(([label, entries]) => ({ label, entries }));
}

function EntryIcon({ entry }: { entry: UnifiedChangelogEntry }) {
  if (entry.entityType === 'token') {
    return <Palette className="h-3 w-3 shrink-0 text-amber-500" />;
  }
  if (entry.entityType === 'page') {
    return <FileText className="h-3 w-3 shrink-0 text-violet-500" />;
  }
  return <GitCommit className="h-3 w-3 shrink-0 text-primary" />;
}

function EntryBadges({ entry }: { entry: UnifiedChangelogEntry }) {
  if (entry.entityType === 'component') {
    const s = entry.changeSummary as {
      firstVersion?: boolean;
      metadataChanged?: boolean;
      sourceAdded?: string[];
      sourceModified?: string[];
      sourceRemoved?: string[];
      artifactsChanged?: boolean;
    };
    if (s.firstVersion) {
      return <Badge variant="secondary" className="text-[10px] py-0">Initial push</Badge>;
    }
    const parts: string[] = [];
    if (s.metadataChanged) parts.push('meta');
    const srcTotal = (s.sourceAdded?.length ?? 0) + (s.sourceModified?.length ?? 0) + (s.sourceRemoved?.length ?? 0);
    if (srcTotal > 0) parts.push(`${srcTotal} ${srcTotal === 1 ? 'file' : 'files'}`);
    if (s.artifactsChanged) parts.push('artifacts');
    return parts.length > 0 ? (
      <Badge variant="outline" className="text-[10px] py-0">{parts.join(' · ')}</Badge>
    ) : null;
  }

  if (entry.entityType === 'token') {
    const parts: string[] = [];
    if (entry.addedCount > 0) parts.push(`+${entry.addedCount}`);
    if (entry.modifiedCount > 0) parts.push(`~${entry.modifiedCount}`);
    if (entry.removedCount > 0) parts.push(`-${entry.removedCount}`);
    return parts.length > 0 ? (
      <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400 text-[10px] py-0">
        {parts.join(' ')}
      </Badge>
    ) : null;
  }

  // page
  const colors: Record<string, string> = {
    created: 'border-green-300 text-green-700 dark:border-green-700 dark:text-green-400',
    updated: 'border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400',
    deleted: 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-400',
  };
  return (
    <Badge variant="outline" className={`${colors[entry.pageAction] ?? ''} text-[10px] py-0`}>
      {entry.pageAction}
    </Badge>
  );
}

function entryLabel(entry: UnifiedChangelogEntry): string {
  if (entry.entityType === 'component') return entry.componentTitle;
  if (entry.entityType === 'token') return 'Token push';
  return entry.titleAfter ?? entry.titleBefore ?? entry.slug;
}

function entrySubLabel(entry: UnifiedChangelogEntry): string | null {
  if (entry.entityType === 'component') {
    return entry.componentGroup ? `v${entry.versionNumber} · ${entry.componentGroup}` : `v${entry.versionNumber}`;
  }
  if (entry.entityType === 'token') return `${entry.totalCount} total tokens`;
  return entry.slug;
}

export function ChatChangelogFeed({ basePath = '', onClose, days, limit = 30 }: Props) {
  const router = useRouter();
  const [groups, setGroups] = useState<DateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(Math.min(limit, 50)) });
    if (days) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      params.set('since', since.toISOString());
    }
    fetch(handoffApiUrl(`/api/handoff/changelog?${params.toString()}`), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { changes: UnifiedChangelogEntry[] };
        setGroups(groupByDate(data.changes ?? []));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load changelog'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="mt-2 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-muted" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="mt-2 text-xs text-destructive">{error}</p>;
  }

  if (groups.length === 0) {
    return (
      <div className="mt-2 flex flex-col items-center gap-2 py-6 text-center text-muted-foreground">
        <GitCommit className="h-8 w-8 opacity-30" />
        <p className="text-xs">No recent changes</p>
      </div>
    );
  }

  function handleEntryClick(entry: UnifiedChangelogEntry) {
    if (entry.entityType === 'component') {
      router.push(`${basePath}/system/component/${encodeURIComponent(entry.componentId)}`);
    } else if (entry.entityType === 'token') {
      router.push(`${basePath}/system/changelog`);
    } else {
      router.push(`${basePath}/system/changelog`);
    }
    onClose?.();
  }

  return (
    <div className="mt-2 w-full space-y-3">
      {groups.map((group) => (
        <div key={group.label}>
          {/* Date divider */}
          <div className="mb-1.5 flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {group.label}
            </span>
            <div className="h-px flex-1 bg-border" />
          </div>
          {/* Entries */}
          <div className="space-y-0.5">
            {group.entries.map((entry) => (
              <button
                key={`${entry.entityType}-${entry.id}`}
                type="button"
                onClick={() => handleEntryClick(entry)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 transition-colors"
              >
                <EntryIcon entry={entry} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{entryLabel(entry)}</span>
                {entrySubLabel(entry) && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">{entrySubLabel(entry)}</span>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  <EntryBadges entry={entry} />
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {relativeTime(entry.pushedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Footer: link to the full changelog page */}
      <button
        type="button"
        onClick={() => {
          router.push(`${basePath}/system/changelog`);
          onClose?.();
        }}
        className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        View full changelog
        <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}
