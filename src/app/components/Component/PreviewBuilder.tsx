'use client';

import type { PreviewObject } from '@handoff/types/preview';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { handoffApiUrl } from '../../lib/api-path';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
// Shared playground building blocks — one field builder + one themed preview frame.
import { EditContextProvider, useEditContext } from '../Playground/EditContext';
import { renderFormFields } from '../Playground/fields/Field';
import MediaBrowser from '../Playground/MediaBrowser';
import Preview, { previewRenderedHtml } from '../Playground/Preview';
import type { PlaygroundComponent, SelectedPlaygroundComponent } from '../Playground/types';

type RegistryPreview = {
  id: string;
  previewKey: string;
  title: string;
  values: Record<string, unknown>;
  semantic: string | null;
  rationale: string | null;
  syncState: string;
  componentVersion: number | null;
};

const SEMANTIC_OPTIONS = [
  'primary', 'secondary', 'tertiary', 'destructive', 'success', 'warning', 'info', 'disabled', 'empty-state', 'loading', 'default',
];
const NONE = '__none__';

function defaultsFromProperties(properties: Record<string, { default?: unknown }>): Record<string, unknown> {
  const init: Record<string, unknown> = {};
  for (const [k, m] of Object.entries(properties ?? {})) if (m?.default !== undefined) init[k] = m.default;
  return init;
}

/**
 * Registry preview builder (P2 slice 3, unified). The form, field types, and live
 * preview are the playground's — `renderFormFields` (array=repeater, object=collapsible,
 * image selector, …) + the §14-hardened themed `Preview`, wired through the shared
 * `EditContextProvider`. The builder owns only the preview-level metadata
 * (title/semantic/rationale) and CRUDs registry previews via the slice-2 API.
 */
