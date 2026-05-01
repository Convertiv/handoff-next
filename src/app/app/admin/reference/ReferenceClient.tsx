'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import Layout from '../../../components/Layout/Main';
import { handoffApiUrl } from '../../../lib/api-path';
import { Button } from '../../../components/ui/button';
import { REFERENCE_MATERIAL_IDS } from '../../../lib/server/reference-material-ids';

type Row = { id: string; contentLength: number; generatedAt: string | null; metadata: unknown };

export default function ReferenceClient({
  config,
  menu,
  message,
}: {
  config: unknown;
  menu: unknown;
  message?: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedContent, setExpandedContent] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/admin/reference-materials'), { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as { materials?: Row[]; error?: string };
      if (res.ok && Array.isArray(json.materials)) setRows(json.materials);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const regenerate = async (id: string | 'all') => {
    setBusy(id);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/admin/reference-materials'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id === 'all' ? { all: true } : { id }),
      });
      if (res.ok) await load();
    } finally {
      setBusy(null);
    }
  };

  const toggleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (expandedContent[id]) return;
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/admin/reference-materials?id=${encodeURIComponent(id)}`), {
        credentials: 'include',
      });
      const json = (await res.json().catch(() => ({}))) as { material?: { content?: string } };
      const c = json.material?.content ?? '';
      setExpandedContent((prev) => ({ ...prev, [id]: c }));
    } catch {
      setExpandedContent((prev) => ({ ...prev, [id]: '(failed to load)' }));
    }
  };

  const layoutMeta = { metaTitle: 'Reference materials', metaDescription: 'LLM context generated from catalog and tokens' };

  const knownIds = new Set(rows.map((r) => r.id));
  const displayIds = [...REFERENCE_MATERIAL_IDS];

  return (
    <Layout config={config as never} menu={menu as never} current={null} metadata={layoutMeta}>
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Reference materials</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Auto-generated markdown used as context for design-to-component and other AI flows. Regenerate after large catalog changes or Figma
            fetch.
          </p>
        </div>
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!!busy} onClick={() => void regenerate('all')}>
            {busy === 'all' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Regenerate all
          </Button>
        </div>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <ul className="space-y-3">
            {displayIds.map((id) => {
              const row = rows.find((r) => r.id === id);
              return (
                <li key={id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-sm font-medium">{id}</p>
                      <p className="text-xs text-muted-foreground">
                        {row ? (
                          <>
                            {row.contentLength.toLocaleString()} chars · generated {row.generatedAt ? new Date(row.generatedAt).toLocaleString() : '—'}
                          </>
                        ) : (
                          <span>Not generated yet</span>
                        )}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" disabled={!!busy} onClick={() => void toggleExpand(id)}>
                        {expanded === id ? 'Collapse' : 'Preview'}
                      </Button>
                      <Button type="button" size="sm" disabled={!!busy} onClick={() => void regenerate(id)}>
                        {busy === id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Regenerate'}
                      </Button>
                    </div>
                  </div>
                  {expanded === id ? (
                    <pre className="mt-3 max-h-[50vh] overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
                      {expandedContent[id] ?? (knownIds.has(id) ? 'Loading…' : '_(empty — run Regenerate)_')}
                    </pre>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Layout>
  );
}
