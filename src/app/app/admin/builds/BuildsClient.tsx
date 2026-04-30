'use client';

import { CheckCircle, ImageIcon, Loader2, Package, XCircle, Clock } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../../../components/Layout/Main';
import { handoffApiUrl } from '../../../lib/api-path';
import { Badge } from '../../../components/ui/badge';
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

function StatusCell({ row }: { row: AdminBuildTaskRow }) {
  if (row.kind === 'component_build') return <ComponentStatusBadge status={row.status} />;
  return <AssetExtractionStatusBadge status={row.status} />;
}

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
  const layoutMeta = { metaTitle: 'Builds', metaDescription: 'Component preview builds and design asset extraction jobs' };

  const hasActiveAssetJob = useMemo(
    () =>
      tasks.some((t) => t.kind === 'design_asset_extraction' && (t.status === 'pending' || t.status === 'extracting')) ||
      tasks.some((t) => t.kind === 'component_build' && (t.status === 'queued' || t.status === 'building')),
    [tasks]
  );

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/admin/build-tasks'), { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as { tasks?: AdminBuildTaskRow[]; error?: string };
      if (res.ok && Array.isArray(json.tasks)) setTasks(json.tasks);
    } catch {
      /* ignore */
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
        <p className="mb-6 text-sm text-muted-foreground">
          Component preview (Vite) jobs and saved-design <strong>asset extraction</strong> (background image isolation). Rows refresh automatically
          while jobs are in progress.
        </p>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((row) => {
                if (row.kind === 'component_build') {
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
                    </TableRow>
                  );
                }
                const terminal = row.status === 'done' || row.status === 'failed';
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
                        href={`${basePath}/designs/${encodeURIComponent(row.artifactId)}/`}
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
