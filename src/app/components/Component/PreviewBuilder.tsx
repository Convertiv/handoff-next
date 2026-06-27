'use client';

import type { PreviewObject } from '@handoff/types/preview';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { handoffApiUrl } from '../../lib/api-path';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import Preview, { renderPreview } from '../Playground/Preview';

/** Legacy/runtime property shape from handoff_component.properties. */
type PropMeta = {
  name?: string;
  type?: string;
  enum?: unknown[];
  default?: unknown;
  rules?: { required?: boolean; content?: { min?: number; max?: number } };
};

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

/** Recommended semantic vocabulary (open — free text also allowed). */
const SEMANTIC_OPTIONS = [
  'primary',
  'secondary',
  'tertiary',
  'destructive',
  'success',
  'warning',
  'info',
  'disabled',
  'empty-state',
  'loading',
  'default',
];

const NONE = '__none__';

/**
 * Registry preview builder (Component+Preview standard, P2 slice 3). Renders the
 * component's property contract as a form (read-only field definitions, editable
 * values), captures semantic + rationale, validates on save against the contract
 * (server returns 422 with field errors), and persists via the slice-2 CRUD API.
 * Live preview reuses the §14-hardened Playground iframe — the same render path
 * the playground uses (block-edit == preview-edit).
 */
