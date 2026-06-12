'use client';

import { FilePlus2, FileText, FolderOpen, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import Layout from '../../../components/Layout/Main';
import { handoffApiUrl } from '../../../lib/api-path';
import type { HandoffPageSummary } from '../../../lib/server/doc-pages';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';

// ── helpers ────────────────────────────────────────────────────────────────────

function groupBySection(pages: HandoffPageSummary[]): Map<string, HandoffPageSummary[]> {
  const map = new Map<string, HandoffPageSummary[]>();
  for (const page of pages) {
    const [top] = page.slug.split('/');
    const bucket = top || '(root)';
    if (!map.has(bucket)) map.set(bucket, []);
    map.get(bucket)!.push(page);
  }
  // Sort each bucket by slug
  for (const [, pages] of map) {
    pages.sort((a, b) => a.slug.localeCompare(b.slug));
  }
  return map;
}

function formatDate(d: Date | null | string): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function slugToPath(slug: string): string {
  return `/${slug}`;
}

// ── subcomponents ──────────────────────────────────────────────────────────────

function NewPageDialog({ onCreated }: { onCreated: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const normaliseSlug = (raw: string) =>
    raw
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9/_-]/g, '')
      .replace(/^\/+|\/+$/g, '');

  const handleCreate = () => {
    const finalSlug = normaliseSlug(slug);
    if (!finalSlug) {
      setError('Slug is required.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await fetch(handoffApiUrl('/api/handoff/pages'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: finalSlug, frontmatter: { title: '' }, markdown: '' }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to create page.');
        return;
      }
      setOpen(false);
      setSlug('');
      onCreated(finalSlug);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <FilePlus2 className="h-4 w-4" /> New page
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create a new page</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="new-page-slug">Page path</Label>
            <Input
              id="new-page-slug"
              placeholder="e.g. guides/getting-started"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
            <p className="text-xs text-muted-foreground">
              Use forward slashes for nesting, e.g. <code>guides/installation</code>. Will be accessible at <code>/{normaliseSlug(slug) || '…'}</code>.
            </p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={pending}>
            {pending ? 'Creating…' : 'Create page'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PageRow({
  page,
  onDeleted,
}: {
  page: HandoffPageSummary;
  onDeleted: (slug: string) => void;
}) {
  const [deleting, startTransition] = useTransition();

  const handleDelete = () => {
    if (!confirm(`Delete page "${page.slug}"? This cannot be undone.`)) return;
    startTransition(async () => {
      await fetch(handoffApiUrl(`/api/handoff/pages?slug=${encodeURIComponent(page.slug)}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      onDeleted(page.slug);
    });
  };

  return (
    <div className="group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/50">
      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm font-medium">{page.title || <span className="text-muted-foreground italic">Untitled</span>}</span>
        <span className="ml-2 text-xs text-muted-foreground">{slugToPath(page.slug)}</span>
      </div>
      <span className="hidden text-xs text-muted-foreground sm:block">{formatDate(page.updatedAt)}</span>
      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <Button asChild variant="ghost" size="icon" className="h-7 w-7" title="Edit page">
          <Link href={`/admin/pages/edit?slug=${encodeURIComponent(page.slug)}`}>
            <Pencil className="h-3.5 w-3.5" />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
          title="Delete page"
          onClick={handleDelete}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function SectionGroup({
  section,
  pages,
  onDeleted,
}: {
  section: string;
  pages: HandoffPageSummary[];
  onDeleted: (slug: string) => void;
}) {
  const label = section === '(root)' ? 'Root pages' : section.charAt(0).toUpperCase() + section.slice(1);
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <FolderOpen className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-semibold">{label}</span>
        <Badge variant="secondary" className="ml-auto text-xs">{pages.length}</Badge>
      </div>
      <div className="p-2">
        {pages.map((p) => (
          <PageRow key={p.slug} page={p} onDeleted={onDeleted} />
        ))}
      </div>
    </div>
  );
}

// ── main client component ──────────────────────────────────────────────────────

export default function PagesClient({
  initialPages,
  config,
  menu,
}: {
  initialPages: HandoffPageSummary[];
  config: unknown;
  menu: unknown;
}) {
  const router = useRouter();
  const [pages, setPages] = useState<HandoffPageSummary[]>(initialPages);

  const handleCreated = (slug: string) => {
    router.push(`/admin/pages/edit?slug=${encodeURIComponent(slug)}`);
  };

  const handleDeleted = (slug: string) => {
    setPages((prev) => prev.filter((p) => p.slug !== slug));
    router.refresh();
  };

  const grouped = groupBySection(pages);
  const sortedSections = [...grouped.keys()].sort((a, b) => {
    if (a === '(root)') return -1;
    if (b === '(root)') return 1;
    return a.localeCompare(b);
  });

  const layoutMeta = {
    metaTitle: 'Page Manager',
    metaDescription: 'Create, edit, and organise pages in the design system knowledge base',
  };

  const current = {
    path: '/admin/pages',
    title: 'Page Manager',
    subSections: [],
  };

  return (
    <Layout config={config} menu={menu} current={current} metadata={layoutMeta}>
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Page Manager</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage the markdown pages that make up your design system knowledge base.
            </p>
          </div>
          <NewPageDialog onCreated={handleCreated} />
        </div>

        {pages.length === 0 ? (
          <div className="flex min-h-[200px] flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
            <FileText className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm font-medium">No pages yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Create your first page using the button above, or push pages from a workspace with{' '}
              <code className="rounded bg-muted px-1 py-0.5">handoff-app push:all</code>.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedSections.map((section) => (
              <SectionGroup
                key={section}
                section={section}
                pages={grouped.get(section)!}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
