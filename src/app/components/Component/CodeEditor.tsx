'use client';

import type { PreviewObject } from '@handoff/types/preview';
import { useEffect, useState } from 'react';
import { handoffApiUrl } from '../../lib/api-path';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';

type TabKey = 'main' | 'scss' | 'js';

type CodeEditorProps = {
  componentId: string;
  preview: PreviewObject | undefined;
  onSourcesSaved: () => void | Promise<void>;
};

function entrySourcesFromPreview(preview: PreviewObject | undefined): { main: string; scss: string; js: string; renderer: string } {
  const data = preview as unknown as { entrySources?: Record<string, string>; renderer?: string };
  const es = data?.entrySources ?? {};
  const renderer = String(data?.renderer ?? preview?.renderer ?? 'handlebars');
  let main = '';
  if (renderer === 'react') main = es.component ?? '';
  else if (renderer === 'csf') main = es.story ?? '';
  else main = es.template ?? '';
  return { main, scss: es.scss ?? '', js: es.js ?? '', renderer };
}

export function CodeEditor({ componentId, preview, onSourcesSaved }: CodeEditorProps) {
  const [tab, setTab] = useState<TabKey>('main');
  const [main, setMain] = useState('');
  const [scss, setScss] = useState('');
  const [js, setJs] = useState('');
  const [renderer, setRenderer] = useState('handlebars');
  const [saving, setSaving] = useState(false);
  const [building, setBuilding] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const n = entrySourcesFromPreview(preview);
    setMain(n.main);
    setScss(n.scss);
    setJs(n.js);
    setRenderer(n.renderer);
  }, [preview]);

  const persistEntrySources = async () => {
    const entrySources: Record<string, string> = { scss, js };
    if (renderer === 'react') entrySources.component = main;
    else if (renderer === 'csf') entrySources.story = main;
    else entrySources.template = main;

    const res = await fetch(handoffApiUrl('/api/handoff/components'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id: componentId, data: { entrySources } }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(j.error || res.statusText);
    }
    await onSourcesSaved();
  };

  const saveSources = async () => {
    setErr(null);
    setSaving(true);
    setStatus(null);
    try {
      await persistEntrySources();
      setStatus('Saved source.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const saveAndBuild = async () => {
    setErr(null);
    setSaving(true);
    setBuilding(true);
    setStatus(null);
    try {
      await persistEntrySources();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
      setSaving(false);
      setBuilding(false);
      return;
    }
    setSaving(false);

    try {
      const res = await fetch(handoffApiUrl('/api/handoff/components/build'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ componentId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || res.statusText);
      }
      const { jobId } = (await res.json()) as { jobId: number };
      setStatus(`Build queued (#${jobId})…`);
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const st = await fetch(handoffApiUrl(`/api/handoff/components/build?jobId=${jobId}`), { credentials: 'include' });
        const row = (await st.json()) as { status?: string; error?: string | null };
        if (row.status === 'complete') {
          setStatus('Build complete. Reloading preview…');
          await onSourcesSaved();
          return;
        }
        if (row.status === 'failed') {
          throw new Error(row.error || 'Build failed');
        }
      }
      throw new Error('Build timed out while polling');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Build failed');
    } finally {
      setBuilding(false);
    }
  };

  const mainLabel = renderer === 'react' ? 'Component (.tsx)' : renderer === 'csf' ? 'Story (.tsx)' : 'Template (.hbs)';

  return (
    <div className="mb-6 rounded-md border border-gray-200 bg-gray-50/80 p-4 dark:border-gray-700 dark:bg-gray-900/40">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-700 dark:text-gray-300">Source (saves to DB, then preview build)</p>
      {err ? <p className="mb-2 text-sm text-red-600">{err}</p> : null}
      {status ? <p className="mb-2 text-xs text-gray-600 dark:text-gray-400">{status}</p> : null}
      <div className="mb-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" variant={tab === 'main' ? 'default' : 'outline'} onClick={() => setTab('main')}>
          {mainLabel}
        </Button>
        <Button type="button" size="sm" variant={tab === 'scss' ? 'default' : 'outline'} onClick={() => setTab('scss')}>
          SCSS
        </Button>
        <Button type="button" size="sm" variant={tab === 'js' ? 'default' : 'outline'} onClick={() => setTab('js')}>
          JS
        </Button>
      </div>
      {tab === 'main' ? (
        <Textarea className="min-h-[220px] w-full font-mono text-xs" value={main} onChange={(e) => setMain(e.target.value)} spellCheck={false} />
      ) : null}
      {tab === 'scss' ? (
        <Textarea className="min-h-[220px] w-full font-mono text-xs" value={scss} onChange={(e) => setScss(e.target.value)} spellCheck={false} />
      ) : null}
      {tab === 'js' ? <Textarea className="min-h-[220px] w-full font-mono text-xs" value={js} onChange={(e) => setJs(e.target.value)} spellCheck={false} /> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void saveSources()} disabled={saving || building}>
          Save source
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => void saveAndBuild()} disabled={saving || building}>
          {building ? 'Building…' : 'Save & rebuild preview'}
        </Button>
      </div>
    </div>
  );
}
