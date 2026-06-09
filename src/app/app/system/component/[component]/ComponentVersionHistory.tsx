'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Clock, GitCommit, User } from 'lucide-react';
import { Badge } from '@handoff/app/components/ui/badge';
import { Button } from '@handoff/app/components/ui/button';
import HeadersType from '@handoff/app/components/Typography/Headers';

// ─── Types (mirror server shape) ─────────────────────────────────────────────

interface ComponentChangeSummary {
  firstVersion: boolean;
  metadataChanged: boolean;
  fieldsChanged: string[];
  sourceAdded: string[];
  sourceModified: string[];
  sourceRemoved: string[];
  artifactsChanged: boolean;
  artifactCount: number;
}

interface VersionRecord {
  id: number;
  componentId: string;
  versionNumber: number;
  pushedAt: string; // ISO string after JSON serialisation
  pushedByUserId: string | null;
  pushedByName: string | null;
  pushedByEmail: string | null;
  trigger: string;
  snapshot: {
    title?: string;
    description?: string | null;
    group?: string | null;
    type?: string | null;
  };
  changeSummary: ComponentChangeSummary;
  sourceFileHashes: Record<string, string>;
  artifactFilenames: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function fullDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

// ─── Change badges ────────────────────────────────────────────────────────────

function ChangeBadges({ s }: { s: ComponentChangeSummary }) {
  if (s.firstVersion) {
    return <Badge variant="secondary" className="text-[11px]">Initial push</Badge>;
  }
  const badges: React.ReactNode[] = [];

  if (s.metadataChanged) {
    const tip = s.fieldsChanged.join(', ');
    badges.push(
      <Badge key="meta" variant="outline" className="border-blue-300 text-blue-700 dark:border-blue-700 dark:text-blue-400 text-[11px]" title={tip}>
        metadata
        {s.fieldsChanged.length > 0 && <span className="ml-1 opacity-60">{s.fieldsChanged.length}</span>}
      </Badge>
    );
  }

  const srcAdded = s.sourceAdded?.length ?? 0;
  const srcModified = s.sourceModified?.length ?? 0;
  const srcRemoved = s.sourceRemoved?.length ?? 0;
  const srcTotal = srcAdded + srcModified + srcRemoved;
  if (srcTotal > 0) {
    const parts: string[] = [];
    if (srcAdded > 0) parts.push(`+${srcAdded}`);
    if (srcModified > 0) parts.push(`~${srcModified}`);
    if (srcRemoved > 0) parts.push(`-${srcRemoved}`);
    const tip = [
      ...s.sourceAdded.map((f) => `+ ${f}`),
      ...s.sourceModified.map((f) => `~ ${f}`),
      ...s.sourceRemoved.map((f) => `- ${f}`),
    ].join('\n');
    badges.push(
      <Badge key="src" variant="outline" className="border-green-300 text-green-700 dark:border-green-700 dark:text-green-400 text-[11px]" title={tip}>
        {parts.join(' ')} {srcTotal === 1 ? 'file' : 'files'}
      </Badge>
    );
  }

  if (s.artifactsChanged) {
    badges.push(
      <Badge key="art" variant="outline" className="border-orange-300 text-orange-700 dark:border-orange-700 dark:text-orange-400 text-[11px]">
        artifacts rebuilt
      </Badge>
    );
  }

  return badges.length > 0 ? <>{badges}</> : <Badge variant="outline" className="text-[11px] opacity-50">no changes detected</Badge>;
}

// ─── Single version row ───────────────────────────────────────────────────────

function VersionRow({ v, isLatest }: { v: VersionRecord; isLatest: boolean }) {
  const [open, setOpen] = useState(false);
  const summary = v.changeSummary;
  const pusher = v.pushedByName || v.pushedByEmail || 'Unknown';
  const sourceCount = Object.keys(v.sourceFileHashes ?? {}).length;
  const artifactCount = v.artifactFilenames?.length ?? 0;

  return (
    <div className="rounded-lg border border-border bg-card transition-colors hover:bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        {/* Version chip */}
        <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
          {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="font-mono text-xs font-semibold text-muted-foreground">
            v{v.versionNumber}
          </span>
          {isLatest && (
            <Badge className="ml-1 bg-primary text-[9px] text-primary-foreground py-0 px-1.5 leading-4">
              latest
            </Badge>
          )}
        </div>

        {/* Main content */}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <ChangeBadges s={summary} />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1" title={fullDate(v.pushedAt)}>
              <Clock className="h-3 w-3 shrink-0" />
              {relativeTime(v.pushedAt)}
            </span>
            <span className="flex items-center gap-1">
              <User className="h-3 w-3 shrink-0" />
              {pusher}
            </span>
            {v.trigger !== 'push' && (
              <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">{v.trigger}</span>
            )}
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="border-t border-border/50 px-4 pb-4 pt-3">
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            {/* Snapshot metadata */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Snapshot</p>
              <div className="space-y-1 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
                <div className="flex gap-2">
                  <span className="w-20 shrink-0 text-muted-foreground">Title</span>
                  <span className="truncate font-medium">{v.snapshot?.title ?? '—'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-20 shrink-0 text-muted-foreground">Group</span>
                  <span>{v.snapshot?.group ?? '—'}</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-20 shrink-0 text-muted-foreground">Type</span>
                  <span>{v.snapshot?.type ?? '—'}</span>
                </div>
                {v.snapshot?.description && (
                  <div className="flex gap-2">
                    <span className="w-20 shrink-0 text-muted-foreground">Desc</span>
                    <span className="line-clamp-2">{v.snapshot.description}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Files at this version */}
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Files at this version</p>
              <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
                {sourceCount === 0 && artifactCount === 0 ? (
                  <p className="text-muted-foreground">No files recorded</p>
                ) : (
                  <div className="space-y-1">
                    {Object.keys(v.sourceFileHashes ?? {}).map((path) => (
                      <div key={path} className="flex items-center gap-1.5">
                        <GitCommit className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono">{path}</span>
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                          {(v.sourceFileHashes[path] ?? '').slice(0, 7)}
                        </span>
                      </div>
                    ))}
                    {artifactCount > 0 && (
                      <p className="pt-1 text-muted-foreground">
                        + {artifactCount} artifact{artifactCount !== 1 ? 's' : ''}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Changed fields detail */}
            {!summary.firstVersion && summary.fieldsChanged?.length > 0 && (
              <div className="sm:col-span-2">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">Changed fields</p>
                <div className="flex flex-wrap gap-1.5">
                  {summary.fieldsChanged.map((f) => (
                    <code key={f} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">{f}</code>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main exported component ──────────────────────────────────────────────────

interface Props {
  componentId: string;
  basePath: string;
}

export function ComponentVersionHistory({ componentId, basePath }: Props) {
  const [versions, setVersions] = useState<VersionRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    fetch(`${basePath}/api/handoff/components/history?id=${encodeURIComponent(componentId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { versions: VersionRecord[]; total: number };
        setVersions(data.versions ?? []);
        setTotal(data.total ?? 0);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load history'))
      .finally(() => setLoading(false));
  }, [componentId, basePath]);

  if (loading) {
    return (
      <section className="mt-12 scroll-mt-24" id="version-history">
        <HeadersType.H2>History</HeadersType.H2>
        <p className="text-sm text-muted-foreground">Loading…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="mt-12 scroll-mt-24" id="version-history">
        <HeadersType.H2>History</HeadersType.H2>
        <p className="text-sm text-destructive">{error}</p>
      </section>
    );
  }

  if (versions.length === 0) {
    return null; // no history yet — don't render the section at all
  }

  return (
    <section className="mt-12 scroll-mt-24" id="version-history">
      <div className="mb-4 flex items-center gap-3">
        <HeadersType.H2 className="m-0">History</HeadersType.H2>
        <Badge variant="secondary">{total} version{total !== 1 ? 's' : ''}</Badge>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-7 px-2 text-xs text-muted-foreground"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
      </div>

      {expanded && (
        <div className="space-y-2">
          {versions.map((v, i) => (
            <VersionRow key={v.id} v={v} isLatest={i === 0} />
          ))}
          {total > versions.length && (
            <p className="pt-1 text-center text-xs text-muted-foreground">
              Showing {versions.length} of {total} versions
            </p>
          )}
        </div>
      )}
    </section>
  );
}
