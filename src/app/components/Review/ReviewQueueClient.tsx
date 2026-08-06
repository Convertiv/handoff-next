'use client';

import { useCallback, useState } from 'react';
import { handoffApiUrl } from '@/lib/api-path';

/**
 * The review inbox — where guest submissions land (docs/GUEST-AUTHORING.md, Slice 2).
 *
 * Deliberately plain: the reviewer's job is to read what changed and decide, so the page leads with the
 * diff against the template rather than a preview of the whole page. A submission is usually a handful of
 * edited strings inside blocks that are otherwise identical to the template, and showing the blocks would
 * bury exactly the part being reviewed.
 */

interface QueueRow {
  id: string;
  title: string;
  status: string;
  blockCount: number;
  templateId: string | null;
  templateTitle: string | null;
  shareLinkToken: string | null;
  ownerName: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  submittedMessage: string | null;
}

interface Change {
  label: string;
  path: string;
  from: unknown;
  to: unknown;
  kind: 'text' | 'image';
}

interface Finding {
  label: string;
  severity: 'blocking' | 'advisory';
  code: string;
  message: string;
}

interface Detail {
  blocks: { componentId: string; index: number; changes: Change[] }[];
  changedCount: number;
  findings?: Finding[];
}

export default function ReviewQueueClient({ initialRows }: { initialRows: QueueRow[] }) {
  /**
   * Seeded from the server component, which is already maintainer-gated and can query the queue
   * directly — so there is no fetch-on-mount, no loading flash, and nothing setting state from an
   * effect. `load` remains for refreshing after a conflict, where it runs from an event handler.
   */
  const [rows, setRows] = useState<QueueRow[]>(initialRows);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, Detail>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  /** Refresh after a conflict. Leaves the current rows on screen rather than flashing a loading state. */
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/review'), { credentials: 'include', signal });
      const json = (await res.json()) as { submissions?: QueueRow[]; error?: string };
      if (signal?.aborted) return;
      if (!res.ok) throw new Error(json.error || 'Could not load the review queue.');
      setRows(json.submissions ?? []);
      setError(null);
    } catch (e) {
      // An abort is an unmount, not a failure to report.
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
      setError(e instanceof Error ? e.message : 'Could not load the review queue.');
    }
  }, []);

  const toggle = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (details[id]) return;
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/review/${encodeURIComponent(id)}`), {
        credentials: 'include',
      });
      const json = (await res.json()) as Detail & { error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not load the diff.');
      setDetails((cur) => ({ ...cur, [id]: json }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the diff.');
    }
  };

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id);
    setError(null);
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/review/${encodeURIComponent(id)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ decision, message: notes[id]?.trim() || undefined }),
      });
      const json = (await res.json()) as { status?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not record the decision.');
      setDone((cur) => ({ ...cur, [id]: json.status ?? decision }));
      // Drop it from the list rather than refetching: the row is no longer in `review`.
      setRows((cur) => cur.filter((r) => r.id !== id));
      setOpenId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the decision.');
      // A 409 means someone else already decided it, so the list is stale — reload it.
      void load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error ? (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {error}
        </p>
      ) : null}

      {Object.entries(done).map(([id, status]) => (
        <p key={id} className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {id} is now <strong>{status}</strong>
          {status === 'draft' ? ' — the author can edit it again and resubmit.' : '.'}
        </p>
      ))}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting for review.</p>
      ) : null}

      <ul className="space-y-3">
        {rows.map((row) => {
          const detail = details[row.id];
          const isOpen = openId === row.id;
          return (
            <li key={row.id} className="rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">{row.title || row.id}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {/* Named as unverified in the UI, not just the API: the session cannot vouch for who
                        this is, and a reviewer deciding on trust deserves to know that. */}
                    Submitted by <strong>{row.submittedByName ?? 'someone'}</strong>{' '}
                    <span className="text-muted-foreground">(self-declared, unverified)</span>
                    {row.templateTitle ? <> · from {row.templateTitle}</> : null}
                    {row.submittedAt ? <> · {new Date(row.submittedAt).toLocaleString()}</> : null}
                  </p>
                  {row.ownerName ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">Owned by {row.ownerName}</p>
                  ) : null}
                  {row.shareLinkToken ? (
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">via link {row.shareLinkToken}</p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => void toggle(row.id)}
                  className="shrink-0 rounded-md border px-3 py-1.5 text-sm"
                  aria-expanded={isOpen}
                >
                  {isOpen ? 'Hide changes' : 'Review changes'}
                </button>
              </div>

              {row.submittedMessage ? (
                <p className="mt-3 border-l-2 pl-3 text-sm italic text-muted-foreground">
                  “{row.submittedMessage}”
                </p>
              ) : null}

              {isOpen ? (
                <div className="mt-4 space-y-4 border-t pt-4">
                  {!detail ? (
                    <p className="text-sm text-muted-foreground" role="status">
                      Loading changes…
                    </p>
                  ) : detail.changedCount === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nothing differs from the template — the author submitted it unchanged.
                    </p>
                  ) : (
                    detail.blocks
                      .filter((b) => b.changes.length)
                      .map((block) => (
                        <div key={`${block.componentId}-${block.index}`}>
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {block.componentId}
                          </h3>
                          <ul className="mt-2 space-y-2">
                            {block.changes.map((c) => (
                              <li key={c.path} className="text-sm">
                                <span className="font-medium">{c.label}</span>
                                <div className="mt-1 space-y-1">
                                  <p className="text-muted-foreground line-through">{renderValue(c.from)}</p>
                                  <p>{renderValue(c.to)}</p>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))
                  )}

                  {detail?.findings?.length ? (
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Worth a look
                      </h3>
                      <ul className="mt-2 space-y-1">
                        {detail.findings.map((f, i) => (
                          <li key={`${f.code}-${i}`} className="text-sm text-muted-foreground">
                            <span className={f.severity === 'blocking' ? 'text-amber-700 dark:text-amber-400' : ''}>
                              {f.severity === 'blocking' ? '!' : '•'}
                            </span>{' '}
                            {f.message}
                          </li>
                        ))}
                      </ul>
                      {/* Advisory by design: these annotate the decision, they do not make it. */}
                      <p className="mt-1 text-xs text-muted-foreground">
                        These don’t block approval — they’re for you to weigh.
                      </p>
                    </div>
                  ) : null}

                  <div className="space-y-2">
                    <label htmlFor={`note-${row.id}`} className="block text-sm font-medium">
                      Note to the author <span className="font-normal text-muted-foreground">(optional)</span>
                    </label>
                    <textarea
                      id={`note-${row.id}`}
                      rows={2}
                      maxLength={1000}
                      value={notes[row.id] ?? ''}
                      onChange={(e) => setNotes((cur) => ({ ...cur, [row.id]: e.target.value }))}
                      className="w-full rounded-md border px-3 py-2 text-sm bg-background text-foreground"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={busy === row.id}
                        onClick={() => void decide(row.id, 'approve')}
                        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={busy === row.id}
                        onClick={() => void decide(row.id, 'reject')}
                        className="rounded-md border px-4 py-2 text-sm font-medium disabled:opacity-40"
                      >
                        Send back to author
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Approving does not change who can see the page — visibility stays a separate decision.
                    </p>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Images are shown as their src; everything else as text. Empty reads as "(empty)", not a blank line. */
function renderValue(value: unknown) {
  if (value == null || value === '') return <span className="italic">(empty)</span>;
  const str = String(value);
  if (/^(https?:|\/|data:)/i.test(str)) return <span className="break-all font-mono text-xs">{str}</span>;
  return str;
}
