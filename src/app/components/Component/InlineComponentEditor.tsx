'use client';

import type { PreviewObject } from '@handoff/types/preview';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useState } from 'react';
import { handoffApiUrl } from '../../lib/api-path';
import { useAuthUi } from '../context/AuthUiContext';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';

type InlineComponentEditorProps = {
  componentId: string;
  /** Loaded preview JSON (undefined while loading). */
  preview: PreviewObject | undefined;
  /** Server metadata fallback before preview loads */
  metadataTitle: string;
  metadataDescription: string;
  onSaved: () => void | Promise<void>;
};

function useCanEditDynamic() {
  const { authEnabled } = useAuthUi();
  const { data: session, status } = useSession();
  const mode = process.env.NEXT_PUBLIC_HANDOFF_MODE ?? '';
  return authEnabled && status === 'authenticated' && Boolean(session?.user) && mode === 'dynamic';
}

export function InlineComponentEditor({
  componentId,
  preview,
  metadataTitle,
  metadataDescription,
  onSaved,
}: InlineComponentEditorProps) {
  const router = useRouter();
  const canEdit = useCanEditDynamic();
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const title = preview?.title ?? metadataTitle;
  const description = preview?.description ?? metadataDescription;
  const group = preview?.group ?? '';
  const categories = (preview?.categories ?? []).join(', ');
  const tags = (preview?.tags ?? []).join(', ');
  const shouldDoText = (preview?.should_do ?? []).join('\n');
  const shouldNotText = (preview?.should_not_do ?? []).join('\n');

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setErr(null);
      setSaving(true);
      try {
        const res = await fetch(handoffApiUrl('/api/handoff/components'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: componentId, ...body }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || res.statusText);
        }
        await onSaved();
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Save failed');
      } finally {
        setSaving(false);
      }
    },
    [componentId, onSaved, router]
  );

  if (!canEdit) return null;

  return (
    <div id="best-practices" className="mb-4 rounded-md border border-dashed border-sky-400/50 bg-sky-50/40 p-4 dark:border-sky-700/50 dark:bg-sky-950/20">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-sky-800 dark:text-sky-200">Inline edit (dynamic)</p>
      {err ? <p className="mb-2 text-sm text-red-600">{err}</p> : null}
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">Title</span>
          <div className="flex gap-2">
            <Input defaultValue={title} key={`${componentId}-title`} onBlur={(e) => e.target.value !== title && patch({ title: e.target.value })} disabled={saving} />
          </div>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">Description (markdown)</span>
          <Textarea
            className="min-h-[100px] font-mono text-sm"
            defaultValue={description}
            key={`${componentId}-desc`}
            onBlur={(e) => e.target.value !== description && patch({ description: e.target.value })}
            disabled={saving}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">Group</span>
          <Input defaultValue={group} key={`${componentId}-group`} onBlur={(e) => e.target.value !== group && patch({ group: e.target.value })} disabled={saving} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">Categories (comma-separated)</span>
          <Input
            defaultValue={categories}
            key={`${componentId}-cat`}
            onBlur={(e) => {
              const next = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              const prevJoined = (preview?.categories ?? []).join(', ');
              if (e.target.value.trim() !== prevJoined.trim()) patch({ categories: next });
            }}
            disabled={saving}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-gray-600 dark:text-gray-400">Tags (comma-separated)</span>
          <Input
            defaultValue={tags}
            key={`${componentId}-tags`}
            onBlur={(e) => {
              const next = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              const prevJoined = (preview?.tags ?? []).join(', ');
              if (e.target.value.trim() !== prevJoined.trim()) patch({ tags: next });
            }}
            disabled={saving}
          />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600 dark:text-gray-400">Best practices (one per line)</span>
            <Textarea
              className="min-h-[120px] font-mono text-sm"
              defaultValue={shouldDoText}
              key={`${componentId}-do`}
              onBlur={(e) => {
                const lines = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean);
                if (e.target.value.trim() !== shouldDoText.trim()) patch({ should_do: lines });
              }}
              disabled={saving}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600 dark:text-gray-400">Don&apos;ts (one per line)</span>
            <Textarea
              className="min-h-[120px] font-mono text-sm"
              defaultValue={shouldNotText}
              key={`${componentId}-dont`}
              onBlur={(e) => {
                const lines = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean);
                if (e.target.value.trim() !== shouldNotText.trim()) patch({ should_not_do: lines });
              }}
              disabled={saving}
            />
          </label>
        </div>
        {saving ? <p className="text-xs text-gray-500">Saving…</p> : null}
      </div>
    </div>
  );
}
