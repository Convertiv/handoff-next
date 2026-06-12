'use client';

import { CheckCircle, ImageIcon, Loader2, Package, Sparkles, XCircle, Clock, StopCircle } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../../../components/Layout/Main';
import { handoffApiUrl } from '../../../lib/api-path';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';
import type { AdminBuildTaskRow } from '../../../lib/admin-build-tasks-types';

function ComponentStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'queued':
      return (
        <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400">
          <Clock className="h-3 w-3" /> Queued
        </Badge>
      );
    case 'building':
      return (
        <Badge variant="outline" className="gap-1 border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-400">
          <Loader2 className="h-3 w-3 animate-spin" /> Building
        </Badge>
      );
    case 'complete':
      return (
        <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
          <CheckCircle className="h-3 w-3" /> Complete
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="outline" className="gap-1 border-red-300 text-red-700 dark:border-red-700 dark:text-red-400">
          <XCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function AssetExtractionStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'pending':
      return (
        <Badge variant="outline" className="gap-1 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400">
          <Clock className="h-3 w-3" /> Pending
        </Badge>
      );
    case 'extracting':
      return (
        <Badge variant="outline" className="gap-1 border-sky-300 text-sky-700 dark:border-sky-700 dark:text-sky-400">
          <Loader2 className="h-3 w-3 animate-spin" /> Extracting
        </Badge>
      );
    case 'done':
      return (
        <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
          <CheckCircle className="h-3 w-3" /> Done
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="outline" className="gap-1 border-red-300 text-red-700 dark:border-red-700 dark:text-red-400">
          <XCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString();
}

function durationMs(start: Date | string | null | undefined, end: Date | string | null | undefined): string {
  if (!start || !end) return '—';
  const s = typeof start === 'string' ? new Date(start) : start;
  const e = typeof end === 'string' ? new Date(end) : end;
  const ms = e.getTime() - s.getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ComponentGenerationStatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'queued':
    case 'generating':
    case 'building':
    case 'validating':
    case 'iterating':
      return (
        <Badge variant="outline" className="gap-1 border-violet-300 text-violet-800 dark:border-violet-700 dark:text-violet-300">
          <Loader2 className="h-3 w-3 animate-spin" /> {status}
        </Badge>
      );
    case 'complete':
      return (
        <Badge variant="outline" className="gap-1 border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
          <CheckCircle className="h-3 w-3" /> Complete
        </Badge>
      );
    case 'failed':
      return (
        <Badge variant="outline" className="gap-1 border-red-300 text-red-700 dark:border-red-700 dark:text-red-400">
          <XCircle className="h-3 w-3" /> Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function StatusCell({ row }: { row: AdminBuildTaskRow }) {
  if (row.kind === 'component_build') return <ComponentStatusBadge status={row.status} />;
  if (row.kind === 'component_generation') return <ComponentGenerationStatusBadge status={row.status} />;
  return <AssetExtractionStatusBadge status={row.status} />;
}

type KillableTask =
  | { kind: 'component_build'; id: number }
  | { kind: 'component_generation'; id: number }
  | { kind: 'design_asset_extraction'; id: string };

export default function BuildsClient({
  initialTasks,
  config,
  menu,
  message,
}: {
  initialTasks: AdminBuildTaskRow[];
  config: unknown;
  menu: unknown;
  message?: string;
}) {
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const [tasks, setTasks] = useState<AdminBuildTaskRow[]>(initialTasks);
  const [killing, setKilling] = useState<string | null>(null);
  const [killError, setKillError] = useState<string | null>(null);
  const layoutMeta = { metaTitle: 'Builds', metaDescription: 'Component preview builds and design asset extraction jobs' };

  const hasActiveAssetJob = useMemo(() => {
    const genActive = (s: string) =>
      ['queued', 'generating', 'building', 'validating', 'iterating'].includes(s);
    return (
      tasks.some((t) => t.kind === 'design_asset_extraction' && (t.status === 'pending' || t.status === 'extracting')) ||
      tasks.some((t) => t.kind === 'component_build' && (t.status === 'queued' || t.status === 'building')) ||
      tasks.some((t) => t.kind === 'component_generation' && genActive(t.status))
    );
  }, [tasks]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/admin/build-tasks'), { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as { tasks?: AdminBuildTaskRow[]; error?: string };
      if (res.ok && Array.isArray(json.tasks)) setTasks(json.tasks);
    } catch {
      /* ignore */
    }
  }, []);

  const killTask = useCallback(async (task: KillableTask) => {
    const key = `${task.kind}-${task.id}`;
    setKilling(key);
    setKillError(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/admin/build-tasks/kill'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(task),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setKillError(json.error ?? 'Kill failed');
      } else {
        // Optimistically mark as failed in local state
        setTasks((current) =>
          current.map((t) => {
            if (task.kind === 'component_build' && t.kind === 'component_build' && t.jobId === task.id)
              return { ...t, status: 'failed', error: 'Killed by admin' };
            if (task.kind === 'component_generation' && t.kind === 'component_generation' && t.generationJobId === task.id)
              return { ...t, status: 'failed', error: 'Killed by admin' };
            if (task.kind === 'design_asset_extraction' && t.kind === 'design_asset_extraction' && t.artifactId === task.id)
              return { ...t, status: 'failed', error: 'Killed by admin' };
            return t;
          })
        );
      }
    } catch (e) {
      setKillError(e instanceof Error ? e.message : 'Kill failed');
    } finally {
      setKilling(null);
    }
  }, []);

  useEffect(() => {
    setTasks(initialTasks);
  }, [initialTasks]);

  useEffect(() => {
    if (message) return;
    void refresh();
    const id = window.setInterval(() => {
      void refresh();
    }, hasActiveAssetJob ? 4000 : 12000);
    return () => window.clearInterval(id);
  }, [message, refresh, hasActiveAssetJob]);

  return (
    <Layout config={config as never} menu={menu as never} current={null} metadata={layoutMeta}>
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-xl font-semibold">Builds</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Component preview (Vite) jobs, saved-design <strong>asset extraction</strong>, and <strong>design-to-component</strong> AI generation. Rows
          refresh automatically while jobs are in progress.
        </p>
        {killError ? (
          <div className="mb-4 flex items-center justify-between rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
            <span>{killError}</span>
            <button type="button" className="ml-4 text-xs underline" onClick={() => setKillError(null)}>Dismiss</button>
          </div>
        ) : null}
        {message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No build or extraction activity yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Kind</TableHead>
                <TableHead className="w-28">Ref</TableHead>
                <TableHead>Target</TableHead>
                <TableHead className="w-32">Status</TableHead>
                <TableHead className="w-44">Started</TableHead>
                <TableHead className="w-44">Finished</TableHead>
                <TableHead className="w-24">Duration</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((row) => {
                if (row.kind === 'component_build') {
                  const active = row.status === 'queued' || row.status === 'building';
                  const killKey = `component_build-${row.jobId}`;
                  return (
                    <TableRow key={`c-${row.jobId}`}>
                      <TableCell className="text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Package className="h-3.5 w-3.5 shrink-0" />
                          Component
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">#{row.jobId}</TableCell>
                      <TableCell>
                        <Link
                          href={`${basePath}/system/component/${encodeURIComponent(row.componentId)}/`}
                          className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
                        >
                          {row.componentId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <StatusCell row={row} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(row.completedAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{durationMs(row.createdAt, row.completedAt)}</TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-red-500">{row.error ?? '—'}</TableCell>
                      <TableCell>
                        {active ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                            disabled={killing === killKey}
                            onClick={() => void killTask({ kind: 'component_build', id: row.jobId })}
                          >
                            {killing === killKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <StopCircle className="h-3 w-3" />}
                            Kill
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                }
                if (row.kind === 'component_generation') {
                  const terminal = row.status === 'complete' || row.status === 'failed';
                  const active = !terminal;
                  const killKey = `component_generation-${row.generationJobId}`;
                  return (
                    <TableRow key={`g-${row.generationJobId}`}>
                      <TableCell className="text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Sparkles className="h-3.5 w-3.5 shrink-0" />
                          Gen component
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">#{row.generationJobId}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <Link
                            href={`${basePath}/system/component/${encodeURIComponent(row.componentId)}/`}
                            className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
                          >
                            {row.componentId}
                          </Link>
                          <Link
                            href={`${basePath}/design/library/${encodeURIComponent(row.artifactId)}/`}
                            className="text-xs text-muted-foreground hover:underline"
                          >
                            from design…
                          </Link>
                          {row.visualScore != null ? (
                            <span className="text-xs text-muted-foreground">score {Number(row.visualScore).toFixed(2)}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusCell row={row} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{terminal ? formatDate(row.completedAt) : '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {terminal ? durationMs(row.createdAt, row.completedAt) : '—'}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-red-500">{row.error ?? '—'}</TableCell>
                      <TableCell>
                        {active ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                            disabled={killing === killKey}
                            onClick={() => void killTask({ kind: 'component_generation', id: row.generationJobId })}
                          >
                            {killing === killKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <StopCircle className="h-3 w-3" />}
                            Kill
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                }
                const terminal = row.status === 'done' || row.status === 'failed';
                const active = !terminal;
                const killKey = `design_asset_extraction-${row.artifactId}`;
                return (
                  <TableRow key={`a-${row.artifactId}`}>
                    <TableCell className="text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                        Design assets
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.artifactId.slice(0, 8)}…</TableCell>
                    <TableCell>
                      <Link
                        href={`${basePath}/design/library/${encodeURIComponent(row.artifactId)}/`}
                        className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-400"
                      >
                        {row.title || 'Untitled'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusCell row={row} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDate(row.createdAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{terminal ? formatDate(row.updatedAt) : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {terminal ? durationMs(row.createdAt, row.updatedAt) : '—'}
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-red-500">{row.error ?? '—'}</TableCell>
                    <TableCell>
                      {active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 gap-1 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-950/40"
                          disabled={killing === killKey}
                          onClick={() => void killTask({ kind: 'design_asset_extraction', id: row.artifactId })}
                        >
                          {killing === killKey ? <Loader2 className="h-3 w-3 animate-spin" /> : <StopCircle className="h-3 w-3" />}
                          Kill
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </Layout>
  );
}
