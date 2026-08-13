'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { handoffApiUrl } from '@/lib/api-path';

/**
 * The conversation on a page — owner and author, one thread (reflow R.4).
 *
 * **One component for both sides.** They are talking to each other, so two components would be two chances to
 * get "who wrote this" and "what may I do" wrong. The only visible difference is whether *Mark done* is offered,
 * and the server decides that regardless — this just avoids showing a control that would be refused.
 *
 * The server returns the whole thread after every write, so there is no local reconciliation and no optimistic
 * note left behind by a refusal.
 */

export interface PageNote {
  id: number;
  parentId: number | null;
  body: string;
  createdAt: string | null;
  resolvedAt: string | null;
  authorName: string;
  fromGuest: boolean;
}

export default function PageNotes({
  pageId,
  /** A guest's link id — how the server knows which anonymous author this is. Omitted for signed-in callers. */
  guestLinkId,
  canResolve = false,
}: {
  pageId: string;
  guestLinkId?: string | null;
  canResolve?: boolean;
}) {
  const [notes, setNotes] = useState<PageNote[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const url = useCallback(
    () =>
      handoffApiUrl(
        `/api/handoff/patterns/${encodeURIComponent(pageId)}/notes${
          guestLinkId ? `?link=${encodeURIComponent(guestLinkId)}` : ''
        }`
      ),
    [pageId, guestLinkId]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(url(), { credentials: 'include' });
        const json = (await res.json()) as { notes?: PageNote[] };
        if (!cancelled && res.ok) setNotes(json.notes ?? []);
      } catch {
        // A thread that will not load is not worth an error banner on a page you came here to look at.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as { notes?: PageNote[]; error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not save the note.');
      setNotes(json.notes ?? []);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the note.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!draft.trim()) return;
    if (await post({ body: draft, parentId: replyTo })) {
      setDraft('');
      setReplyTo(null);
    }
  };

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');
  const topLevel = notes.filter((n) => n.parentId == null);
  const repliesTo = (id: number) => notes.filter((n) => n.parentId === id);

  return (
    <section className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</p>

      {error ? (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
          {error}
        </p>
      ) : null}

      {topLevel.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet. Ask a question or leave a note — whoever else is on this page will see it.
        </p>
      ) : (
        <ul className="space-y-3">
          {topLevel.map((note) => (
            <li key={note.id} className={note.resolvedAt ? 'opacity-60' : undefined}>
              <NoteBody note={note} when={when} />

              {repliesTo(note.id).length ? (
                <ul className="mt-2 space-y-2 border-l pl-3">
                  {repliesTo(note.id).map((reply) => (
                    <li key={reply.id}>
                      <NoteBody note={reply} when={when} />
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-1 flex items-center gap-3">
                <button
                  type="button"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setReplyTo(replyTo === note.id ? null : note.id)}
                >
                  {replyTo === note.id ? 'Cancel reply' : 'Reply'}
                </button>
                {canResolve ? (
                  <button
                    type="button"
                    disabled={busy}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => void post({ noteId: note.id, resolved: !note.resolvedAt })}
                  >
                    {/* A toggle, not a delete: a resolved note is still part of what happened here. */}
                    {note.resolvedAt ? 'Reopen' : 'Mark done'}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        {replyTo != null ? <p className="text-xs text-muted-foreground">Replying to a note above.</p> : null}
        <Textarea
          rows={3}
          maxLength={4000}
          value={draft}
          placeholder="Add a note…"
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Add a note"
        />
        <Button size="sm" disabled={busy || !draft.trim()} onClick={() => void send()}>
          {busy ? 'Saving…' : replyTo != null ? 'Reply' : 'Add note'}
        </Button>
      </div>
    </section>
  );
}

function NoteBody({ note, when }: { note: PageNote; when: (iso: string | null) => string }) {
  return (
    <div className="rounded-md border p-2.5">
      <p className="text-xs text-muted-foreground">
        <strong className="text-foreground">{note.authorName}</strong>
        {/* Said out loud on a guest's note: the address was typed into a form and verified by nobody. */}
        {note.fromGuest && note.authorName.includes('@') ? ' (self-declared)' : ''}
        {note.createdAt ? ` · ${when(note.createdAt)}` : ''}
        {note.resolvedAt ? ' · done' : ''}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{note.body}</p>
    </div>
  );
}
