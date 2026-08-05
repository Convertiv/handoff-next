'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { handoffApiUrl } from '@/lib/api-path';
import {
  applyOverride,
  collectEditableText,
  collectImageSrcs,
  mergeBlockArgs,
  type EditableImage,
  type PatternComponentEntry,
} from '@/lib/guest-editable';
import type { ShareCapability } from '@/lib/authz/vocab';
import {
  blockingFindings,
  checkGuardrails,
  resolveFieldGuardrail,
  summarizeBlocking,
  type GuardrailConfig,
  type GuardrailFinding,
} from '@/lib/authoring-guardrails';

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
  const [components, setComponents] = useState<PatternComponentEntry[]>([]);
  const [values, setValues] = useState<Record<string, unknown>[]>([]);
  const [pageData, setPageData] = useState<Record<string, unknown>>({});
  /** Authored on the template and resolved server-side, so the editor and the submit check agree. */
  const [guardrails, setGuardrails] = useState<GuardrailConfig>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [submitMessage, setSubmitMessage] = useState('');

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest values, so a debounced save never sends a stale snapshot from its closure. */
  const latest = useRef<{ values: Record<string, unknown>[]; data: Record<string, unknown> }>({
    values: [],
    data: {},
  });

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
    await hydrate(link);
  };

  const hydrate = async (link: string) => {
    const res = await fetch(api(`/api/handoff/guest/submission?link=${encodeURIComponent(link)}`), {
      credentials: 'include',
    });
    const json = (await res.json()) as {
      submission?: {
        status: string;
        components?: unknown;
        data?: unknown;
      } | null;
      guardrails?: GuardrailConfig;
      error?: string;
    };
    if (!res.ok || !json.submission) throw new Error(json.error || 'Could not load the page.');

    const comps = Array.isArray(json.submission.components) ? (json.submission.components as PatternComponentEntry[]) : [];
    const data = (json.submission.data && typeof json.submission.data === 'object' ? json.submission.data : {}) as Record<
      string,
      unknown
    >;
    const previews = data.previews as { default?: { values?: unknown } } | undefined;
    const vals = Array.isArray(previews?.default?.values) ? (previews!.default!.values as Record<string, unknown>[]) : [];

    setComponents(comps);
    setValues(vals);
    setPageData(data);
    setGuardrails(json.guardrails ?? {});
    latest.current = { values: vals, data };
    setPhase(json.submission.status === 'draft' ? 'editing' : 'submitted');
  };

  /* ----------------------------------------------------------------- save -- */

  const persist = useCallback(
    async (link: string) => {
      setSaveState('saving');
      const { values: v, data } = latest.current;
      // The whole `data` object goes back with only `previews.default.values` replaced — anything else the
      // template carried there is preserved rather than silently dropped.
      const nextData = {
        ...data,
        previews: {
          ...((data.previews as Record<string, unknown>) ?? {}),
          default: { ...(((data.previews as { default?: Record<string, unknown> })?.default) ?? {}), values: v },
        },
      };
      try {
        const res = await fetch(api(`/api/handoff/guest/submission?link=${encodeURIComponent(link)}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ data: nextData }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error || 'Could not save.');
        }
        setPageData(nextData);
        latest.current = { values: v, data: nextData };
        setSaveState('saved');
      } catch (e) {
        setSaveState('failed');
        setError(e instanceof Error ? e.message : 'Could not save.');
      }
    },
    [api]
  );

  const queueSave = useCallback(
    (link: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void persist(link), SAVE_DEBOUNCE_MS);
    },
    [persist]
  );

  // A pending edit must not be lost to a debounce that never fires.
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const edit = (index: number, path: (string | number)[], value: unknown) => {
    setValues((cur) => {
      const next = [...cur];
      while (next.length <= index) next.push({});
      next[index] = applyOverride(components[index], next[index], path, value);
      latest.current = { ...latest.current, values: next };
      return next;
    });
    setSaveState('idle');
    if (linkId) queueSave(linkId);
  };

  /* --------------------------------------------------------------- submit -- */

  const submit = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setPhase('working');
    setError(null);
    try {
      // Flush first: submitting locks the page, so an unsaved edit would be lost for good.
      await persist(linkId);
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
  const findings = useMemo(
    () => checkGuardrails(components, values, guardrails),
    [components, values, guardrails]
  );
  const blocking = useMemo(() => blockingFindings(findings), [findings]);
  const blockingByPath = useMemo(() => {
    const map = new Map<string, GuardrailFinding[]>();
    for (const f of findings) {
      const key = `${f.blockIndex}:${f.path ?? ''}`;
      map.set(key, [...(map.get(key) ?? []), f]);
    }
    return map;
  }, [findings]);

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
          <SaveIndicator state={saveState} />
        </div>

        {notice ? <p className="text-sm text-slate-500">{notice}</p> : null}
        {error ? <Alert>{error}</Alert> : null}

        {components.length === 0 ? (
          <p className="text-sm text-slate-500">This template has no blocks to edit.</p>
        ) : null}

        {components.map((entry, index) => (
          <BlockEditor
            key={`${entry.id}-${index}`}
            entry={entry}
            index={index}
            override={values[index] ?? {}}
            onEdit={edit}
            linkId={linkId}
            canUseAssets={canUseAssets}
            guardrails={guardrails}
            findingsFor={(path) => blockingByPath.get(`${index}:${path}`) ?? []}
          />
        ))}

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
            <>
              {blocking.length ? (
                <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {summarizeBlocking(findings)}
                </p>
              ) : null}
              <button
                type="button"
                onClick={submit}
                disabled={blocking.length > 0}
                /* Disabled *and* explained: the server refuses these too, so letting the click through
                   would only trade a clear message for a round trip and an error. */
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Submit for review
              </button>
            </>
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

/* ------------------------------------------------------------- one block -- */

function BlockEditor({
  entry,
  index,
  override,
  onEdit,
  linkId,
  canUseAssets,
  guardrails,
  findingsFor,
}: {
  entry: PatternComponentEntry;
  index: number;
  override: Record<string, unknown>;
  onEdit: (index: number, path: (string | number)[], value: unknown) => void;
  linkId: string;
  canUseAssets: boolean;
  guardrails: GuardrailConfig;
  findingsFor: (path: string) => GuardrailFinding[];
}) {
  const merged = useMemo(() => mergeBlockArgs(entry, override), [entry, override]);
  const texts = useMemo(() => collectEditableText(merged), [merged]);
  const images = useMemo(() => collectImageSrcs(merged), [merged]);

  if (!texts.length && !images.length) return null;

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h2 className="text-sm font-semibold text-slate-900">{entry.id}</h2>

      <div className="mt-3 space-y-3">
        {texts.map((field) => {
          const id = `f-${index}-${field.path.join('-')}`;
          const path = field.path.join('.');
          const multiline = field.value.length > 90;
          const rule = resolveFieldGuardrail(guardrails, path);
          const issues = findingsFor(path);
          const over = rule.maxLength ? field.value.length > rule.maxLength : false;
          return (
            <div key={id}>
              <label htmlFor={id} className="flex items-baseline justify-between text-sm font-medium text-slate-800">
                <span>
                  {field.label}
                  {rule.required ? <span className="text-amber-700"> *</span> : null}
                </span>
                <span className={`text-xs font-normal ${over ? 'text-amber-700' : 'text-slate-400'}`}>
                  {rule.maxLength ? `${field.value.length}/${rule.maxLength}` : field.value.length}
                </span>
              </label>
              {rule.help ? <p className="mt-0.5 text-xs text-slate-500">{rule.help}</p> : null}
              {multiline ? (
                <textarea
                  id={id}
                  value={field.value}
                  rows={3}
                  onChange={(e) => onEdit(index, field.path, e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              ) : (
                <input
                  id={id}
                  value={field.value}
                  onChange={(e) => onEdit(index, field.path, e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                />
              )}
              {/* No `maxLength` on the input: silently truncating pasted copy loses text without saying
                  so. The count turns amber, the message says what to do, and submit stays blocked. */}
              {issues.map((issue) => (
                <p
                  key={issue.code}
                  className={`mt-1 text-xs ${issue.severity === 'blocking' ? 'text-amber-700' : 'text-slate-500'}`}
                >
                  {issue.message}
                </p>
              ))}
            </div>
          );
        })}

        {images.map((image) => (
          <ImageSlot
            key={image.path.join('-')}
            image={image}
            onPick={(asset) => {
              onEdit(index, image.path, asset.storageUrl);
              /**
               * Alt text follows the image when the slot has a sibling `alt` and the asset carries one.
               * A swapped image that keeps the previous alt describes the wrong picture, which is worse
               * than an empty alt.
               */
              const last = image.path[image.path.length - 1];
              if (last === 'src' && asset.altText) {
                onEdit(index, [...image.path.slice(0, -1), 'alt'], asset.altText);
              }
            }}
            linkId={linkId}
            canUseAssets={canUseAssets}
          />
        ))}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- one image -- */

function ImageSlot({
  image,
  onPick,
  linkId,
  canUseAssets,
}: {
  image: EditableImage;
  onPick: (asset: AssetOption) => void;
  linkId: string;
  canUseAssets: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(
    async (query: string) => {
      setLoading(true);
      setFailed(null);
      try {
        const url = handoffApiUrl(
          `/api/handoff/guest/assets?link=${encodeURIComponent(linkId)}${query ? `&search=${encodeURIComponent(query)}` : ''}`
        );
        const res = await fetch(url, { credentials: 'include' });
        const json = (await res.json()) as { assets?: AssetOption[]; error?: string };
        if (!res.ok) throw new Error(json.error || 'Could not load the asset library.');
        setAssets(json.assets ?? []);
      } catch (e) {
        setFailed(e instanceof Error ? e.message : 'Could not load the asset library.');
      } finally {
        setLoading(false);
      }
    },
    [linkId]
  );

  /**
   * Loaded from the click that opens the picker rather than from an effect on `open`: the fetch is a
   * response to an interaction, not state synchronization, and doing it here means no setState from an
   * effect body. Typing does not refetch — the form below submits to search.
   */
  const toggleOpen = () => {
    const next = !open;
    setOpen(next);
    if (next && !assets.length) void load(search);
  };

  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image.src} alt="" className="h-16 w-24 rounded object-cover ring-1 ring-slate-200" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-800">{image.label}</p>
          <p className="truncate text-xs text-slate-400">
            {image.width && image.height ? `${image.width}×${image.height}` : 'Image'}
          </p>
        </div>
        {canUseAssets ? (
          <button
            type="button"
            onClick={toggleOpen}
            className="shrink-0 rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-800"
          >
            {open ? 'Close' : 'Change'}
          </button>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 border-t border-slate-200 pt-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load(search);
            }}
            className="flex gap-2"
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the library"
              aria-label="Search the asset library"
              className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-sm focus:border-slate-500 focus:outline-none"
            />
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
              Search
            </button>
          </form>

          {failed ? <Alert>{failed}</Alert> : null}
          {loading ? (
            <p className="mt-3 text-sm text-slate-500" role="status">
              Loading…
            </p>
          ) : null}

          {!loading && !failed && assets.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nothing in the library matches.</p>
          ) : null}

          <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {assets.map((asset) => (
              <li key={asset.id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(asset);
                    setOpen(false);
                  }}
                  className="block w-full text-left"
                  title={asset.title}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={asset.storageUrl}
                    alt={asset.altText ?? asset.title}
                    className="h-20 w-full rounded object-cover ring-1 ring-slate-200 hover:ring-slate-500"
                  />
                  <span className="mt-1 block truncate text-xs text-slate-600">{asset.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
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

function SaveIndicator({ state }: { state: 'idle' | 'saving' | 'saved' | 'failed' }) {
  const label =
    state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'failed' ? 'Not saved' : 'Draft';
  return (
    <span
      aria-live="polite"
      className={`text-xs ${state === 'failed' ? 'text-amber-700' : 'text-slate-400'}`}
    >
      {label}
    </span>
  );
}
