'use client';

import { Copy, Info, LayoutTemplate, Share2, Sparkles } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Lifecycle, ResourcePermissions, Visibility } from '@/lib/authz/vocab';
import { LifecycleBadge } from './LifecycleBadge';
import { OwnerAttribution } from './OwnerAttribution';
import { VisibilityBadge } from './VisibilityBadge';

/**
 * A single asset normalized across the two Tools surfaces — a design artifact
 * (Workbench output) or a pattern (Playground output). The Library merges both
 * types into one grid, so every field here is the common denominator both
 * source rows can be projected onto.
 */
export type LibraryAsset = {
  type: 'design' | 'pattern';
  id: string;
  title: string;
  thumbnailUrl?: string | null;
  owner: { id: string; name?: string | null; image?: string | null } | null;
  isMe: boolean;
  visibility: Visibility;
  status: Lifecycle;
  permissions: ResourcePermissions | null;
  updatedAt: string | number | Date | null;
};

const TYPE_META: Record<LibraryAsset['type'], { label: string; Icon: typeof Sparkles }> = {
  design: { label: 'Design', Icon: Sparkles },
  pattern: { label: 'Pattern', Icon: LayoutTemplate },
};

function formatEdited(updatedAt: LibraryAsset['updatedAt']): string | undefined {
  if (!updatedAt) return undefined;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AssetCard({
  asset,
  onOpen,
  onDetails,
  onDuplicate,
}: {
  asset: LibraryAsset;
  onOpen: () => void;
  onDetails: () => void;
  onDuplicate?: () => void;
}) {
  const canEdit = Boolean(asset.permissions?.canEdit);
  const { label: typeLabel, Icon: TypeIcon } = TYPE_META[asset.type];
  const editedLabel = formatEdited(asset.updatedAt);

  return (
    <li className="group flex flex-col overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        className="relative block aspect-video w-full overflow-hidden bg-muted/30 text-left"
        onClick={onOpen}
        title="Open"
      >
        {asset.thumbnailUrl ? (
          <Image
            src={asset.thumbnailUrl}
            alt={asset.title}
            width={512}
            height={288}
            unoptimized
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            No preview
          </span>
        )}
        {/* Type indicator so the two asset kinds stay distinguishable in a mixed grid. */}
        <span
          className={cn(
            'absolute left-2 top-2 inline-flex items-center gap-1 rounded-full border bg-background/90 px-2 py-0.5',
            'text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur',
          )}
        >
          <TypeIcon className="h-3 w-3" aria-hidden />
          {typeLabel}
        </span>
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <button
          type="button"
          className="text-left text-sm font-medium leading-tight hover:underline"
          onClick={onOpen}
        >
          {asset.title}
        </button>

        <div className="flex flex-wrap items-center gap-1.5">
          <LifecycleBadge status={asset.status} />
          <VisibilityBadge visibility={asset.visibility} />
        </div>

        <OwnerAttribution owner={asset.owner} isMe={asset.isMe} editedLabel={editedLabel} />

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={onDetails}
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
            Details
          </Button>
          <div className="flex items-center gap-1.5">
            <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={onOpen}>
              Open
            </Button>
            {canEdit ? (
              // Sharing lives in the inspector (visibility + public-link controls),
              // so "Share" opens the detail sheet where those controls are.
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onDetails}
              >
                <Share2 className="h-3.5 w-3.5" aria-hidden />
                Share
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onDuplicate}
                disabled={!onDuplicate}
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Duplicate
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

export default AssetCard;
