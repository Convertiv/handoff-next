'use client';

import { ChevronLeft } from 'lucide-react';
import { Button } from '../ui/button';
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
}: {
  brief: BriefMeta;
  links: BriefLinkStatus[];
  builds: BuildRow[];
  selectedBuildId: string | null;
  onSelectBuild: (id: string) => void;
  onBackToPage: () => void;
}) {
  const invites = links.filter((l) => l.writeCapable);

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

        {brief.instructions ? (
          <section className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Instructions given
            </p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{brief.instructions}</p>
          </section>
        ) : null}

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
          {/* Both actions are E.8b/E.8 work, wired next. Shown disabled so the panel does not imply they are
              missing — and deliberately two buttons, because deactivating an invite and archiving the brief are
              different verbs with different consequences. */}
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled>
              Regenerate
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled>
              Edit instructions
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" disabled>
              Deactivate invite
            </Button>
          </div>
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
