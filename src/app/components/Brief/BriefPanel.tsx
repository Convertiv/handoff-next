'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { deactivateInvite, editBriefInstructions, regenerateInvite } from '@/app/actions/patterns';
import BuildList, { type BuildRow } from './BuildList';

/**
 * The left panel at **brief level** (roadmap E.8): what this invitation is, and who has built from it.
 *
 * Replaces the blocks list, because a brief is frozen — there is no structure to edit, so a block list would
 * only offer affordances the write path refuses. The canvas beside it is the brief itself.
 */

export interface BriefLinkStatus {
  id: string;
  writeCapable: boolean;
  passphraseRequired: boolean;
  secretRecoverable: boolean;
  useCount: number;
  maxUses: number | null;
  expiresAt: string | null;
}

export interface BriefMeta {
  id: string;
  title: string;
  version: number | null;
  description: string | null;
  instructions: string | null;
  createdAt: string | null;
  createdByName: string | null;
}

function expiryNote(expiresAt: string | null): string {
  if (!expiresAt) return 'no expiry';
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return 'no expiry';
  if (ms <= 0) return 'expired';
  const days = Math.round(ms / 86_400_000);
  return days >= 1 ? `expires in ${days} day${days === 1 ? '' : 's'}` : 'expires within a day';
}

