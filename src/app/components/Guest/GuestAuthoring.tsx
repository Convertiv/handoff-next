'use client';

import { useCallback, useState } from 'react';
import { handoffApiUrl } from '@/lib/api-path';
import GuestEditor from './GuestEditor';
import { FindingsList, type RenderableFinding } from '../Playground/FindingsList';
import { requestFieldReveal } from '../Playground/FieldLinkContext';
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
  /** The brief's instructions to the builder, written in the invite wizard. */
  instructions?: string | null;
}

type Phase = 'name' | 'working' | 'editing' | 'submitted';

/** Autosave delay. Long enough not to PATCH on every keystroke, short enough to survive a closed tab. */
const SAVE_DEBOUNCE_MS = 1200;

export default function GuestAuthoring({ token, templateTitle, templateDescription, instructions }: Props) {
  const [phase, setPhase] = useState<Phase>('name');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [passphrase, setPassphrase] = useState('');
  /** Set when the server says this invitation is passphrase-protected, so the field only appears if needed. */
  const [passphraseRequired, setPassphraseRequired] = useState(false);
  const [linkId, setLinkId] = useState('');
  const [capabilities, setCapabilities] = useState<Capabilities>([]);
  const [submitMessage, setSubmitMessage] = useState('');
  /**
   * The link back to the page they just made — shown once, because only its hash is stored.
   *
   * On screen as well as in the email on purpose: the address was typed into a form and verified by nobody, so
   * relying on delivery alone would mean a typo costs someone their page.
   */
  const [returnUrl, setReturnUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  // Open by default: the instructions are the reason they are here, so they should not have to go looking.
  const [instructionsOpen, setInstructionsOpen] = useState(true);


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
        body: JSON.stringify({
          token,
          name: trimmed,
          email: email.trim() || undefined,
          passphrase: passphrase.trim() || undefined,
        }),
      });
      const json = (await res.json()) as {
        linkId?: string;
        capabilities?: Capabilities;
        submissionId?: string | null;
        resumed?: boolean;
        passphraseRequired?: boolean;
        error?: string;
      };
      if (!res.ok || !json.linkId) {
        /**
         * A passphrase challenge is not a dead end: reveal the field and let them try. Kept distinct from
         * "wrong passphrase" so a first-time visitor is asked rather than accused.
         */
        if (json.passphraseRequired) setPassphraseRequired(true);
        throw new Error(json.error || 'This link is no longer available.');
      }

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
  /** Blocking findings from the last refused submission, shown beneath the error (roadmap E.11). */
  const [findings, setFindings] = useState<RenderableFinding[]>([]);

  const submit = async () => {
    setPhase('working');
    setError(null);
    setFindings([]);
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
      const json = (await res.json()) as {
        error?: string;
        findings?: RenderableFinding[];
        /** The author's way back — returned once, never recoverable afterwards (reflow R.3). */
        returnUrlToken?: string | null;
      };
      if (!res.ok) {
        /**
         * A 422 means the content did not pass and the server said exactly why (roadmap E.11). Keeping the
         * findings is the whole point: before this the guest got "Could not submit the page." and the reasons
         * lived in a Vercel log, which is a dead end for the one person who can actually fix them.
         */
        setFindings(Array.isArray(json.findings) ? json.findings : []);
        throw new Error(json.error || 'Could not submit.');
      }
      setFindings([]);
      setReturnUrl(json.returnUrlToken ? `${window.location.origin}/s/${json.returnUrlToken}` : null);
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
            <label htmlFor="guest-name" className="block text-sm font-medium text-foreground">
              Your name
            </label>
            <p className="mt-1 text-sm text-muted-foreground">
              So the reviewers know who built the page. No account needed.
            </p>
            <input
              id="guest-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={80}
              required
              className="mt-2 w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none bg-background text-foreground"
            />
          </div>
          <div>
            <label htmlFor="guest-email" className="block text-sm font-medium text-foreground">
              Your email <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            {/* Disclosure at the point of collection, not in a policy page — we are about to email them. */}
            <p className="mt-1 text-sm text-muted-foreground">
              We’ll use it to tell you what happens to your page — when it’s received, reviewed, or published.
              Nothing else.
            </p>
            <input
              id="guest-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              maxLength={200}
              className="mt-2 w-full rounded-md border border-input px-3 py-2 text-sm focus:border-ring focus:outline-none bg-background text-foreground"
            />
          </div>

          {passphraseRequired ? (
            <div>
              <label htmlFor="guest-passphrase" className="block text-sm font-medium text-foreground">
                Passphrase
              </label>
              <p className="mt-1 text-sm text-muted-foreground">
                Four words, sent to you with this link. Capitals and spaces don’t matter.
              </p>
              <input
                id="guest-passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                required
                className="mt-2 w-full rounded-md border border-input px-3 py-2 font-mono text-sm focus:border-ring focus:outline-none bg-background text-foreground"
              />
            </div>
          ) : null}

          {error ? <Alert>{error}</Alert> : null}
          <button
            type="submit"
            disabled={!name.trim() || (passphraseRequired && !passphrase.trim())}
            className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
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
        <p className="text-center text-sm text-muted-foreground" role="status">
          Working…
        </p>
      </Shell>
    );
  }

  if (phase === 'submitted') {
    return (
      <Shell title={templateTitle}>
        <div className="mx-auto max-w-md space-y-4 text-center">
          <p className="text-sm text-foreground">
            Sent for review. {name.trim() || 'You'} submitted this page — a reviewer will pick it up from here.
          </p>

          {/**
            * The return link, shown before anything else they might do (reflow R.3).
            *
            * Centre of the screen rather than a footnote: this is the only moment the secret exists outside an
            * email nobody has verified can arrive, and a person who scrolls past it has lost their page. It
            * says what the link *is*, because a recipient who does not know it is a key cannot be careful with
            * it — and forwarding a thread is the ordinary way these leak.
            */}
          {returnUrl ? (
            <div className="space-y-2 rounded-md border p-3 text-left">
              <p className="text-sm font-medium text-foreground">Your link back to this page</p>
              <p className="text-xs text-muted-foreground">
                Keep it — it’s the only way back, and anyone who has it can edit your page. We’ve emailed it to
                you as well.
              </p>
              <input
                readOnly
                value={returnUrl}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="Your link back to this page"
                className="w-full rounded border bg-background px-2 py-1 font-mono text-xs text-foreground"
              />
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(returnUrl)
                    .then(() => setCopied(true))
                    .catch(() => setError('Could not copy — select the link and copy it manually.'));
                }}
                className="rounded-md border border-input px-3 py-1.5 text-xs font-medium text-foreground"
              >
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              You can come back to this page through the link we emailed you.
            </p>
          )}

          <p className="text-sm text-muted-foreground">
            You can keep editing it until a reviewer makes a decision.
          </p>
          {error ? <Alert>{error}</Alert> : null}
          <button
            type="button"
            onClick={startAnother}
            className="rounded-md border border-input px-4 py-2 text-sm font-medium text-foreground"
          >
            Build another page
          </button>
        </div>
      </Shell>
    );
  }

  /**
   * The building surface: **full viewport**, not a column in a page (roadmap E.6 step 4).
   *
   * The editor takes all the room it can get — it is a 30/70 canvas, and squeezing it into a narrow document
   * shell was the reason it felt like a form with a picture next to it. Identity and the one action that ends
   * the session live in a sticky footer instead, so they are reachable without scrolling past the canvas.
   */
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">You were invited to build</p>
          <h1 className="truncate text-sm font-semibold">{templateTitle}</h1>
        </div>
        {instructions ? (
          <button
            type="button"
            onClick={() => setInstructionsOpen((v) => !v)}
            className="rounded-md border px-3 py-1.5 text-xs"
            aria-expanded={instructionsOpen}
          >
            {instructionsOpen ? 'Hide instructions' : 'Instructions'}
          </button>
        ) : null}
      </header>

      {/**
        * The brief's instructions, shown to the person doing the work. They were collected in the wizard and
        * stored on the brief, and until now nothing displayed them — which made the whole first step of the
        * wizard write-only.
        */}
      {instructions && instructionsOpen ? (
        <div className="shrink-0 border-b bg-muted/40 px-4 py-3">
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">{instructions}</p>
        </div>
      ) : null}

      {notice ? <p className="shrink-0 border-b px-4 py-2 text-sm text-muted-foreground">{notice}</p> : null}
      {error ? (
        <div role="alert" className="shrink-0 border-b bg-amber-50 px-4 py-2 dark:bg-amber-950/40">
          <p className="text-sm text-amber-900 dark:text-amber-200">{error}</p>
          {/* The specifics, so "8 things need fixing" is a list rather than a count. */}
          {findings.length ? (
            <div className="mt-2">
              {/* Clicking a finding selects its block and highlights the field — the builder satisfies this. */}
              <FindingsList findings={findings} onSelect={requestFieldReveal} />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* The real editor (roadmap E.5), given the whole remaining height. */}
      <div className="min-h-0 flex-1">
        <GuestEditor linkId={linkId} />
      </div>

      {/**
        * Submitting is deliberately a two-step: the note is **required**, so it opens as a panel rather than
        * riding along as an optional field nobody fills in. Client-side enforcement is enough for now (Brad,
        * 2026-08-05) — the value is prompting the thought, not proving it happened.
        */}
      {submitOpen ? (
        <div className="shrink-0 border-t bg-muted/30 px-4 py-3">
          <label htmlFor="submit-note" className="block text-sm font-medium">
            What should the reviewer know? <span className="text-amber-700 dark:text-amber-400">*</span>
          </label>
          <textarea
            id="submit-note"
            autoFocus
            value={submitMessage}
            onChange={(e) => setSubmitMessage(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="What you changed, and anything you want them to look at."
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!submitMessage.trim()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-40"
            >
              Send for review
            </button>
            <button type="button" onClick={() => setSubmitOpen(false)} className="px-3 py-2 text-sm text-muted-foreground">
              Cancel
            </button>
            <span className="text-xs text-muted-foreground">
              Once sent, this page is locked while it is reviewed.
            </span>
          </div>
        </div>
      ) : null}

      <footer className="sticky bottom-0 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t bg-background px-4 py-2">
        <p className="truncate text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{templateTitle}</span> · Editing as{' '}
          <span className="font-medium text-foreground">{name}</span>
        </p>
        {canSubmit ? (
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            disabled={submitOpen}
            className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
          >
            Submit for review
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">
            This link doesn’t include submitting — your work is saved and the owner can pick it up.
          </p>
        )}
      </footer>
    </div>
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
    /**
     * `min-h-screen` + an explicit surface: this is a **standalone** page with no app chrome around it, so
     * nothing else paints the background. Without it the guest page kept a white canvas in dark mode while the
     * text switched — which is the version Brad saw.
     */
    <main className="mx-auto min-h-screen max-w-3xl bg-background px-4 py-10 text-foreground">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Shared via Handoff</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
      </header>
      {children}
    </main>
  );
}

function Alert({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      {children}
    </p>
  );
}
