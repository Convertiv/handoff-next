'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { listTemplateLinks, revokeTemplateLink, shareTemplate } from '@/app/actions/patterns';
import { handoffApiUrl } from '@/lib/api-path';
import { MAX_PAGES_PER_SHARE_LINK, patternKind } from '@/lib/authz/vocab';

/**
 * Share a template — the reflow's replacement for `InviteWizard` (R.2).
 *
 * **Three steps became one.** The old wizard's first two steps existed because sharing produced a *brief*: an
 * object that needed a name, a description, a version and a life of its own. There is no such object now. You
 * are handing someone a link to a template that already exists, so the screen asks the two questions that are
 * actually about the link — how long, and passphrase or not — and gets out of the way.
 *
 * **Instructions and limits stayed, but moved.** They were arguments to "create an invitation", which made them
 * feel like properties of a link and meant changing your mind required cutting a new brief. They are properties
 * of the **template**, written to it here and editable afterwards without touching the link.
 *
 * **"Max uses" is gone.** It counted *sessions*, which meant a reload could look like it burned an invitation
 * and the 51st visitor could be turned away before making anything. The cap that exists now is on pages, is
 * fixed, and is stated rather than configured — see `MAX_PAGES_PER_SHARE_LINK`.
 *
 * Still takes over the page rather than opening a modal: someone doing this is handing a stranger a writable
 * link to their work, and a cramped dialog is the wrong shape for saying so.
 */

interface Props {
  templateId: string;
  pageTitle: string;
  onCancel: () => void;
}

interface FieldLimit {
  path: string;
  maxLength: string;
  required: boolean;
}

type Result = {
  urlToken: string;
  passphrase: string | null;
  expiresAt: string | null;
};

/** A live link on this template, as the owner needs to see it: what it is, how used, still open? */
interface LinkRow {
  id: string;
  label: string | null;
  useCount: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  passphraseRequired: boolean;
}