export function PreviewBuilder({ componentId, preview }: { componentId: string; preview: PreviewObject | undefined }) {
  const { status, data: session } = useSession();
  const canEdit = status === 'authenticated' && Boolean(session?.user);
  const apiBase = `/api/registry/components/${encodeURIComponent(componentId)}/previews`;

  const properties = useMemo(() => ((preview?.properties ?? {}) as Record<string, { default?: unknown }>), [preview?.properties]);
  const renderable = Boolean((preview as { code?: string; html?: string } | undefined)?.code || (preview as { html?: string } | undefined)?.html);

  const [list, setList] = useState<RegistryPreview[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RegistryPreview | null>(null);
  const [title, setTitle] = useState('');
  const [semantic, setSemantic] = useState('');
  const [rationale, setRationale] = useState('');
  const [errors, setErrors] = useState<{ key: string; message: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(handoffApiUrl(apiBase), { credentials: 'include' });
    if (res.ok) {
      const j = (await res.json()) as { previews?: RegistryPreview[] };
      setList(j.previews ?? []);
    }
  }, [apiBase]);

  useEffect(() => {
    if (canEdit) void load();
  }, [canEdit, load]);

  const openNew = () => {
    setEditing(null);
    setTitle('');
    setSemantic('');
    setRationale('');
    setErrors([]);
    setOpen(true);
  };

  const openEdit = (p: RegistryPreview) => {
    setEditing(p);
    setTitle(p.title);
    setSemantic(p.semantic ?? '');
    setRationale(p.rationale ?? '');
    setErrors([]);
    setOpen(true);
  };

  const remove = async (id: string) => {
    await fetch(handoffApiUrl(`${apiBase}/${id}`), { method: 'DELETE', credentials: 'include' });
    await load();
  };

  // The component-instance the shared EditContext edits: the real component
  // (so the preview is themed) seeded with the values being authored.
  const selectedComponent = useMemo<SelectedPlaygroundComponent>(() => {
    const base = (preview ?? {}) as unknown as PlaygroundComponent;
    return {
      ...base,
      data: editing ? { ...editing.values } : defaultsFromProperties(properties),
      order: 0,
      quantity: 1,
      uniqueId: `pv-${componentId}-${editing?.id ?? 'new'}`,
    };
  }, [preview, properties, editing, componentId]);

  const handleCommit = useCallback(
    async (updated: SelectedPlaygroundComponent) => {
      setErrors([]);
      setSaving(true);
      try {
        const body = {
          title,
          values: (updated.data as Record<string, unknown>) ?? {},
          semantic: semantic || null,
          rationale: rationale || null,
        };
        const res = await fetch(handoffApiUrl(editing ? `${apiBase}/${editing.id}` : apiBase), {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        });
        if (res.status === 422) {
          const j = (await res.json()) as { errors?: { key: string; message: string }[] };
          setErrors(j.errors ?? [{ key: '', message: 'Validation failed' }]);
          return;
        }
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setErrors([{ key: '', message: j.error || res.statusText }]);
          return;
        }
        setOpen(false);
        await load();
      } finally {
        setSaving(false);
      }
    },
    [title, semantic, rationale, editing, apiBase, load]
  );

  if (!canEdit) return null;

  return (
    <div className="mb-4 rounded-md border border-dashed border-violet-400/50 bg-violet-50/40 p-4 dark:border-violet-700/50 dark:bg-violet-950/20">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-violet-800 dark:text-violet-200">Previews</p>
        <Button size="sm" variant="outline" onClick={openNew} disabled={!renderable} title={renderable ? undefined : 'No renderable template for this component'}>
          Open component workbench
        </Button>
      </div>

      {list.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {list.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs dark:border-violet-800 dark:bg-gray-900">
              <button className="font-medium hover:underline" onClick={() => openEdit(p)}>
                {p.title || p.previewKey}
              </button>
              {p.semantic ? <span className="text-violet-500">· {p.semantic}</span> : null}
              {p.syncState === 'drifted' ? <span className="text-amber-600" title="Valid at an earlier component version">⚠</span> : null}
              <button className="ml-1 text-gray-400 hover:text-red-500" title="Delete" onClick={() => remove(p.id)}>×</button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500">No registry previews yet.</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[90vh] max-w-[95vw] flex-col gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-sm">Component workbench — {preview?.title}</DialogTitle>
          </DialogHeader>
          {open ? (
            <EditContextProvider key={selectedComponent.uniqueId} component={selectedComponent} onCommit={handleCommit}>
              <PreviewEditorBody
                title={title}
                setTitle={setTitle}
                semantic={semantic}
                setSemantic={setSemantic}
                rationale={rationale}
                setRationale={setRationale}
                errors={errors}
                saving={saving}
                saveLabel={editing ? 'Update preview' : 'Save as preview'}
              />
              <MediaBrowser />
            </EditContextProvider>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Inner editor body — consumes the shared EditContext: themed preview (left), shared fields + metadata (right). */
function PreviewEditorBody({
  title,
  setTitle,
  semantic,
  setSemantic,
  rationale,
  setRationale,
  errors,
  saving,
  saveLabel,
}: {
  title: string;
  setTitle: (v: string) => void;
  semantic: string;
  setSemantic: (v: string) => void;
  rationale: string;
  setRationale: (v: string) => void;
  errors: { key: string; message: string }[];
  saving: boolean;
  saveLabel: string;
}) {
  const { component, properties, data, previewHtml, iframeRef, handleSave } = useEditContext();
  const isReact = component?.format === 'react';
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const previewContent = isReact ? previewHtml : previewRenderedHtml(previewHtml, basePath);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
      {/* Visual — left */}
      <div className="dotted-bg min-h-[300px] overflow-hidden border-r">
        <Preview html={previewContent} iframeRef={isReact ? iframeRef : undefined} className="h-full w-full" />
      </div>

      {/* Fields — right */}
      <div className="flex min-h-0 flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600 dark:text-gray-400">Title</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Primary — main page CTA" />
          </label>

          {errors.length ? (
            <ul className="rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30">
              {errors.map((e, i) => (
                <li key={i}>{e.key ? `${e.key}: ` : ''}{e.message}</li>
              ))}
            </ul>
          ) : null}

          <div className="border-t pt-3">{renderFormFields(properties, data)}</div>

          <label className="flex flex-col gap-1 border-t pt-3">
            <span className="text-xs text-gray-600 dark:text-gray-400">Semantic meaning</span>
            <Select value={semantic || NONE} onValueChange={(v) => setSemantic(v === NONE ? '' : v)}>
              <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {SEMANTIC_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600 dark:text-gray-400">Rationale (why / when to use)</span>
            <Textarea className="min-h-[60px] text-sm" value={rationale} onChange={(e) => setRationale(e.target.value)} />
          </label>
        </div>
        <div className="border-t p-3">
          <Button onClick={handleSave} disabled={saving || !title.trim()} size="sm" className="w-full">
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
