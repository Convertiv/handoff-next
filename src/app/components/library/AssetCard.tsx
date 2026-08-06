'use client';

import { Layout, PenNib } from '@phosphor-icons/react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { LIFECYCLE_META, VISIBILITY_META, type Lifecycle, type ResourcePermissions, type Visibility } from '@/lib/authz/vocab';

/** Uniform quiet badge for the card's bottom row — text only, outline, no fill. */
const PLAIN_BADGE = 'inline-flex items-center rounded-md border border-border px-2 py-0.5 text-[10px] text-muted-foreground';

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
  /** `handoff_pattern.source` — 'template' gets its own identity, being the thing others build from. */
  source?: string | null;
};

const TYPE_META: Record<LibraryAsset['type'], { label: string; Icon: typeof PenNib }> = {
  design: { label: 'Design', Icon: PenNib },
  pattern: { label: 'Page', Icon: Layout },
};

/**
 * A template is not just a page with a flag — it is the object other people build from, so it says so.
 * Same row shape, different identity.
 */
function assetTypeLabel(asset: LibraryAsset): string {
  if (asset.type === 'pattern' && asset.source === 'template') return 'Template';
  return TYPE_META[asset.type].label;
}

function formatEdited(updatedAt: LibraryAsset['updatedAt']): string | undefined {
  if (!updatedAt) return undefined;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function AssetCard({
  asset,
  onOpen,
  onDuplicate,
}: {
  asset: LibraryAsset;
  onOpen: () => void;
  /**
   * Clone this into a page of your own — the one action the library still owns, because starting from
   * someone else's team or public page is a *browse-time* intent (E.6).
   *
   * There is deliberately **no "details" affordance here.** The library used to have a `⋯` button opening a
   * right-hand inspector that owned visibility, lifecycle and sharing; all of that now lives on the object's
   * own view (roadmap E.7a). A grid of many things is the wrong place to configure one of them.
   */
  onDuplicate?: () => void;
}) {
  const { Icon: TypeIcon } = TYPE_META[asset.type];
  const typeLabel = assetTypeLabel(asset);
  const editedLabel = formatEdited(asset.updatedAt);
  const ownerName = asset.owner?.name?.trim() || (asset.isMe ? 'You' : 'Teammate');

  return (
    <li className="group flex overflow-hidden rounded-lg border bg-card transition-colors hover:border-gray-400 dark:hover:border-gray-600">
      <button type="button" className="flex flex-1 flex-col text-left" onClick={onOpen}>
        <div className="relative aspect-video w-full overflow-hidden bg-muted/30">
        {asset.thumbnailUrl ? (
          <Image
            src={asset.thumbnailUrl}
            alt={asset.title}
            width={512}
            height={288}
            unoptimized
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
            No preview
          </span>
        )}
        {/* Type indicator so the two asset kinds stay distinguishable in a mixed grid. */}
        <span
          className={cn(
            'absolute left-2 top-2 inline-flex items-center justify-center rounded-md bg-background/90 p-1.5 shadow-[0_1px_1px_rgba(0,0,0,0.1)]',
            'text-muted-foreground backdrop-blur',
          )}
          title={typeLabel}
        >
          <TypeIcon className="h-3.5 w-3.5" aria-hidden />
          <span className="sr-only">{typeLabel}</span>
        </span>
        </div>

        <div className="flex flex-1 flex-col gap-2 p-3">
        <span className="-mb-1 text-sm font-medium leading-tight text-foreground">{asset.title}</span>

        <p className="text-xs text-muted-foreground">
          {ownerName}
          {editedLabel ? ` on ${editedLabel}` : ''}
        </p>

        <div className="flex flex-wrap items-center gap-1.5">
          {/* Templates read as templates, not as pages that happen to be flagged. */}
          {asset.type === 'pattern' && asset.source === 'template' ? (
            <span className={PLAIN_BADGE}>Template</span>
          ) : null}
          <span className={PLAIN_BADGE}>{LIFECYCLE_META[asset.status].short}</span>
          <span className={PLAIN_BADGE}>{VISIBILITY_META[asset.visibility].label}</span>
        </div>
        </div>
      </button>

      {/* Outside the open-button: nesting a button inside a button is invalid HTML. */}
      {onDuplicate ? (
        <button
          type="button"
          onClick={onDuplicate}
          aria-label={`Duplicate ${asset.title}`}
          title="Duplicate"
          className="shrink-0 border-l px-2 text-xs text-muted-foreground hover:bg-muted/50"
        >
          Duplicate
        </button>
      ) : null}
    </li>
  );
}

export default AssetCard;
