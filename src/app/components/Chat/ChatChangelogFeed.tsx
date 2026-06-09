'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { GitCommit, Clock, User } from 'lucide-react';
import { Badge } from '@handoff/app/components/ui/badge';
import { handoffApiUrl } from '@/lib/api-path';

interface ChangeSummary {
  firstVersion: boolean;
  metadataChanged: boolean;
  fieldsChanged: string[];
  sourceAdded: string[];
  sourceModified: string[];
  sourceRemoved: string[];
  artifactsChanged: boolean;
}

interface ChangeEntry {
  id: number;
  componentId: string;
  componentTitle: string;
  componentGroup: string;
  versionNumber: number;
  pushedAt: string;
  pushedByName: string | null;
  trigger: string;
  changeSummary: ChangeSummary;
}

interface DateGroup {
  label: string;
  entries: ChangeEntry[];
}

interface Props {
  basePath?: string;
  onClose?: () => void;
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

function groupByDate(entries: ChangeEntry[]): DateGroup[] {
  const map = new Map<string, ChangeEntry[]>();
  for (const e of entries) {
    const label = dateLabel(e.pushedAt);
    if (!map.has(label)) map.set(label, []);
    map.get(label)!.push(e);
  }
  return Array.from(map.entries()).map(([label, entries]) => ({ label, entries }));
}

function ChangeBadges({ s }: { s: ChangeSummary }) {
  const badges: React.ReactNode[] = [];
  if (s.firstVersion) {
    return <Badge variant="secondary" className="text-[10px] py-0">Initial push</Badge>;
  }
  if (s.metadataChanged) {
    badges.push(
      <Badge key="meta" variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400 text-[10px] py-0">
        metadata
      </Badge>
    );
  }
  const srcTotal = (s.sourceAdded?.length ?? 0) + (s.sourceModified?.length ?? 0) + (s.sourceRemoved?.length ?? 0);
  if (srcTotal > 0) {
    const parts: string[] = [];
    if (s.sourceAdded?.length) parts.push(`+${s.sourceAdded.length}`);
    if (s.sourceModified?.length) parts.push(`~${s.sourceModified.length}`);
    if (s.sourceRemoved?.length) parts.push(`-${s.sourceRemoved.length}`);
    badges.push(
      <Badge key="src" variant="outline" className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-400 text-[10px] py-0">
        {parts.join(' ')} {srcTotal === 1 ? 'file' : 'files'}
      </Badge>
    );
  }
  if (s.artifactsChanged) {
    badges.push(
      <Badge key="art" variant="outline" className="border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400 text-[10px] py-0">
        artifacts
      </Badge>
    );
  }
  return badges.length > 0 ? <>{badges}</> : null;
}

export function ChatChangelogFeed({ basePath = '', onClose }: Props) {
  const router = useRouter();
  const [groups, setGroups] = useState<DateGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(handoffApiUrl('/api/handoff/changelog?limit=30'), { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { changes: ChangeEntry[] };
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
                key={entry.id}
                type="button"
                onClick={() => {
                  router.push(`${basePath}/system/component/${encodeURIComponent(entry.componentId)}`);
                  onClose?.();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted/60 transition-colors"
              >
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground w-6">
                  v{entry.versionNumber}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{entry.componentTitle}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <ChangeBadges s={entry.changeSummary} />
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {relativeTime(entry.pushedAt)}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
