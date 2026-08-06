'use client';

import { useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { createInvitation } from '@/app/actions/patterns';

/**
 * Invite someone to build from this page (see `docs/INVITE-TO-BUILD.md`).
 *
 * **Takes over the page rather than opening a modal** — deliberately. The person doing this is usually doing it
 * for the first time, and is about to hand a stranger a writable link to their work; a cramped dialog is the
 * wrong shape for explaining that.
 *
 * Finishing creates two things at once: a **brief** (a frozen snapshot of the page as it stands now, plus these
 * instructions and limits) and its first **invite link**. The page itself is untouched and keeps changing.
 */

interface Props {
  pageId: string;
  pageTitle: string;
  onCancel: () => void;
  /** Called after a successful create, so the caller can refresh its invitations list. */
  onCreated: () => void;
}

interface FieldLimit {
  path: string;
  maxLength: string;
  required: boolean;
}

type Result = {
  urlToken: string;
  passphrase: string | null;
  version: number;
  expiresAt: string | null;
};

export default function InviteWizard({ pageId, pageTitle, onCancel, onCreated }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1 — what are they building?
  const [title, setTitle] = useState(pageTitle ? `${pageTitle}` : '');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [defaultMax, setDefaultMax] = useState('');
  const [limits, setLimits] = useState<FieldLimit[]>([]);

  // Step 2 — who, and for how long?
  const [days, setDays] = useState('14');
  const [maxUses, setMaxUses] = useState('');
  const [usePassphrase, setUsePassphrase] = useState(true);

  // Step 3 — the result, shown once.
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState<'link' | 'both' | null>(null);

  const inviteUrl = result ? `${window.location.origin}/s/${result.urlToken}` : '';

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

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createInvitation(pageId, {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        instructions: instructions.trim() || undefined,
        guardrails: buildGuardrails(),
        expiresInDays: Number(days) || 14,
        maxUses: maxUses.trim() ? Number(maxUses) : null,
        usePassphrase,
      });
      setResult({
        urlToken: res.urlToken,
        passphrase: res.passphrase,
        version: res.brief.version,
        expiresAt: res.expiresAt ? new Date(res.expiresAt).toLocaleDateString() : null,
      });
      setStep(3);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the invitation.');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (what: 'link' | 'both') => {
    const text =
      what === 'link' || !result?.passphrase
        ? inviteUrl
        : `${inviteUrl}\n\nPassphrase: ${result.passphrase}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setError('Could not copy — select the text and copy it manually.');
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      <header className="border-b px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Invite to build</p>
            <h1 className="text-lg font-semibold">{pageTitle || 'Untitled page'}</h1>
          </div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {step === 3 ? 'Done' : 'Cancel'}
          </Button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
        {/* Three steps, named rather than numbered dots — someone arriving cold should know what is coming. */}
        <ol className="mb-8 flex gap-4 text-sm">
          {['What they build', 'Who, and how long', 'Send it'].map((label, i) => {
            const n = (i + 1) as 1 | 2 | 3;
            return (
              <li
                key={label}
                className={
                  n === step ? 'font-medium text-foreground' : n < step ? 'text-muted-foreground' : 'text-muted-foreground/50'
                }
              >
                {n}. {label}
              </li>
            );
          })}
        </ol>

        {error ? (
          <p role="alert" className="mb-6 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {error}
          </p>
        ) : null}

        {step === 1 ? (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">
              This freezes a copy of the page as it is right now. Whoever you invite fills in the content — they
              can’t add, remove or rearrange blocks, and they can’t change your page.
            </p>

            <label className="block">
              <span className="text-sm font-medium">Name this invitation</span>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className="mt-1" />
            </label>

            <label className="block">
              <span className="text-sm font-medium">
                What is it for? <span className="font-normal text-muted-foreground">(optional)</span>
              </span>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                maxLength={2000}
                className="mt-1"
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium">Instructions for the builder</span>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Shown to them while they work. Tone, audience, what to change and what to leave alone.
              </p>
              <Textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={4}
                maxLength={4000}
                className="mt-1"
              />
            </label>

            <fieldset className="rounded-md border p-4">
              <legend className="px-1 text-sm font-medium">Content limits</legend>
              <p className="text-xs text-muted-foreground">
                Enforced as they type and again when they submit. Leave empty for no limit — nothing is capped
                unless you say so.
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
            </fieldset>

            <div className="flex justify-end">
              <Button onClick={() => setStep(2)}>Next</Button>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium">Expires in (days)</span>
                <Input value={days} onChange={(e) => setDays(e.target.value)} className="mt-1" />
              </label>
              <label className="block text-sm">
                <span className="font-medium">
                  Max uses <span className="font-normal text-muted-foreground">(optional)</span>
                </span>
                <Input
                  value={maxUses}
                  onChange={(e) => setMaxUses(e.target.value)}
                  placeholder="Unlimited"
                  className="mt-1"
                />
                {/* Sessions, not people — otherwise a reload looks like it burned an invitation. */}
                <span className="mt-1 block text-xs text-muted-foreground">
                  Counts sessions, not people. A reload doesn’t spend one.
                </span>
              </label>
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

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button onClick={() => void create()} disabled={busy}>
                {busy ? 'Creating…' : 'Create invitation'}
              </Button>
            </div>
          </div>
        ) : null}

        {step === 3 && result ? (
          <div className="space-y-6">
            <div>
              <p className="text-sm font-medium">Invitation v{result.version} is ready</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.expiresAt ? `Expires ${result.expiresAt}. ` : ''}Your page is unchanged — this is a frozen
                copy.
              </p>
            </div>

            {result.passphrase ? (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong>Copy both now.</strong> The passphrase is stored hashed and the link’s secret can’t be
                shown again. If either is lost, revoke this invitation and create another.
              </p>
            ) : null}

            <label className="block text-sm">
              <span className="font-medium">Link</span>
              <Input readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} className="mt-1 font-mono text-xs" />
            </label>

            {result.passphrase ? (
              <label className="block text-sm">
                <span className="font-medium">Passphrase</span>
                <Input readOnly value={result.passphrase} onFocus={(e) => e.currentTarget.select()} className="mt-1 font-mono" />
              </label>
            ) : null}

            <div className="flex gap-2">
              <Button onClick={() => void copy(result.passphrase ? 'both' : 'link')}>
                {copied ? 'Copied' : result.passphrase ? 'Copy link and passphrase' : 'Copy link'}
              </Button>
              <Button variant="outline" onClick={onCancel}>
                Done
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