export default function BriefPanel({
  brief,
  links,
  builds,
  selectedBuildId,
  onSelectBuild,
  onBackToPage,
  basePath = '',
}: {
  brief: BriefMeta;
  links: BriefLinkStatus[];
  builds: BuildRow[];
  selectedBuildId: string | null;
  onSelectBuild: (id: string) => void;
  onBackToPage: () => void;
  /** For building the copyable invite URL after a regenerate. */
  basePath?: string;
}) {
  const router = useRouter();
  const invites = links.filter((l) => l.writeCapable);

  const [busy, setBusy] = useState<null | 'regenerate' | 'deactivate' | 'save'>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(brief.instructions ?? '');
  /**
   * The freshly minted credentials, held in state and **never re-fetched**.
   *
   * This is the only moment they exist in plaintext anywhere; a refresh loses them for good, which is why the
   * panel says so next to them rather than offering a copy button that would later fail silently.
   */
  const [minted, setMinted] = useState<{ url: string; passphrase: string | null } | null>(null);

  const run = useCallback(
    async (kind: 'regenerate' | 'deactivate' | 'save', fn: () => Promise<void>) => {
      setBusy(kind);
      setError(null);
      try {
        await fn();
        // Server-rendered props: refresh so link status, instructions and counts all come back consistent.
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'That did not work.');
      } finally {
        setBusy(null);
      }
    },
    [router]
  );

  const onRegenerate = () =>
    void run('regenerate', async () => {
      const res = await regenerateInvite(brief.id);
      setMinted({
        url: `${window.location.origin}${basePath}/s/${res.urlToken}`,
        passphrase: res.passphrase ?? null,
      });
    });

  const onDeactivate = () =>
    void run('deactivate', async () => {
      await deactivateInvite(brief.id);
      // Any previously revealed credentials are now dead; keeping them on screen would invite a paste.
      setMinted(null);
    });

  const onSaveInstructions = () =>
    void run('save', async () => {
      await editBriefInstructions(brief.id, draft);
      setEditing(false);
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-2">
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-1.5" onClick={onBackToPage}>
          <ChevronLeft className="h-4 w-4" />
          <span className="text-xs">Back to the page</span>
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Invitation{brief.version ? ` v${brief.version}` : ''}
          </p>
          <h2 className="text-sm font-semibold leading-snug">{brief.title || 'Untitled invitation'}</h2>
          <p className="text-xs text-muted-foreground">
            {brief.createdByName ? `Created by ${brief.createdByName}` : 'Created'}
            {brief.createdAt ? ` · ${new Date(brief.createdAt).toLocaleDateString()}` : ''}
          </p>
        </div>

        {brief.description ? <p className="text-sm text-muted-foreground">{brief.description}</p> : null}

        <section className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Instructions given
          </p>
          {editing ? (
            <div className="space-y-1.5">
              <Textarea
                aria-label="Instructions"
                rows={5}
                maxLength={4000}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
              />
              <div className="flex gap-1.5">
                <Button size="sm" className="h-7 text-xs" disabled={busy !== null} onClick={onSaveInstructions}>
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  disabled={busy !== null}
                  onClick={() => {
                    setDraft(brief.instructions ?? '');
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
              {/* Says what it does and does not touch, because a frozen object accepting a write needs to. */}
              <p className="text-xs text-muted-foreground">
                Editing instructions doesn’t change the page builders work from — that stays frozen.
              </p>
            </div>
          ) : brief.instructions ? (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{brief.instructions}</p>
          ) : (
            <p className="text-sm text-muted-foreground">No instructions given.</p>
          )}
        </section>

        {/**
         * Link **status**, never the link or the passphrase.
         *
         * Neither can be shown: a write-capable token is SHA-256 hashed and a passphrase is scrypt-hashed, so
         * there is no plaintext to display — which is the point (a database leak yields no usable invites).
         * `secretRecoverable` is the server saying so outright. Regenerating is the way to get a fresh URL,
         * and it is deliberately a decision rather than a copy button (roadmap E.8b).
         */}
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Invite link</p>
          {invites.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active link. Regenerate one to invite someone.</p>
          ) : (
            <ul className="space-y-1.5">
              {invites.map((link) => (
                <li key={link.id} className="rounded-md border bg-muted/30 p-2 text-xs">
                  <p className="font-medium text-foreground">
                    Active · {link.useCount}
                    {link.maxUses ? ` of ${link.maxUses}` : ''} use{link.useCount === 1 ? '' : 's'}
                  </p>
                  <p className="text-muted-foreground">
                    {expiryNote(link.expiresAt)}
                    {' · '}
                    {link.passphraseRequired ? 'passphrase set' : 'no passphrase'}
                  </p>
                  {!link.secretRecoverable ? (
                    <p className="mt-1 text-muted-foreground">
                      The URL can’t be shown again — regenerate to get a new one.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {/**
            * The one moment the credentials exist in plaintext. Shown with the warning attached rather than
            * behind a copy button, because after this render they are gone for good — the token is hashed and
            * so is the passphrase.
            */}
          {minted ? (
            <div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-50 p-2 dark:bg-amber-500/10">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-200">
                Copy these now — they can’t be shown again.
              </p>
              <input
                readOnly
                value={minted.url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="New invite link"
                className="w-full rounded border bg-background px-2 py-1 text-xs text-foreground"
              />
              {minted.passphrase ? (
                <input
                  readOnly
                  value={minted.passphrase}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label="New passphrase"
                  className="w-full rounded border bg-background px-2 py-1 font-mono text-xs text-foreground"
                />
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  void navigator.clipboard.writeText(
                    minted.passphrase ? `${minted.url}\nPassphrase: ${minted.passphrase}` : minted.url
                  )
                }
              >
                Copy both
              </Button>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="text-xs text-amber-700 dark:text-amber-400">
              {error}
            </p>
          ) : null}

          {/* Three distinct decisions. "Deactivate" closes the door; archiving the brief (E.6.5) hides it and
              its builds — different consequences, so never the same button. */}
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy !== null}
              onClick={onRegenerate}
            >
              {busy === 'regenerate' ? 'Regenerating…' : invites.length ? 'Regenerate' : 'Create a link'}
            </Button>
            {!editing ? (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy !== null}
                onClick={() => setEditing(true)}
              >
                Edit instructions
              </Button>
            ) : null}
            {invites.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                disabled={busy !== null}
                onClick={onDeactivate}
              >
                {busy === 'deactivate' ? 'Deactivating…' : 'Deactivate invite'}
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Regenerating replaces the current link — anyone still holding the old one loses access.
          </p>
        </section>

        <section className="space-y-2 border-t pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Builds ({builds.length})
          </p>
          <BuildList builds={builds} selectedId={selectedBuildId} onSelect={onSelectBuild} />
        </section>
      </div>
    </div>
  );
}
