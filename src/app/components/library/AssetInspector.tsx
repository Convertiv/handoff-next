'use client';

import { useState } from 'react';
import { Check, Copy, Globe, XIcon } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import type { Lifecycle, ResourcePermissions, Visibility } from '@/lib/authz/vocab';
import { LifecycleBadge } from './LifecycleBadge';
import { VisibilityBadge } from './VisibilityBadge';
import { OwnerAttribution } from './OwnerAttribution';
import { LifecyclePicker } from './LifecyclePicker';
import { VisibilityPicker } from './VisibilityPicker';
import ShareLinkPanel from '../Share/ShareLinkPanel';

type InspectorAsset = {
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  owner: { id: string; name?: string | null; image?: string | null } | null;
  isMe: boolean;
  visibility: Visibility;
  status: Lifecycle;
  surface: 'pattern' | 'design';
  createdLabel?: string;
  editedLabel?: string;
  editedBy?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  asset: InspectorAsset | null;
  permissions: ResourcePermissions | null;
  onSetLifecycle: (s: Lifecycle) => void;
  onSetVisibility: (v: Visibility) => void;
  onOpen?: () => void;
  onDuplicate?: () => void;
  shareUrl?: string | null;
  onCreateShare?: () => void;
  onRevokeShare?: () => void;
  /**
   * When set, the full share panel replaces the single-link row — capability picker, expiry, max uses, the
   * links list, and the copy-once warning a write-capable link needs. Passed by surfaces that can mint an
   * authoring link (see roadmap E.1); the legacy row remains for callers that only do read-only links.
   */
  shareResource?: { resourceType: 'pattern' | 'design_artifact'; resourceId: string; basePath?: string } | null;
  /**
   * Set for a template: the pages built from it. Guest submissions are filtered out of the library grid —
   * they are children of a template, not loose assets — so this is where they are visible.
   */
  submissions?: { id: string; title: string; status: string; submittedByName: string | null }[] | null;
  busy?: boolean;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 shrink-0 px-2"
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable — no-op */
        }
      }}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

export function AssetInspector({
  open,
  onOpenChange,
  asset,
  permissions,
  onSetLifecycle,
  onSetVisibility,
  onOpen,
  onDuplicate,
  shareUrl,
  onCreateShare,
  onRevokeShare,
  shareResource = null,
  submissions = null,
  busy,
}: Props) {
  const canEdit = Boolean(permissions?.canEdit);
  const canApprove = Boolean(permissions?.canApprove);
  const canChangeVisibility = Boolean(permissions?.canChangeVisibility);

  const showNudge =
    asset?.status === 'review' && (asset.visibility === 'private' || asset.visibility === 'shared');
  const showPublicPanel = asset?.visibility === 'public';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-sm flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="truncate text-sm font-semibold">{asset?.title ?? 'Asset'}</SheetTitle>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 shrink-0 p-0"
              onClick={() => onOpenChange(false)}
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {asset ? (
          <>
            <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
              {/* Thumbnail */}
              <div className="flex items-center gap-2">
                <div className="overflow-hidden rounded-lg border bg-muted/20">
                  {asset.thumbnailUrl ? (
                    <Image
                      src={asset.thumbnailUrl}
                      alt={asset.title}
                      width={512}
                      height={288}
                      unoptimized
                      className="aspect-video w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-video w-full items-center justify-center bg-muted text-xs text-muted-foreground">
                      No preview
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <LifecycleBadge status={asset.status} />
                <VisibilityBadge visibility={asset.visibility} />
              </div>

              {/* Ownership */}
              <Section title="Ownership">
                <OwnerAttribution owner={asset.owner} isMe={asset.isMe} editedLabel={asset.editedLabel} />
                <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                  {asset.createdLabel ? <span>Created {asset.createdLabel}</span> : null}
                  {asset.editedLabel ? (
                    <span>
                      Edited {asset.editedLabel}
                      {asset.editedBy ? ` by ${asset.editedBy}` : ''}
                    </span>
                  ) : null}
                </div>
                {!asset.isMe ? (
                  <p className="text-xs text-muted-foreground">
                    You can see this via your access, not because you built it.
                  </p>
                ) : null}
              </Section>

              {/* Lifecycle */}
              <Section title="Lifecycle">
                <LifecyclePicker
                  value={asset.status}
                  onChange={onSetLifecycle}
                  canApprove={canApprove}
                  disabled={!canEdit || busy}
                />
              </Section>

              {/* Visibility & access */}
              <Section title="Visibility & access">
                <VisibilityPicker
                  value={asset.visibility}
                  onChange={onSetVisibility}
                  disabled={!canChangeVisibility || busy}
                />
              </Section>

              {/* Nudge: in review but not yet team-visible */}
              {showNudge ? (
                <div className="rounded-md border border-amber-500/30 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
                  <p className="mb-2">
                    This is ready for review but only you (and people you picked) can see it. Share it with the
                    team so reviewers can reach it.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canChangeVisibility || busy}
                    onClick={() => onSetVisibility('team')}
                  >
                    Share with team
                  </Button>
                </div>
              ) : null}

              {submissions && submissions.length > 0 ? (
                <Section title={`Built from this (${submissions.length})`}>
                  <ul className="space-y-1">
                    {submissions.map((sub) => (
                      <li key={sub.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate">
                          {sub.title || sub.id}
                          {sub.submittedByName ? (
                            <span className="text-muted-foreground"> · {sub.submittedByName}</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{sub.status}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Submitted pages are reviewed in the review queue, not here.
                  </p>
                </Section>
              ) : null}

              {/* Share panel — full capability-aware version when the caller supplies a resource. */}
              {shareResource ? (
                <Section title="Links">
                  <ShareLinkPanel
                    resourceType={shareResource.resourceType}
                    resourceId={shareResource.resourceId}
                    basePath={shareResource.basePath}
                  />
                </Section>
              ) : showPublicPanel ? (
                <Section title="Public link">
                  {shareUrl ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/30 px-2 py-1.5 text-xs">
                          <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="truncate">{shareUrl}</span>
                        </div>
                        <CopyButton value={shareUrl} />
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        disabled={busy}
                        onClick={onRevokeShare}
                      >
                        Revoke
                      </Button>
                    </div>
                  ) : (
                    <Button variant="outline" size="sm" disabled={busy} onClick={onCreateShare}>
                      Create link
                    </Button>
                  )}
                </Section>
              ) : null}
            </div>

            {/* Footer */}
            <div className={cn('flex flex-col gap-2 border-t p-4')}>
              {canEdit ? (
                <>
                  <Button className="w-full" disabled={busy} onClick={onOpen}>
                    Open
                  </Button>
                  <Button variant="secondary" className="w-full" disabled={busy} onClick={onDuplicate}>
                    Duplicate
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="outline" className="w-full" disabled={busy} onClick={onOpen}>
                    Open (view only)
                  </Button>
                  <Button className="w-full" disabled={busy} onClick={onDuplicate}>
                    Duplicate to yours
                  </Button>
                </>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

export default AssetInspector;
