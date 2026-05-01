'use client';

import type { PatternListObject } from '@handoff/transformers/preview/types';
import { Copy, ExternalLink, Loader2, Search, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout/Main';
import { handoffApiUrl } from '../../lib/api-path';
import { deletePattern } from '../actions/patterns';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert';

type PatternListEntry = PatternListObject & {
  _source?: string;
  _thumbnail?: string | null;
  _userId?: string | null;
  _createdAt?: string | null;
  _updatedAt?: string | null;
  _componentCount?: number;
};

export default function PatternBrowserClient({
  menu,
  config,
}: {
  menu: unknown;
  config: unknown;
}) {
  const { status } = useSession();
  const [banner, setBanner] = useState<{ variant: 'default' | 'destructive'; title: string; description?: string } | null>(null);
  const [patterns, setPatterns] = useState<PatternListEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

  const load = useCallback(async () => {
    if (status !== 'authenticated') {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('q', search.trim());
      if (groupFilter) params.set('group', groupFilter);
      const res = await fetch(handoffApiUrl(`/api/handoff/patterns?${params.toString()}`), { credentials: 'include' });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const json = (await res.json()) as { patterns: PatternListEntry[] };
      setPatterns(json.patterns ?? []);
    } catch (e) {
      setBanner({
        variant: 'destructive',
        title: 'Failed to load patterns',
        description: e instanceof Error ? e.message : 'Unknown error',
      });
      setPatterns([]);
    } finally {
      setLoading(false);
    }
  }, [search, groupFilter, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const s = new Set<string>();
    patterns.forEach((p) => {
      if (p.group) s.add(p.group);
    });
    return Array.from(s).sort();
  }, [patterns]);

  const openPlayground = (id: string) => {
    window.location.href = `${basePath}/playground?pattern=${encodeURIComponent(id)}`;
  };

  const handleClone = async (id: string) => {
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(id)}/clone`), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { id: string };
      setBanner({ variant: 'default', title: 'Pattern cloned', description: `New id: ${json.id}` });
      await load();
    } catch (e) {
      setBanner({
        variant: 'destructive',
        title: 'Clone failed',
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete pattern "${title}"?`)) return;
    try {
      await deletePattern(id);
      setBanner({ variant: 'default', title: 'Pattern deleted' });
      await load();
    } catch (e) {
      setBanner({
        variant: 'destructive',
        title: 'Delete failed',
        description: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  };

  const showActions = status === 'authenticated';

  return (
    <Layout
      config={config as never}
      menu={menu as never}
      current={{ path: '/patterns', title: 'Patterns' } as never}
      metadata={{ title: 'Patterns', description: '' } as never}
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        {banner && (
          <Alert variant={banner.variant === 'destructive' ? 'destructive' : 'default'}>
            <AlertTitle>{banner.title}</AlertTitle>
            {banner.description ? <AlertDescription>{banner.description}</AlertDescription> : null}
          </Alert>
        )}

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Patterns</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Search saved layouts and open them in the Playground.
            </p>
          </div>
          <Button asChild>
            <Link href={`${basePath}/playground`}>New in Playground</Link>
          </Button>
        </div>

        {status === 'unauthenticated' && (
          <p className="text-sm text-muted-foreground">Sign in to browse patterns from the database.</p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by title or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void load()}
            />
          </div>
          {groups.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="shrink-0">
                  {groupFilter ?? 'All groups'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setGroupFilter(null)}>All groups</DropdownMenuItem>
                {groups.map((g) => (
                  <DropdownMenuItem key={g} onClick={() => setGroupFilter(g)}>
                    {g}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="secondary" className="shrink-0" onClick={() => void load()}>
            Search
          </Button>
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : patterns.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No patterns yet</CardTitle>
              <CardDescription>
                Create layouts in the Playground and save them as patterns, or seed patterns from your Handoff build.
              </CardDescription>
            </CardHeader>
            <CardFooter>
              <Button asChild variant="outline">
                <Link href={`${basePath}/playground`}>Open Playground</Link>
              </Button>
            </CardFooter>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {patterns.map((p) => (
              <Card key={p.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="line-clamp-2 text-base">{p.title}</CardTitle>
                    {p._source && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                        {p._source}
                      </span>
                    )}
                  </div>
                  {p.description ? (
                    <CardDescription className="line-clamp-3">{p.description}</CardDescription>
                  ) : null}
                </CardHeader>
                <CardContent className="flex-1 text-xs text-muted-foreground">
                  <p>
                    {p._componentCount ?? p.components?.length ?? 0} block(s)
                    {p.group ? ` · ${p.group}` : ''}
                  </p>
                  {p._updatedAt && <p className="mt-1">Updated {new Date(p._updatedAt).toLocaleString()}</p>}
                </CardContent>
                <CardFooter className="flex flex-wrap gap-2 border-t pt-4">
                  <Button size="sm" variant="default" className="gap-1" onClick={() => openPlayground(p.id)}>
                    <ExternalLink className="h-3.5 w-3.5" />
                    Open in Playground
                  </Button>
                  {showActions && (
                    <>
                      <Button size="sm" variant="outline" className="gap-1" onClick={() => void handleClone(p.id)}>
                        <Copy className="h-3.5 w-3.5" />
                        Clone
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-destructive hover:text-destructive"
                        onClick={() => void handleDelete(p.id, p.title)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Delete
                      </Button>
                    </>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
