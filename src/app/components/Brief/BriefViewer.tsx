'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { handoffApiUrl } from '@/lib/api-path';
import { PlaygroundProvider, type PlaygroundPersistence } from '../Playground/PlaygroundContext';
import BriefPreview from './BriefPreview';
import type { PatternComponentEntry } from '@/lib/guest-editable';

/**
 * A brief and the pages built from it (see `docs/INVITE-TO-BUILD.md`, surfaces 2 and 3).
 *
 * One 30/70 shell with a swappable left panel, because these are two views of the same thing rather than two
 * screens: the brief with its built pages, and one built page with its notes and a verdict. Selecting a built
 * page swaps *both* panels — the preview shows their version, the sidebar shows what they said about it.
 *
 * No chat and no block list: this is a reading surface. The brief is frozen and a built page belongs to
 * someone else, so nothing here is editable by design.
 */

export interface BuiltPageRow {
  id: string;
  title: string;
  status: string;
  submittedByName: string | null;
  submittedAt: string | null;
  submittedMessage: string | null;
}

interface Props {
  brief: {
    id: string;
    title: string;
    version: number | null;
    description: string | null;
    instructions: string | null;
    sourcePageId: string | null;
  };
  built: BuiltPageRow[];
  basePath: string;
}

export default function BriefViewer({ brief, built, basePath }: Props) {
  const [rows, setRows] = useState(built);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, string>>({});

  const selected = rows.find((r) => r.id === selectedId) ?? null;
  /** Whichever record the preview should show: the brief, or the built page you picked. */
  const previewId = selectedId ?? brief.id;

  /**
   * Read-only hydration through the same adapter the guest editor uses.
   *
   * Keyed on `previewId`, so selecting a built page produces a *new* adapter and the provider re-hydrates —
   * which is how one preview pane serves both records without a second implementation. `persist` throws
   * because nothing here should ever write; if something tries, it should fail loudly rather than quietly
   * mutating a frozen brief or someone else's submission.
   */
  const persistence = useMemo<PlaygroundPersistence>(
    () => ({
      hydrate: async () => {
        const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(previewId)}`), {
          credentials: 'include',
        });
        const json = (await res.json()) as {
          pattern?: { components?: unknown; data?: unknown };
          error?: string;
        };
        if (!res.ok || !json.pattern) throw new Error(json.error || 'Could not load this page.');
        const components = (Array.isArray(json.pattern.components) ? json.pattern.components : []) as PatternComponentEntry[];
        const data = (json.pattern.data ?? {}) as { previews?: { default?: { values?: unknown } } };
        const values = Array.isArray(data.previews?.default?.values)
          ? (data.previews!.default!.values as Record<string, unknown>[])
          : [];
        return { components, values };
      },
      persist: async () => {
        throw new Error('This view is read-only.');
      },
    }),
    [previewId]
  );

  const decide = useCallback(
    async (decision: 'approve' | 'reject') => {
      if (!selectedId) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/review/${encodeURIComponent(selectedId)}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ decision, message: note.trim() || undefined }),
        });
        const json = (await res.json()) as { status?: string; error?: string };
        if (!res.ok) throw new Error(json.error || 'Could not record the decision.');
        const status = json.status ?? decision;
        setDecided((cur) => ({ ...cur, [selectedId]: status }));
        // Reflected in place rather than refetched: the row is still here, its status just moved.
        setRows((cur) => cur.map((r) => (r.id === selectedId ? { ...r, status } : r)));
        setNote('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not record the decision.');
      } finally {
        setBusy(false);
      }
    },
    [selectedId, note]
  );

  /**
   * Downloads come from the record, not from the rendered preview.
   *
   * JSON is the stored page; HTML is built by the same function the canvas uses, minus the editing controls,
   * so what you download is what the page is rather than what the editor looked like. PDF is on the roadmap —
   * it needs headless Chromium, which is a different order of dependency.
   */
  const download = async (format: 'json' | 'html') => {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(selectedId)}`), {
        credentials: 'include',
      });
      const json = (await res.json()) as { pattern?: Record<string, unknown>; error?: string };
      if (!res.ok || !json.pattern) throw new Error(json.error || 'Could not load the page.');

      let blob: Blob;
      let filename: string;
      if (format === 'json') {
        blob = new Blob([JSON.stringify(json.pattern, null, 2)], { type: 'application/json' });
        filename = `${selectedId}.json`;
      } else {
        const { constructComponentPreview } = await import('../Playground/Preview');
        const { hydrateForExport } = await import('./export-blocks');
        const hydrated = await hydrateForExport(json.pattern, basePath);
        const html = await constructComponentPreview(hydrated, basePath, { injectBlockControls: false });
        blob = new Blob([html], { type: 'text/html' });
        filename = `${selectedId}.html`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not prepare the download.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Invitation{brief.version ? ` v${brief.version}` : ''}
          </p>
          <h1 className="truncate text-base font-semibold">{brief.title || 'Untitled invitation'}</h1>
        </div>
        {brief.sourcePageId ? (
          <Button asChild variant="outline" size="sm">
            <a href={`${basePath}/playground/${encodeURIComponent(brief.sourcePageId)}`}>Back to the page</a>
          </Button>
        ) : null}
      </header>

      {error ? (
        <p
          role="alert"
          className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          {error}
        </p>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <aside className="w-[30%] min-w-[280px] shrink-0 overflow-y-auto border-r p-4">
          {selected ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setNote('');
                }}
                className="text-xs text-muted-foreground underline"
              >
                ← All built pages
              </button>

              <div>
                <h2 className="text-sm font-semibold">{selected.title || selected.id}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {/* Unverified, and said so — the session cannot vouch for who this is. */}
                  Built by <strong>{selected.submittedByName ?? 'someone'}</strong>{' '}
                  <span>(self-declared)</span>
                  {selected.submittedAt ? <> · {new Date(selected.submittedAt).toLocaleString()}</> : null}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Status: {decided[selected.id] ?? selected.status}</p>
              </div>

              {selected.submittedMessage ? (
                <blockquote className="border-l-2 pl-3 text-sm italic text-muted-foreground">
                  “{selected.submittedMessage}”
                </blockquote>
              ) : (
                <p className="text-sm text-muted-foreground">They left no note.</p>
              )}

              <div className="space-y-2 border-t pt-4">
                <label htmlFor="verdict-note" className="block text-sm font-medium">
                  Note to the author <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Textarea id="verdict-note" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
                {(decided[selected.id] ?? selected.status) === 'review' ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={busy} onClick={() => void decide('approve')}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => void decide('reject')}>
                      Send back
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Only a page awaiting review can be decided. This one is{' '}
                    {decided[selected.id] ?? selected.status}.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Approving doesn’t change who can see it — visibility stays separate.
                </p>
              </div>

              <div className="space-y-2 border-t pt-4">
                <p className="text-sm font-medium">Download</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void download('json')}>
                    JSON
                  </Button>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void download('html')}>
                    HTML
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">PDF is coming.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {brief.description ? <p className="text-sm text-muted-foreground">{brief.description}</p> : null}
              {brief.instructions ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Instructions given
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{brief.instructions}</p>
                </div>
              ) : null}

              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Built pages ({rows.length})
                </p>
                {rows.length === 0 ? (
                  /* Most invitations sit empty for a while — say so plainly rather than showing an empty box. */
                  <p className="mt-2 text-sm text-muted-foreground">
                    Nobody has built from this yet. When someone does, their page appears here.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {rows.map((row) => (
                      <li key={row.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(row.id)}
                          className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                        >
                          <span className="block truncate font-medium">
                            {row.submittedByName ?? (row.title || row.id)}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {row.submittedAt ? new Date(row.submittedAt).toLocaleDateString() : ''}
                            {' · '}
                            {decided[row.id] ?? row.status}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </aside>

        <main className="min-w-0 flex-1">
          {/* Re-keyed so switching records remounts the provider and re-hydrates cleanly. */}
          <PlaygroundProvider
            key={previewId}
            persistence={persistence}
            structuralEditing={false}
            aiAssistantEnabled={false}
          >
            <BriefPreview />
          </PlaygroundProvider>
        </main>
      </div>
    </div>
  );
}