export function PreviewBuilder({ componentId, preview }: { componentId: string; preview: PreviewObject | undefined }) {
  const { status, data: session } = useSession();
  const canEdit = status === 'authenticated' && Boolean(session?.user);

  const properties = useMemo(
    () => ((preview?.properties ?? {}) as Record<string, PropMeta>),
    [preview?.properties]
  );
  const propKeys = useMemo(() => Object.keys(properties), [properties]);
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const apiBase = `/api/registry/components/${encodeURIComponent(componentId)}/previews`;

  const [list, setList] = useState<RegistryPreview[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [semantic, setSemantic] = useState('');
  const [rationale, setRationale] = useState('');
  const [errors, setErrors] = useState<{ key: string; message: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');

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

  const resetForm = useCallback(() => {
    const init: Record<string, unknown> = {};
    for (const k of propKeys) if (properties[k]?.default !== undefined) init[k] = properties[k].default;
    setEditingId(null);
    setTitle('');
    setValues(init);
    setSemantic('');
    setRationale('');
    setErrors([]);
  }, [propKeys, properties]);

  // Seed the form once the contract is available.
  useEffect(() => {
    if (propKeys.length && !editingId && Object.keys(values).length === 0) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propKeys.length]);

  // Live render via the hardened Playground iframe (best-effort; degrades to fallback).
  useEffect(() => {
    if (!preview) return;
    let cancelled = false;
    (async () => {
      try {
        const html = await renderPreview(
          { ...(preview as unknown as Record<string, unknown>), id: componentId, data: values } as never,
          values,
          basePath
        );
        if (!cancelled) setPreviewHtml(html);
      } catch {
        /* ignore — preview is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [values, preview, componentId, basePath]);

  const setVal = (key: string, val: unknown) => setValues((v) => ({ ...v, [key]: val }));

  const save = useCallback(async () => {
    setErrors([]);
    setSaving(true);
    try {
      const body = {
        title,
        values,
        semantic: semantic || null,
        rationale: rationale || null,
      };
      const res = await fetch(handoffApiUrl(editingId ? `${apiBase}/${editingId}` : apiBase), {
        method: editingId ? 'PATCH' : 'POST',
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
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  }, [title, values, semantic, rationale, editingId, apiBase, resetForm, load]);

  const editRow = (p: RegistryPreview) => {
    setEditingId(p.id);
    setTitle(p.title);
    setValues(p.values ?? {});
    setSemantic(p.semantic ?? '');
    setRationale(p.rationale ?? '');
    setErrors([]);
  };

  const remove = async (id: string) => {
    await fetch(handoffApiUrl(`${apiBase}/${id}`), { method: 'DELETE', credentials: 'include' });
    if (editingId === id) resetForm();
    await load();
  };

  if (!canEdit) return null;

  const errorFor = (key: string) => errors.find((e) => e.key === key)?.message;
  const generalError = errors.find((e) => !e.key)?.message;

  return (
    <div className="mb-4 rounded-md border border-dashed border-violet-400/50 bg-violet-50/40 p-4 dark:border-violet-700/50 dark:bg-violet-950/20">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-violet-800 dark:text-violet-200">
        Previews — {editingId ? 'edit' : 'new'}
      </p>

      {/* Existing registry previews */}
      {list.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {list.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs dark:border-violet-800 dark:bg-gray-900">
              <button className="font-medium hover:underline" onClick={() => editRow(p)}>
                {p.title || p.previewKey}
              </button>
              {p.semantic ? <span className="text-violet-500">· {p.semantic}</span> : null}
              {p.syncState === 'drifted' ? <span className="text-amber-600" title="Valid at an earlier component version">⚠ drifted</span> : null}
              <button className="ml-1 text-gray-400 hover:text-red-500" title="Delete" onClick={() => remove(p.id)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {generalError ? <p className="mb-2 text-sm text-red-600">{generalError}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Form */}
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600 dark:text-gray-400">Title</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Primary — main page CTA" disabled={saving} />
          </label>

          {propKeys.length === 0 ? (
            <p className="text-xs text-gray-500">This component has no documented properties to set.</p>
          ) : (
            propKeys.map((key) => {
              const meta = properties[key] ?? {};
              const label = meta.name || key;
              const enumOpts = Array.isArray(meta.enum) ? (meta.enum as unknown[]).map(String) : null;
              const raw = values[key];
              const fieldErr = errorFor(key);
              return (
                <label key={key} className="flex flex-col gap-1">
                  <span className="text-xs text-gray-600 dark:text-gray-400">
                    {label}
                    {meta.rules?.required ? <span className="text-red-500"> *</span> : null}
                  </span>
                  {enumOpts ? (
                    <Select value={raw != null ? String(raw) : NONE} onValueChange={(v) => setVal(key, v === NONE ? '' : v)}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>—</SelectItem>
                        {enumOpts.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : meta.type === 'boolean' ? (
                    <input type="checkbox" checked={Boolean(raw)} onChange={(e) => setVal(key, e.target.checked)} disabled={saving} />
                  ) : meta.type === 'number' ? (
                    <Input type="number" value={raw != null ? String(raw) : ''} onChange={(e) => setVal(key, e.target.value === '' ? '' : Number(e.target.value))} disabled={saving} />
                  ) : meta.type === 'richtext' || (meta.rules?.content?.max ?? 0) > 120 ? (
                    <Textarea className="min-h-[80px] text-sm" value={raw != null ? String(raw) : ''} onChange={(e) => setVal(key, e.target.value)} disabled={saving} />
                  ) : (
                    <Input value={raw != null ? String(raw) : ''} onChange={(e) => setVal(key, e.target.value)} disabled={saving} />
                  )}
                  {fieldErr ? <span className="text-xs text-red-600">{fieldErr}</span> : null}
                </label>
              );
            })
          )}

          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600 dark:text-gray-400">Semantic meaning</span>
            <Select value={semantic || NONE} onValueChange={(v) => setSemantic(v === NONE ? '' : v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {SEMANTIC_OPTIONS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-gray-600 dark:text-gray-400">Rationale (why this preview / when to use it)</span>
            <Textarea className="min-h-[60px] text-sm" value={rationale} onChange={(e) => setRationale(e.target.value)} disabled={saving} />
          </label>

          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={saving || !title.trim()}>
              {saving ? 'Saving…' : editingId ? 'Update preview' : 'Create preview'}
            </Button>
            {editingId ? (
              <Button size="sm" variant="outline" onClick={resetForm} disabled={saving}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>

        {/* Live preview (hardened iframe, §14) */}
        <div className="min-h-[200px] overflow-hidden rounded border border-gray-200 dark:border-gray-800">
          {previewHtml ? <Preview html={previewHtml} className="min-h-[200px]" /> : <div className="p-4 text-xs text-gray-500">Live preview…</div>}
        </div>
      </div>
    </div>
  );
}
