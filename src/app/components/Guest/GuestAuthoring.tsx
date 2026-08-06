'use client';

import { useCallback, useState } from 'react';
import { handoffApiUrl } from '@/lib/api-path';
import GuestEditor from './GuestEditor';
import type { ShareCapability } from '@/lib/authz/vocab';

/**
 * Guest authoring surface for a shared template — the browser half of `docs/GUEST-AUTHORING.md`.
 *
 * Standalone on purpose: no app nav, no session, no owner ids. The link in the URL is the credential
 * until `/enter` exchanges it for a signed session cookie; every call after that carries only the link
 * id, and the server reads the submission id from the cookie rather than from anything here.
 *
 * Fields are derived from the block's **real values** (`collectEditableText` / `collectImageSrcs`), not
 * from field descriptors, which are unreliable about shape. Edits accumulate in the override layer via
 * `applyOverride`, so the template stays pristine and the review diff is readable.
 */

type Capabilities = readonly ShareCapability[];

interface AssetOption {
  id: string;
  title: string;
  storageUrl: string;
  altText: string | null;
  width: number | null;
  height: number | null;
}

interface Props {
  /** The full URL token, `<id>.<secret>` for a write-capable link. */
  token: string;
  templateTitle: string;
  templateDescription?: string | null;
}

type Phase = 'name' | 'working' | 'editing' | 'submitted';

/** Autosave delay. Long enough not to PATCH on every keystroke, short enough to survive a closed tab. */
const SAVE_DEBOUNCE_MS = 1200;

