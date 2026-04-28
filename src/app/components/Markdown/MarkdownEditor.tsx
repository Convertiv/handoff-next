'use client';

import matter from 'gray-matter';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { handoffApiUrl } from '../../lib/api-path';
import { useAuthUi } from '../context/AuthUiContext';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { MarkdownComponents, remarkCodeMeta } from './MarkdownComponents';

type MarkdownEditorProps = {
  pageSlug: string;
  /** Markdown body only (no frontmatter) — matches `fetchDocPageMarkdown` content. */
  content: string;
  /** Frontmatter object from gray-matter `data`. */
  metadata: Record<string, unknown>;
  /** Ref attached to the rendered markdown container (for TOC anchors). */
  bodyRef: React.RefObject<HTMLDivElement | null>;
  /** True when no filesystem/DB page exists yet (create flow). */
  isEmptyPage?: boolean;
};

function defaultFullDocument(): string {
  return matter.stringify('# New page\n\nStart writing…\n', {
    title: 'New page',
    description: '',
    metaTitle: 'New page',
    metaDescription: '',
  });
}

export function MarkdownEditor({ pageSlug, content, metadata, bodyRef, isEmptyPage = false }: MarkdownEditorProps) {
  const { authEnabled } = useAuthUi();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = authEnabled && status === 'authenticated' && Boolean(session?.user);

  const initialFullDoc = useMemo(() => {
    if (isEmptyPage && !content) {
      return defaultFullDocument();
    }
    try {
      return matter.stringify(content, metadata);
    } catch {
      return matter.stringify(content, {});
    }
  }, [content, metadata, isEmptyPage]);

  const enterEdit = useCallback(() => {
    setError(null);
    setDraft(initialFullDoc);
    setEditing(true);
  }, [initialFullDoc]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDraft('');
    setError(null);
  }, []);

  const save = useCallback(async () => {
    setError(null);
    let parsed: ReturnType<typeof matter>;
    try {
      parsed = matter(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid markdown');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/pages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: pageSlug,
          frontmatter: parsed.data as Record<string, unknown>,
          markdown: parsed.content,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? `Save failed (${res.status})`);
        return;
      }
      setEditing(false);
      setDraft('');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [draft, pageSlug, router]);

  const previewParsed = useMemo(() => {
    try {
      return matter(draft || initialFullDoc);
    } catch {
      return { data: {}, content: '' };
    }
  }, [draft, initialFullDoc]);

  if (!canEdit) {
    return (
      <div className="prose mb-10" ref={bodyRef}>
        <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  if (!editing) {
    if (isEmptyPage && !String(content ?? '').trim()) {
      return (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button type="button" variant="default" size="sm" onClick={enterEdit}>
              Create page
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            No page exists at this path yet. Create one to save markdown to the database (dynamic mode).
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={enterEdit}>
            Edit
          </Button>
        </div>
        <div className="prose mb-10" ref={bodyRef}>
          <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {error ? <span className="mr-auto text-sm text-destructive">{error}</span> : null}
        <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <div className="grid min-h-[480px] gap-4 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Markdown (including YAML frontmatter)</p>
          <Textarea
            className="min-h-[420px] font-mono text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="min-w-0">
          <p className="mb-2 text-xs font-medium text-muted-foreground">Preview</p>
          <div className="prose mb-10 max-h-[70vh] overflow-y-auto rounded-md border border-border p-4" ref={bodyRef}>
            <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
              {previewParsed.content}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
