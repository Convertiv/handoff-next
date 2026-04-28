'use client';

import { CheckCircle, Loader2, XCircle, Clock } from 'lucide-react';
import Link from 'next/link';
import Layout from '../../../components/Layout/Main';
import { Badge } from '../../../components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../../components/ui/table';

type BuildJob = {
  id: number;
  componentId: string;
  status: string;
  error: string | null;
  createdAt: Date | null;
  completedAt: Date | null;
};

function StatusBadge({ status }: { status: string }) {
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

export default function BuildsClient({ initialJobs, config, menu, message }: { initialJobs: BuildJob[]; config: any; menu: any; message?: string }) {
  const layoutMeta = { metaTitle: 'Component Builds', metaDescription: 'Recent component build jobs' };

  return (
    <Layout config={config} menu={menu} current={null} metadata={layoutMeta}>
      <div className="mx-auto max-w-5xl">
        <h1 className="mb-1 text-xl font-semibold">Component Builds</h1>
        <p className="mb-6 text-sm text-muted-foreground">Recent Vite preview build jobs for dynamic components.</p>
        {message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : initialJobs.length === 0 ? (
          <p className="text-sm text-gray-500">No build jobs yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16">Job</TableHead>
                <TableHead>Component</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-44">Started</TableHead>
                <TableHead className="w-24">Duration</TableHead>
                <TableHead>Error</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {initialJobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-mono text-xs text-gray-500">#{job.id}</TableCell>
                  <TableCell>
                    <Link href={`/system/component/${job.componentId}/`} className="text-sm font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-400">
                      {job.componentId}
                    </Link>
                  </TableCell>
                  <TableCell><StatusBadge status={job.status} /></TableCell>
                  <TableCell className="text-xs text-gray-500">{formatDate(job.createdAt)}</TableCell>
                  <TableCell className="text-xs text-gray-500">{durationMs(job.createdAt, job.completedAt)}</TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-red-500">{job.error ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </Layout>
  );
}
