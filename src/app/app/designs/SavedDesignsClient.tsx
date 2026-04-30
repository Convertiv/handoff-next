'use client';

import type { ClientConfig } from '@handoff/types/config';
import { ArrowLeft, ImageIcon, LayoutGrid, Loader2Icon, Rows, Search } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout/Main';
import { handoffApiUrl } from '../../lib/api-path';
import type { Metadata, SectionLink } from '../../components/util';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '../../components/ui/toggle-group';
import { cn } from '../../lib/utils';

export type SavedDesignListRow = {
  id: string;
  title: string;
  description: string;
  status: string;
  userId: string;
  imageUrl: string;
  createdAt: string;
  updatedAt: string;
};

type Props = {
  config: ClientConfig;
  menu: SectionLink[];
  metadata: Metadata;
  message?: string;
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function SavedDesignsClient({ menu, metadata, config, message }: Props) {
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const [items, setItems] = useState<SavedDesignListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [layout, setLayout] = useState<'grid' | 'single'>('grid');

  const load = useCallback(async () => {
    if (message) {
      setItems([]);
      return;
    }
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set('limit', '100');
      if (status && status !== 'all') q.set('status', status);
      const res = await fetch(`${handoffApiUrl('/api/handoff/ai/design-artifact')}?${q}`, { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as { artifacts?: SavedDesignListRow[]; error?: string };
      if (!res.ok) throw new Error(json.error || `Failed to load (${res.status})`);
      const raw = json.artifacts ?? [];
      setItems(
        raw.map((a) => ({
          ...a,
          createdAt: typeof a.createdAt === 'string' ? a.createdAt : new Date(a.createdAt as unknown as Date).toISOString(),
          updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : new Date(a.updatedAt as unknown as Date).toISOString(),
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
      setItems([]);
    }
  }, [message, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const list = items ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (a) => a.title.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q) || a.status.toLowerCase().includes(q)
    );
  }, [items, search]);

  return (
    <Layout config={config} menu={menu} current={null} metadata={{ metaTitle: metadata.metaTitle, metaDescription: metadata.metaDescription }}>
      <div className="flex flex-col gap-4 pb-10">
        <div className="flex flex-col gap-3 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Saved designs</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Designs you saved from the Design workbench. Open one to view the full image and notes.
            </p>
            {message ? <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{message}</p> : null}
            {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`${basePath}/design/`}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Workbench
              </Link>
            </Button>
          </div>
        </div>

        {items === null && !message ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : null}

        {items && items.length > 0 ? (
          <>
            <div className="flex flex-col gap-3 rounded-xl bg-muted/40 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative min-w-0 flex-1 sm:max-w-md">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search by title, description, or status…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search saved designs"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-[140px]" aria-label="Filter by status">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="review">Review</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                  </SelectContent>
                </Select>
                <ToggleGroup type="single" value={layout} onValueChange={(v) => v && setLayout(v as 'grid' | 'single')}>
                  <ToggleGroupItem value="grid" aria-label="Grid" className="px-2">
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </ToggleGroupItem>
                  <ToggleGroupItem value="single" aria-label="List" className="px-2">
                    <Rows className="h-3.5 w-3.5" />
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>
            </div>

            <div
              className={cn(
                'grid gap-8',
                layout === 'grid' ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'grid-cols-1 gap-4'
              )}
            >
              {filtered.map((a) => (
                <Link
                  key={a.id}
                  href={`${basePath}/designs/${a.id}/`}
                  className={cn(
                    'group flex overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition hover:border-primary/40 hover:shadow-md',
                    layout === 'single' ? 'flex-row gap-4 p-3' : 'flex-col'
                  )}
                >
                  <div
                    className={cn(
                      'relative shrink-0 overflow-hidden bg-muted/30',
                      layout === 'single' ? 'h-28 w-40 rounded-md' : 'aspect-[4/3] w-full'
                    )}
                  >
                    {a.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- data URLs from workbench
                      <img
                        src={a.imageUrl}
                        alt=""
                        className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-10 w-10 opacity-40" />
                      </div>
                    )}
                  </div>
                  <div className={cn('flex min-w-0 flex-1 flex-col p-4', layout === 'single' && 'p-0 pr-2')}>
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="line-clamp-2 font-medium leading-snug">{a.title || 'Untitled'}</h2>
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                        {a.status}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{a.description || 'No description'}</p>
                    <p className="mt-auto pt-2 text-[10px] text-muted-foreground">Updated {formatDate(a.updatedAt)}</p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        ) : null}

        {items && items.length === 0 && !message ? (
          <div className="rounded-xl border border-dashed bg-muted/20 px-6 py-12 text-center">
            <ImageIcon className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">No saved designs yet</p>
            <p className="mt-1 text-xs text-muted-foreground">Generate in the workbench, then use &quot;Save for review&quot;.</p>
            <Button className="mt-4" variant="secondary" size="sm" asChild>
              <Link href={`${basePath}/design/`}>Open Design workbench</Link>
            </Button>
          </div>
        ) : null}
      </div>
    </Layout>
  );
}
