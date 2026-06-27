'use client';

import type { PreviewObject } from '@handoff/types/preview';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { handoffApiUrl } from '../../lib/api-path';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/dialog';
import { EditContextProvider, useEditContext } from '../Playground/EditContext';
import { renderFormFields } from '../Playground/fields/Field';
import MediaBrowser from '../Playground/MediaBrowser';
import Preview, { previewRenderedHtml } from '../Playground/Preview';
import type { PlaygroundComponent, SelectedPlaygroundComponent } from '../Playground/types';
import type { RegistryPreviewLite } from '@handoff/transformers/preview/component/preview-merge';

const SEMANTIC_OPTIONS = [
  'primary', 'secondary', 'tertiary', 'destructive', 'success', 'warning', 'info', 'disabled', 'empty-state', 'loading', 'default',
];
const NONE = '__none__';

const WIDTH_PRESETS: { id: string; label: string; width: string; Icon: typeof Monitor }[] = [
  { id: 'desktop', label: 'Desktop', width: '100%', Icon: Monitor },
  { id: 'tablet', label: 'Tablet', width: '820px', Icon: Tablet },
  { id: 'mobile', label: 'Mobile', width: '390px', Icon: Smartphone },
];

/**
 * The component workbench (the editor behind the preview surface's "Open
 * component workbench" button). Single-component playground — shared
 * EditContext + field builder + §14 themed frame — that authors a registry
 * preview. Owns only the preview metadata (title/semantic/rationale) and the
 * CRUD; the field UX and render are the playground's.
 */
export function ComponentWorkbenchDialog({
  open,
  onOpenChange,
  component,
  componentId,
  initialValues,
  editing,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  component: PreviewObject | undefined;
  componentId: string;
  initialValues: Record<string, unknown>;
  editing: RegistryPreviewLite | null;
  onSaved: (savedId: string) => void;
}) {
  const apiBase = `/api/registry/components/${encodeURIComponent(componentId)}/previews`;
  const [title, setTitle] = useState('');
  const [semantic, setSemantic] = useState('');
  const [rationale, setRationale] = useState('');
  const [errors, setErrors] = useState<{ key: string; message: string }[]>([]);
  const [saving, setSaving] = useState(false);

  // Seed metadata when the dialog opens / target changes.
  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title ?? '');
    setSemantic(editing?.semantic ?? '');
    setRationale(editing?.rationale ?? '');
    setErrors([]);
  }, [open, editing]);

  const selectedComponent = useMemo<SelectedPlaygroundComponent>(() => {
    const base = (component ?? {}) as unknown as PlaygroundComponent;
    return {
      ...base,
      data: editing ? { ...editing.values } : { ...initialValues },
      order: 0,
      quantity: 1,
      uniqueId: `pv-${componentId}-${editing?.id ?? 'new'}`,
    };
  }, [component, initialValues, editing, componentId]);

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
        const j = (await res.json().catch(() => ({}))) as { preview?: { id?: string } };
        onOpenChange(false);
        if (j.preview?.id) onSaved(j.preview.id);
      } finally {
        setSaving(false);
      }
    },
    [title, semantic, rationale, editing, apiBase, onOpenChange, onSaved]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-[95vw] flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-sm">Component workbench — {component?.title}</DialogTitle>
        </DialogHeader>
        {open ? (
          <EditContextProvider key={selectedComponent.uniqueId} component={selectedComponent} onCommit={handleCommit}>
            <WorkbenchBody
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
  );
}

/** Visual (left) + shared fields + metadata (right). */
function WorkbenchBody({
  title, setTitle, semantic, setSemantic, rationale, setRationale, errors, saving, saveLabel,
}: {
  title: string; setTitle: (v: string) => void;
  semantic: string; setSemantic: (v: string) => void;
  rationale: string; setRationale: (v: string) => void;
  errors: { key: string; message: string }[];
  saving: boolean; saveLabel: string;
}) {
  const { component, properties, data, previewHtml, iframeRef, handleSave } = useEditContext();
  const isReact = component?.format === 'react';
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const previewContent = isReact ? previewHtml : previewRenderedHtml(previewHtml, basePath);
  const [previewWidth, setPreviewWidth] = useState('100%');

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_360px]">
      <div className="dotted-bg flex min-h-[300px] flex-col overflow-hidden border-r">
        <div className="flex items-center justify-center gap-1 border-b bg-background/60 p-1.5">
          {WIDTH_PRESETS.map(({ id, label, width, Icon }) => (
            <button
              key={id}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={previewWidth === width}
              onClick={() => setPreviewWidth(width)}
              className={cn(
                'flex h-7 w-9 items-center justify-center rounded transition-colors [&_svg]:size-3.5',
                previewWidth === width
                  ? 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              <Icon />
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-auto p-3">
          <div style={{ width: previewWidth, maxWidth: '100%', height: '100%', margin: '0 auto' }}>
            <Preview html={previewContent} iframeRef={isReact ? iframeRef : undefined} className="h-full w-full" />
          </div>
        </div>
      </div>
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
