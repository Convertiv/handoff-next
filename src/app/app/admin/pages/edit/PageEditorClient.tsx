'use client';

import { ArrowLeft, Eye, Save } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState, useTransition } from 'react';
import Layout from '../../../../components/Layout/Main';
import { handoffApiUrl } from '../../../../lib/api-path';
import type { HandoffPageRow } from '../../../../lib/server/doc-pages';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Label } from '../../../../components/ui/label';
import { WysiwygEditor } from '../../../../components/Markdown/WysiwygEditor';

export default function PageEditorClient({
  slug,
  initialPage,
  config,
  menu,
}: {
  slug: string;
  initialPage: HandoffPageRow | null;
  config: unknown;
  menu: unknown;
}) {
  const [title, setTitle] = useState<string>(
    String(initialPage?.frontmatter?.title ?? '')
  );
  const [description, setDescription] = useState<string>(
    String(initialPage?.frontmatter?.description ?? '')
  );
  const [markdown, setMarkdown] = useState<string>(initialPage?.markdown ?? '');
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSave = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const res = await fetch(handoffApiUrl('/api/handoff/pages'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          frontmatter: { title, description },
          markdown,
        }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to save page.');
        return;
      }
      setSavedAt(new Date());
    });
  }, [slug, title, description, markdown]);

  // ⌘S / Ctrl+S
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave]
  );

  const layoutMeta = {
    metaTitle: `Edit · ${slug}`,
    metaDescription: `Editing page ${slug}`,
  };

  const current = {
    path: '/admin/pages',
    title: 'Page Manager',
    subSections: [],
  };

  return (
    <Layout config={config} menu={menu} current={current} metadata={layoutMeta}>
      <div className="mx-auto max-w-3xl space-y-6" onKeyDown={handleKeyDown}>
        {/* header row */}
        <div className="flex flex-wrap items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="-ml-2 gap-1.5 text-muted-foreground">
            <Link href="/admin/pages">
              <ArrowLeft className="h-4 w-4" /> All pages
            </Link>
          </Button>
          <div className="flex-1" />
          <code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">{slug}</code>
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href={`/${slug}`} target="_blank" rel="noopener noreferrer">
              <Eye className="h-4 w-4" /> Preview
            </a>
          </Button>
          <Button size="sm" className="gap-1.5" onClick={handleSave} disabled={pending}>
            <Save className="h-4 w-4" /> {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>

        {error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        {savedAt && !error && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
            Saved at {savedAt.toLocaleTimeString()}
          </div>
        )}

        {/* metadata fields */}
        <div className="grid gap-4 rounded-lg border bg-card p-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="page-title">Title</Label>
            <Input
              id="page-title"
              placeholder="Page title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="page-description">Description</Label>
            <Input
              id="page-description"
              placeholder="Short description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>

        {/* WYSIWYG body editor */}
        <div className="rounded-lg border bg-background px-6 py-5 focus-within:ring-1 focus-within:ring-primary/30">
          <WysiwygEditor
            content={markdown}
            onChange={setMarkdown}
            placeholder="Start writing your page content…"
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Select text to format. Type <kbd className="rounded bg-muted px-1 font-mono">##&nbsp;</kbd> for headings,{' '}
          <kbd className="rounded bg-muted px-1 font-mono">-&nbsp;</kbd> for lists,{' '}
          <kbd className="rounded bg-muted px-1 font-mono">**bold**</kbd> inline. Press ⌘S to save.
        </p>
      </div>
    </Layout>
  );
}
