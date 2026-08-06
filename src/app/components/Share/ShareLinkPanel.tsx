'use client';

import { useCallback, useState } from 'react';
import { handoffApiUrl } from '@/lib/api-path';
import {
  AUTHORING_CAPABILITIES,
  SHARE_CAPABILITY_META,
  type ShareCapability,
} from '@/lib/authz/vocab';

/**
 * Share links for one resource — the UI half of `docs/GUEST-AUTHORING.md` (roadmap E.1).
 *
 * Two kinds of link, deliberately presented as different things rather than as a checkbox:
 *
 * - **View only** — the long-standing read-only viewer link. Its token is stored in plaintext, so it can
 *   be shown again later.
 * - **Invite to build** — a write-capable link. Its secret is hashed at rest, which has a consequence the
 *   UI must be honest about: **it can never be shown again.** Copy it now or revoke and mint another.
 *   `secretRecoverable: false` on an existing link is exactly that state, and the panel says so rather
 *   than rendering an id that looks like a URL and 404s for whoever receives it.
 */

export interface ShareLinkSummary {
  id: string;
  label: string | null;
  capabilities: ShareCapability[];
  writeCapable: boolean;
  secretRecoverable: boolean;
  useCount: number;
  maxUses: number | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  submissionCount: number;
}

interface Props {
  resourceType: 'pattern' | 'design_artifact';
  resourceId: string;
  /** Absolute or base-path-prefixed origin for building the shareable URL. */
  basePath?: string;
}

type Mode = 'view' | 'authoring';

const DEFAULT_TTL_DAYS = 14;

export default function ShareLinkPanel({ resourceType, resourceId, basePath = '' }: Props) {
  const [links, setLinks] = useState<ShareLinkSummary[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('authoring');
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(DEFAULT_TTL_DAYS);
  const [maxUses, setMaxUses] = useState('');
  /** The one and only time a write-capable secret exists outside the recipient's URL bar. */
  const [minted, setMinted] = useState<{ url: string; writeCapable: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const query = `resourceType=${resourceType}&resourceId=${encodeURIComponent(resourceId)}`;

  const loadLinks = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/share/links?${query}`), { credentials: 'include' });
      const json = (await res.json()) as { links?: ShareLinkSummary[]; error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not load links.');
      setLinks(json.links ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load links.');
      setLinks([]);
    }
  }, [query]);

  const create = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const expiresAt = new Date(Date.now() + Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
      const parsedMax = maxUses.trim() ? Number(maxUses) : null;
      if (parsedMax != null && (!Number.isInteger(parsedMax) || parsedMax < 1)) {
        throw new Error('Max uses must be a whole number of 1 or more.');
      }

      const res = await fetch(handoffApiUrl('/api/handoff/share'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          resourceType,
          resourceId,
          expiresAt,
          label: label.trim() || undefined,
          maxUses: parsedMax,
          // Omitting `capabilities` keeps this endpoint's original read-only meaning, so "view" sends nothing.
          ...(mode === 'authoring' ? { capabilities: [...AUTHORING_CAPABILITIES] } : {}),
        }),
      });
      const json = (await res.json()) as { token?: string; capabilities?: ShareCapability[]; error?: string };
      if (!res.ok || !json.token) throw new Error(json.error || 'Could not create the link.');

      setMinted({ url: `${window.location.origin}${basePath}/s/${json.token}`, writeCapable: mode === 'authoring' });
      setLabel('');
      setMaxUses('');
      await loadLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/share?token=${encodeURIComponent(id)}`), {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || 'Could not revoke the link.');
      }
      // If the revoked link is the one just minted, stop offering its URL to copy.
      setMinted((cur) => (cur && cur.url.includes(id) ? null : cur));
      await loadLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke the link.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted.url);
      setCopied(true);
    } catch {
      setCopied(false);
      setError('Could not copy — select the link and copy it manually.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium">Share this {resourceType === 'pattern' ? 'page' : 'design'}</p>

        <div className="flex gap-2">
          {(['view', 'authoring'] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
              className={`rounded-md border px-3 py-1.5 text-sm ${mode === m ? 'border-foreground font-medium' : 'text-muted-foreground'}`}
            >
              {m === 'view' ? 'View only' : 'Invite to build'}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">
          {mode === 'view'
            ? 'Anyone with the link can look, and nothing else.'
            : 'Anyone with the link can build a page from this template and submit it for review — no account needed. They can use the existing asset library, and cannot generate images.'}
        </p>

        {mode === 'authoring' ? (
          <ul className="space-y-0.5 text-xs text-muted-foreground">
            {AUTHORING_CAPABILITIES.map((cap) => (
              <li key={cap}>• {SHARE_CAPABILITY_META[cap].desc}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-xs">
          <span className="block text-muted-foreground">Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Who is this for?"
            className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm bg-background text-foreground"
          />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Expires in (days)</span>
          <input
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm bg-background text-foreground"
          />
        </label>
        <label className="text-xs">
          <span className="block text-muted-foreground">Max uses (optional)</span>
          <input
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Unlimited"
            className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm bg-background text-foreground"
          />
        </label>
      </div>
      {mode === 'authoring' ? (
        <p className="text-xs text-muted-foreground">
          Max uses counts sessions, not people — a reload does not spend one.
        </p>
      ) : null}

      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-40"
      >
        {mode === 'view' ? 'Create view link' : 'Create build link'}
      </button>

      {error ? (
        <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {error}
        </p>
      ) : null}

      {minted ? (
        <div className="rounded-md border p-3">
          <p className="text-sm font-medium">Your link</p>
          {minted.writeCapable ? (
            <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
              Copy it now — this is the only time it can be shown. The secret is stored hashed, so it cannot
              be recovered later; if you lose it, revoke the link and create another.
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <input readOnly value={minted.url} onFocus={(e) => e.currentTarget.select()} className="flex-1 rounded-md border px-2 py-1.5 font-mono text-xs" />
            <button type="button" onClick={copy} className="rounded-md border px-3 py-1.5 text-sm">
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}

      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Active links</p>
          <button type="button" onClick={loadLinks} className="text-xs text-muted-foreground underline">
            {links === null ? 'Show' : 'Refresh'}
          </button>
        </div>

        {links === null ? (
          <p className="mt-1 text-xs text-muted-foreground">Not loaded.</p>
        ) : links.length === 0 ? (
          <p className="mt-1 text-xs text-muted-foreground">No active links.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {links.map((link) => (
              <li key={link.id} className="rounded-md border p-2 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {link.label || (link.writeCapable ? 'Build link' : 'View link')}{' '}
                      <span className="font-normal text-muted-foreground">
                        {link.writeCapable ? '· can build + submit' : '· view only'}
                      </span>
                    </p>
                    <p className="mt-0.5 font-mono text-muted-foreground">{link.id}</p>
                    <p className="mt-0.5 text-muted-foreground">
                      {link.useCount}
                      {link.maxUses ? `/${link.maxUses}` : ''} uses
                      {link.submissionCount ? ` · ${link.submissionCount} page(s) built` : ''}
                      {link.expiresAt ? ` · expires ${new Date(link.expiresAt).toLocaleDateString()}` : ''}
                    </p>
                    {!link.secretRecoverable ? (
                      <p className="mt-0.5 text-muted-foreground">
                        The full URL can’t be shown again — revoke and create a new one if it was lost.
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => revoke(link.id)}
                    disabled={busy}
                    className="shrink-0 rounded-md border px-2 py-1 disabled:opacity-40"
                  >
                    Revoke
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