export default function ShareTemplate({ templateId, pageTitle, onCancel }: Props) {
  /**
   * Whether this is already a template — asked for here rather than threaded down as a prop.
   *
   * ⚠️ The playground context has an `isTemplate`, and it is **not this**: it means "a frozen legacy brief,
   * read-only, clone to edit". A reflow template is an ordinary editable page with `kind: 'template'`, so
   * reading that flag here would tell every real template it was a plain page. One request on a screen that
   * already takes over the window is the cheaper mistake to avoid.
   *
   * `null` while unknown — the promotion notice stays hidden rather than flashing the wrong claim.
   */
  const [isTemplate, setIsTemplate] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/patterns/${encodeURIComponent(templateId)}`), {
          credentials: 'include',
        });
        const json = (await res.json()) as { pattern?: { kind?: string } };
        if (!cancelled && res.ok) setIsTemplate(patternKind(json.pattern?.kind) === 'template');
      } catch {
        // Left unknown: sharing still works, and `promote` is decided by the server's own state either way.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * Links already live on this template (reflow R.3).
   *
   * Shown here because "who can still get in" is a question an owner has to be able to answer *before*
   * revoking is a meaningful act — and because the alternative was a person creating a second link to a
   * template they had already shared, with no way to see the first.
   *
   * Return links appear too: a page's author holds one, it sits in their inbox indefinitely, and switching it
   * off is what keeps an emailed credential from being a standing risk.
   */
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [revoking, setRevoking] = useState<string | null>(null);

  /**
   * `cancelled` rather than a bare `void load()`: this screen is dismissed by the same click that revokes or
   * shares, so a reply landing after unmount would set state on a component that has gone. Same shape as the
   * kind lookup above, for the same reason.
   */
  const loadLinks = useCallback(
    async (isCancelled?: () => boolean) => {
      try {
        const res = await listTemplateLinks(templateId);
        if (!isCancelled?.()) setLinks(res.links);
      } catch {
        // A list that will not load must not block sharing — the form below is the point of this screen.
      }
    },
    [templateId]
  );

  useEffect(() => {
    let cancelled = false;
    // Inline rather than calling `loadLinks` here: the lint rule reads a `setState` reachable from an effect
    // through a callback as a cascading render, and the shape it does accept is this one — the same shape the
    // kind lookup above uses.
    void (async () => {
      try {
        const res = await listTemplateLinks(templateId);
        if (!cancelled) setLinks(res.links);
      } catch {
        // Sharing must still work when the list will not load.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const revoke = async (id: string) => {
    setRevoking(id);
    setError(null);
    try {
      await revokeTemplateLink(id);
      await loadLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not revoke that link.');
    } finally {
      setRevoking(null);
    }
  };

  const [instructions, setInstructions] = useState('');
  const [days, setDays] = useState('14');
  const [usePassphrase, setUsePassphrase] = useState(true);
  const [showLimits, setShowLimits] = useState(false);
  const [defaultMax, setDefaultMax] = useState('');
  const [limits, setLimits] = useState<FieldLimit[]>([]);

  const shareUrl = result ? `${window.location.origin}/s/${result.urlToken}` : '';

  /**
   * Guardrails in the shape `authoring-guardrails` parses. Assembled here rather than sent as free JSON so a
   * typo in the form cannot become a rule nobody notices — the server re-parses and drops anything unknown.
   */
  const buildGuardrails = () => {
    const fields: Record<string, { maxLength?: number; required?: boolean }> = {};
    for (const limit of limits) {
      const path = limit.path.trim();
      if (!path) continue;
      const max = Number(limit.maxLength);
      const rule: { maxLength?: number; required?: boolean } = {};
      if (Number.isInteger(max) && max > 0) rule.maxLength = max;
      if (limit.required) rule.required = true;
      if (Object.keys(rule).length) fields[path] = rule;
    }
    const defaults = Number(defaultMax);
    return {
      ...(Number.isInteger(defaults) && defaults > 0 ? { defaults: { maxLength: defaults } } : {}),
      ...(Object.keys(fields).length ? { fields } : {}),
    };
  };

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const guardrails = buildGuardrails();
      const res = await shareTemplate(templateId, {
        // Unknown reads as "promote": the action is idempotent for a row that is already a template, and the
        // failure we must avoid is a share that silently does not work.
        promote: isTemplate !== true,
        instructions: instructions.trim() || null,
        // Sent only when there is something to say, so opening this screen cannot silently clear rules the
        // template already had.
        ...(Object.keys(guardrails).length ? { guardrails } : {}),
        expiresInDays: Number(days) || 14,
        usePassphrase,
      });
      setResult({
        urlToken: res.urlToken,
        passphrase: res.passphrase,
        expiresAt: res.expiresAt ? new Date(res.expiresAt).toLocaleDateString() : null,
      });
      void loadLinks();
      // The link list on this screen refreshes itself; there is nothing outside it left to tell (reflow R.5).
      await loadLinks();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    const text = result?.passphrase ? `${shareUrl}\n\nPassphrase: ${result.passphrase}` : shareUrl;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError('Could not copy — select the text and copy it manually.');
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      <header className="border-b px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Share this template</p>
            <h1 className="text-lg font-semibold">{pageTitle || 'Untitled page'}</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {result ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {error ? (
          <p role="alert" className="mb-6 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {error}
          </p>
        ) : null}

        {!result ? (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              Anyone with this link fills in the content and gets their own page — they can’t add, remove or
              rearrange blocks, and they can’t change this one. Each visitor’s page comes back to you, with a
              record of who made it and what they started from.
            </p>

            {/* Promotion is implied by sharing, but never silent: this is the moment it becomes visible. */}
            {isTemplate === false ? (
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <span className="font-medium">This page becomes a template.</span>{' '}
                <span className="text-muted-foreground">
                  It stays yours and stays editable — whoever you share it with always gets it as it is at that
                  moment.
                </span>
              </p>
            ) : null}

            <label className="block">
              <span className="text-sm font-medium">Instructions for whoever builds from it</span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Shown to them while they work. Tone, audience, what to change and what to leave alone. Saved on
                the template, so you can change it later without touching the link.
              </p>
              <Textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                maxLength={4000}
                className="mt-1"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium">Link expires in (days)</span>
                <Input value={days} onChange={(e) => setDays(e.target.value)} className="mt-1" />
              </label>
              <div className="flex items-end">
                <p className="text-xs text-muted-foreground">
                  Up to {MAX_PAGES_PER_SHARE_LINK} pages can be built from one link. Share it again for more.
                </p>
              </div>
            </div>

            <label className="flex items-start gap-2 rounded-md border p-4 text-sm">
              <input
                type="checkbox"
                checked={usePassphrase}
                onChange={(e) => setUsePassphrase(e.target.checked)}
                className="mt-1"
              />
              <span>
                <span className="font-medium">Protect with a passphrase</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Four memorable words, generated for you and shown once. Worth keeping on: a link gets forwarded
                  in email threads, and the passphrase is what stops it working for whoever it reaches next.
                </span>
              </span>
            </label>

            {/**
              * Collapsed by default. Most people sharing a template have no limits in mind, and a form that
              * opens on an empty rules table implies they ought to.
              */}
            <div className="rounded-md border">
              <button
                type="button"
                onClick={() => setShowLimits((v) => !v)}
                className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium"
                aria-expanded={showLimits}
              >
                Content limits
                <span className="text-xs font-normal text-muted-foreground">
                  {showLimits ? 'Hide' : 'Optional'}
                </span>
              </button>

              {showLimits ? (
                <div className="border-t px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    Enforced as they type and again when they submit. Leave empty for no limit — nothing is
                    capped unless you say so.
                  </p>

                  <label className="mt-3 block text-sm">
                    <span className="text-muted-foreground">Default character limit for every text field</span>
                    <Input
                      value={defaultMax}
                      onChange={(e) => setDefaultMax(e.target.value)}
                      placeholder="No limit"
                      className="mt-1 w-40"
                    />
                  </label>

                  {limits.map((limit, i) => (
                    <div key={i} className="mt-3 flex flex-wrap items-end gap-2">
                      <label className="flex-1 text-sm">
                        <span className="text-muted-foreground">Field</span>
                        <Input
                          value={limit.path}
                          onChange={(e) =>
                            setLimits((cur) => cur.map((l, j) => (i === j ? { ...l, path: e.target.value } : l)))
                          }
                          placeholder="headline"
                          className="mt-1"
                        />
                      </label>
                      <label className="w-28 text-sm">
                        <span className="text-muted-foreground">Max</span>
                        <Input
                          value={limit.maxLength}
                          onChange={(e) =>
                            setLimits((cur) => cur.map((l, j) => (i === j ? { ...l, maxLength: e.target.value } : l)))
                          }
                          className="mt-1"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 pb-2 text-sm">
                        <input
                          type="checkbox"
                          checked={limit.required}
                          onChange={(e) =>
                            setLimits((cur) => cur.map((l, j) => (i === j ? { ...l, required: e.target.checked } : l)))
                          }
                        />
                        Required
                      </label>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="pb-2"
                        onClick={() => setLimits((cur) => cur.filter((_, j) => j !== i))}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => setLimits((cur) => [...cur, { path: '', maxLength: '', required: false }])}
                  >
                    Add a field limit
                  </Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Field names are the block’s own, e.g. <code>headline</code> or{' '}
                    <code>bodySlot.props.children</code>.
                  </p>
                </div>
              ) : null}
            </div>

            {/**
              * What is already live, under the form rather than above it: the act you came here for is
              * sharing, and a list of existing links at the top would read as a step you have to get past.
              */}
            {links.length ? (
              <div className="rounded-md border">
                <p className="border-b px-4 py-3 text-sm font-medium">Links that already work</p>
                <ul className="divide-y">
                  {links.map((link) => (
                    <li key={link.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{link.label || 'Share link'}</span>
                        <span className="block text-xs text-muted-foreground">
                          {link.useCount === 0
                            ? 'Not opened yet'
                            : `Opened ${link.useCount} time${link.useCount === 1 ? '' : 's'}`}
                          {link.lastUsedAt ? `, last ${new Date(link.lastUsedAt).toLocaleDateString()}` : ''}
                          {link.expiresAt ? ` · expires ${new Date(link.expiresAt).toLocaleDateString()}` : ''}
                          {link.passphraseRequired ? ' · passphrase' : ''}
                        </span>
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                        disabled={revoking === link.id}
                        onClick={() => void revoke(link.id)}
                      >
                        {revoking === link.id ? 'Revoking…' : 'Revoke'}
                      </Button>
                    </li>
                  ))}
                </ul>
                {/* Revoking closes a door; it does not delete what came through it. Say so, or it reads as
                    destructive and nobody uses the control that makes an emailed link safe to send. */}
                <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                  Revoking stops a link working. Pages already built from it are unaffected.
                </p>
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button onClick={() => void share()} disabled={busy}>
                {busy ? 'Creating…' : 'Create the link'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <p className="text-sm font-medium">Your link is ready</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.expiresAt ? `Expires ${result.expiresAt}. ` : ''}
                Up to {MAX_PAGES_PER_SHARE_LINK} pages can be built from it, and each one arrives in your
                library.
              </p>
            </div>

            {result.passphrase ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                <strong>Copy both now.</strong> The passphrase is stored hashed and the link’s secret can’t be
                shown again. If either is lost, revoke this link and make another.
              </p>
            ) : null}

            <label className="block text-sm">
              <span className="font-medium">Link</span>
              <Input readOnly value={shareUrl} onFocus={(e) => e.currentTarget.select()} className="mt-1 font-mono text-xs" />
            </label>

            {result.passphrase ? (
              <label className="block text-sm">
                <span className="font-medium">Passphrase</span>
                <Input readOnly value={result.passphrase} onFocus={(e) => e.currentTarget.select()} className="mt-1 font-mono" />
              </label>
            ) : null}

            <div className="flex gap-2">
              <Button onClick={() => void copy()}>
                {copied ? 'Copied' : result.passphrase ? 'Copy link and passphrase' : 'Copy link'}
              </Button>
              <Button variant="outline" onClick={onCancel}>
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