export default function GuestAuthoring({ token, templateTitle, templateDescription }: Props) {
  const [phase, setPhase] = useState<Phase>('name');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [linkId, setLinkId] = useState('');
  const [capabilities, setCapabilities] = useState<Capabilities>([]);
  const [submitMessage, setSubmitMessage] = useState('');


  const api = useCallback((path: string) => handoffApiUrl(path), []);

  /* ---------------------------------------------------------------- entry -- */

  const enter = async (evt: React.FormEvent) => {
    evt.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    setPhase('working');
    setError(null);

    try {
      const res = await fetch(api('/api/handoff/guest/enter'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token, name: trimmed }),
      });
      const json = (await res.json()) as {
        linkId?: string;
        capabilities?: Capabilities;
        submissionId?: string | null;
        resumed?: boolean;
        error?: string;
      };
      if (!res.ok || !json.linkId) throw new Error(json.error || 'This link is no longer available.');

      setLinkId(json.linkId);
      setCapabilities(json.capabilities ?? []);
      if (json.resumed && json.submissionId) setNotice('Picked up where you left off.');
      await ensureSubmission(json.linkId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this link.');
      setPhase('name');
    }
  };

  /** Create the draft if this session has none, then load whichever draft it now owns. */
  const ensureSubmission = async (link: string) => {
    const created = await fetch(api(`/api/handoff/guest/submission?link=${encodeURIComponent(link)}`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({}),
    });
    const createdJson = (await created.json()) as { id?: string; error?: string };
    if (!created.ok) throw new Error(createdJson.error || 'Could not start the page.');
    await readPhase(link);
  };

  /**
   * Only the phase, not the canvas.
   *
   * `GuestEditor` hydrates the blocks through the persistence adapter, so loading them here too would be a
   * second source of truth for the same record. All this component needs to know is whether the submission is
   * still a draft (editable) or already in the queue.
   */
  const readPhase = async (link: string) => {
    const res = await fetch(api(`/api/handoff/guest/submission?link=${encodeURIComponent(link)}`), {
      credentials: 'include',
    });
    const json = (await res.json()) as { submission?: { status: string } | null; error?: string };
    if (!res.ok || !json.submission) throw new Error(json.error || 'Could not load the page.');
    setPhase(json.submission.status === 'draft' ? 'editing' : 'submitted');
  };

  /* ----------------------------------------------------------------- save -- */

  /**
   * No canvas persistence here any more (roadmap E.5). `GuestEditor` owns hydration and autosave through the
   * injected adapter, and **two savers on one submission would clobber each other** — this component's copy
   * would keep writing the values it loaded at entry, undoing whatever the editor had since saved.
   *
   * What remains is the session and the submit decision, which is guest-specific and correct here.
   */
  const submit = async () => {
    setPhase('working');
    setError(null);
    try {
      /**
       * No flush needed: `GuestEditor` autosaves through the adapter, so the record is already current. If a
       * save is still in flight the server refuses nothing — the last write wins and the guardrail check runs
       * against whatever is stored.
       */
      const res = await fetch(
        api(`/api/handoff/guest/submission/submit?link=${encodeURIComponent(linkId)}`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ message: submitMessage.trim() || undefined }),
        }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not submit.');
      setPhase('submitted');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit.');
      setPhase('editing');
    }
  };

  const startAnother = async () => {
    setPhase('working');
    setError(null);
    setSubmitMessage('');
    try {
      // The server creates a fresh page when the session's own one is no longer a draft.
      await ensureSubmission(linkId);
      setNotice('Started a new page.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start another page.');
      setPhase('submitted');
    }
  };

  /**
   * The same check the server runs at submit, over the same merged values — so what the editor shows and
   * what the server enforces cannot disagree. Advisory findings are surfaced but never block.
   */
  const canSubmit = capabilities.includes('submit_for_review');
  const canUseAssets = capabilities.includes('use_asset_library');

  /* ------------------------------------------------------------------ ui -- */

  if (phase === 'name') {
    return (
      <Shell title={templateTitle} subtitle={templateDescription}>
        <form onSubmit={enter} className="mx-auto max-w-md space-y-4">
          <div>
            <label htmlFor="guest-name" className="block text-sm font-medium text-slate-800">
              Your name
            </label>
            <p className="mt-1 text-sm text-slate-500">
              So the reviewers know who built the page. No account needed.
            </p>
            <input
              id="guest-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={80}
              required
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
            />
          </div>
          {error ? <Alert>{error}</Alert> : null}
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            Start building
          </button>
        </form>
      </Shell>
    );
  }

  if (phase === 'working') {
    return (
      <Shell title={templateTitle}>
        <p className="text-center text-sm text-slate-500" role="status">
          Working…
        </p>
      </Shell>
    );
  }

  if (phase === 'submitted') {
    return (
      <Shell title={templateTitle}>
        <div className="mx-auto max-w-md space-y-4 text-center">
          <p className="text-sm text-slate-700">
            Sent for review. {name.trim() || 'You'} submitted this page — a reviewer will pick it up from here.
          </p>
          <p className="text-sm text-slate-500">It can’t be edited now that it’s in the queue.</p>
          {error ? <Alert>{error}</Alert> : null}
          <button
            type="button"
            onClick={startAnother}
            className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800"
          >
            Build another page
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={templateTitle} subtitle={templateDescription}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
          <p className="text-sm text-slate-500">
            Editing as <span className="font-medium text-slate-800">{name}</span>
          </p>
          {/* The editor shows its own save state in its toolbar — one indicator, not two disagreeing. */}
        </div>

        {notice ? <p className="text-sm text-slate-500">{notice}</p> : null}
        {error ? <Alert>{error}</Alert> : null}

        {/**
          * The real editor (roadmap E.5) — same block editing and same live preview an internal user gets,
          * with structural editing switched off. It replaced a hand-rolled field list that had no preview:
          * "we've already built an editor, we should reuse."
          */}
        <div className="-mx-4 h-[70vh] overflow-hidden rounded-lg border border-slate-200 sm:mx-0">
          <GuestEditor linkId={linkId} />
        </div>

        <div className="space-y-3 border-t border-slate-200 pt-4">
          <label htmlFor="submit-note" className="block text-sm font-medium text-slate-800">
            Note for the reviewer <span className="font-normal text-slate-500">(optional)</span>
          </label>
          <textarea
            id="submit-note"
            value={submitMessage}
            onChange={(e) => setSubmitMessage(e.target.value)}
            rows={3}
            maxLength={1000}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
          {canSubmit ? (
            /**
             * The button is no longer pre-disabled by guardrails: the canvas lives in the editor now, so this
             * component cannot evaluate them. `submitGuestSubmission` refuses a submission that breaks them and
             * returns the reason, which surfaces in `error` above. Showing per-field limits inside the shared
             * block editor is the follow-up (see E.4) — it is a regression in *hinting*, not in enforcement.
             */
            <button
              type="button"
              onClick={submit}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Submit for review
            </button>
          ) : (
            <p className="text-sm text-slate-500">
              This link doesn’t include submitting — your work is saved and the owner can pick it up.
            </p>
          )}
        </div>
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------------ bits -- */

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string | null;
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-slate-400">Shared via Handoff</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </header>
      {children}
    </main>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {children}
    </p>
  );
}
