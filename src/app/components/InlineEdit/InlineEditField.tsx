'use client';

import { Check, Pencil, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { handoffApiUrl } from '../../lib/api-path';

export interface InlineEditFieldProps {
  /** Current display value */
  value: string;
  /** DB page slug, e.g. "foundations/colors" or "guides/intro" */
  slug: string;
  /** The frontmatter key to update: "title", "description", etc. */
  frontmatterKey: string;
  /** Full current frontmatter — saved unchanged except for frontmatterKey */
  allFrontmatter: Record<string, unknown>;
  /** Current markdown body — passed through unchanged so we don't clobber it */
  markdown: string;
  /** Render the field value as this element when not editing */
  as?: 'h1' | 'p' | 'span';
  /** Extra classes applied to the wrapper div */
  className?: string;
  /** If true, user can edit; if false, renders as plain text */
  canEdit: boolean;
  /** Called after a successful save with the new value */
  onSaved?: (newValue: string) => void;
}

export function InlineEditField({
  value,
  slug,
  frontmatterKey,
  allFrontmatter,
  markdown,
  as: Tag = 'span',
  className = '',
  canEdit,
  onSaved,
}: InlineEditFieldProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(value);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [editing, value]);

  const commit = useCallback(async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const updatedFrontmatter = { ...allFrontmatter, [frontmatterKey]: draft };
      const res = await fetch(handoffApiUrl('/api/handoff/pages'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, frontmatter: updatedFrontmatter, markdown }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(json.error ?? `Save failed (${res.status})`);
        return;
      }
      setEditing(false);
      onSaved?.(draft);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [draft, value, allFrontmatter, frontmatterKey, markdown, slug, router, onSaved]);

  const cancel = useCallback(() => {
    setEditing(false);
    setDraft(value);
    setError(null);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void commit();
      }
      if (e.key === 'Escape') {
        cancel();
      }
    },
    [commit, cancel]
  );

  if (!canEdit) {
    return <Tag className={className}>{value}</Tag>;
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1">
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            className={[
              'flex-1 rounded border border-primary/40 bg-background px-2 py-1 ring-1 ring-primary/30 focus:outline-none',
              Tag === 'h1' ? 'text-3xl font-bold' : 'text-base text-muted-foreground',
              className,
            ].join(' ')}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={saving}
          />
          <button
            onClick={() => void commit()}
            disabled={saving}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            title="Save (Enter)"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={cancel}
            disabled={saving}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border bg-background text-muted-foreground hover:bg-muted disabled:opacity-50"
            title="Cancel (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div
      className="group relative inline-flex items-center gap-2 cursor-text"
      onClick={() => setEditing(true)}
      title="Click to edit"
    >
      <Tag className={className}>{value || <span className="italic text-muted-foreground opacity-50">Untitled</span>}</Tag>
      <button
        className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted text-muted-foreground hover:text-foreground"
        onClick={(e) => { e.stopPropagation(); setEditing(true); }}
        title={`Edit ${frontmatterKey}`}
        tabIndex={0}
      >
        <Pencil className="h-3 w-3" />
      </button>
    </div>
  );
}
