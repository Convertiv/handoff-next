'use client';

import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import { handoffApiUrl } from '../../lib/api-path';
import { useAuthUi } from '../context/AuthUiContext';
import { Button } from '../ui/button';
import { MarkdownComponents, remarkCodeMeta } from './MarkdownComponents';
import { WysiwygEditor } from './WysiwygEditor';

type MarkdownEditorProps = {
  pageSlug: string;
  content: string;
  metadata: Record<string, unknown>;
  bodyRef: React.RefObject<HTMLDivElement | null>;
  isEmptyPage?: boolean;
};

export function MarkdownEditor({ pageSlug, content, metadata, bodyRef, isEmptyPage = false }: MarkdownEditorProps) {
  const { authEnabled } = useAuthUi();
  const { data: session, status } = useSession();
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  const canEdit = authEnabled && status === 'authenticated' && Boolean(session?.user);

  const enterEdit = useCallback(() => {
    setError(null);
    setDraft(content);
    setEditing(true);
  }, [content]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setError(null);
  }, []);

  const save = useCallback(async (markdownToSave: string) => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/pages'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: pageSlug,
          frontmatter: metadata,
          markdown: markdownToSave,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? `Save failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [pageSlug, metadata, router]);

  // ── unauthenticated / read-only ───────────────────────────────────────────
  if (!canEdit) {
    return (
      <div className="prose prose-sm dark:prose-invert mb-10" ref={bodyRef}>
        <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  // ── empty page create prompt ──────────────────────────────────────────────
  if (!editing && isEmptyPage && !String(content ?? '').trim()) {
    return (
      <div className="space-y-3">
        <Button type="button" variant="default" size="sm" onClick={enterEdit}>
          Create page
        </Button>
        <p className="text-sm text-muted-foreground">
          No content yet. Create a page to start writing.
        </p>
      </div>
    );
  }

  // ── edit mode: WYSIWYG ────────────────────────────────────────────────────
  if (editing) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Use <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">#</kbd> for headings,{' '}
            <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">**bold**</kbd>,{' '}
            <kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">- item</kbd> for lists.
            Select text to format.
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {error && <span className="text-sm text-destructive">{error}</span>}
            <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={() => void save(draft)} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-background px-6 py-4 focus-within:ring-1 focus-within:ring-primary/30">
          <WysiwygEditor
            content={draft}
            onChange={setDraft}
            placeholder="Start writing…"
            containerRef={editorContainerRef}
          />
        </div>
      </div>
    );
  }

  // ── read mode: rendered markdown + hover-reveal edit button ───────────────
  return (
    <div className="group/prose relative">
      <div className="prose prose-sm dark:prose-invert mb-10" ref={bodyRef}>
        <ReactMarkdown components={MarkdownComponents} remarkPlugins={[remarkGfm, remarkCodeMeta]} rehypePlugins={[rehypeRaw]}>
          {content}
        </ReactMarkdown>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={enterEdit}
        className="absolute right-0 top-0 gap-1.5 opacity-0 transition-opacity group-hover/prose:opacity-100"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
        Edit content
      </Button>
    </div>
  );
}
