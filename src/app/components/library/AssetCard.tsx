'use client';

import { Layout, PenNib } from '@phosphor-icons/react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { LIFECYCLE_META, VISIBILITY_META, type Lifecycle, type ResourcePermissions, type Visibility } from '@/lib/authz/vocab';
import { patternThumbnailUrl } from '@/lib/pattern-thumbnail';

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

/**
 * **A card is a link. It takes no actions.**
 *
 * This has been walked back three times — a `⋯` details/sharing panel, then a Duplicate button — and each time
 * the reason was "this feature needs somewhere to live", which is not a reason to put it on a card (Brad,
 * repeatedly, through 2026-08-06). Everything you can *do* to an object lives on that object's own view:
 * visibility and lifecycle in `MetaControl`, duplicate in the page editor, invitations in the wizard.
 *
 * If something seems to need a card affordance, it needs a home on the object instead.
 */
export function AssetCard({ asset, onOpen }: { asset: LibraryAsset; onOpen: () => void }) {
  const { Icon: TypeIcon } = TYPE_META[asset.type];
  const typeLabel = assetTypeLabel(asset);
  const editedLabel = formatEdited(asset.updatedAt);
  const ownerName = asset.owner?.name?.trim() || (asset.isMe ? 'You' : 'Teammate');

  /**
   * A page with no stored thumbnail falls back to a silhouette drawn from its blocks.
   *
   * Nothing on the save path writes `handoff_pattern.thumbnail`, so in practice *every* page saved from
   * the playground showed "No preview" on an empty grey box — which reads as a broken card rather than
   * as a missing screenshot. The fallback is generated, cheap and always available; see
   * `patternThumbnailSvg` for why it is a diagram rather than a capture.
   *
   * Only patterns: a design artifact's thumbnail is a real rendered image, and its absence means the
   * render has not happened yet — a schematic there would claim to show something it cannot.
   */
  const previewSrc =
    asset.thumbnailUrl ?? (asset.type === 'pattern' ? patternThumbnailUrl(asset.id) : null);

  return (
    <li className="group flex overflow-hidden rounded-lg border bg-card transition-colors hover:border-gray-400 dark:hover:border-gray-600">
      <button type="button" className="flex flex-1 flex-col text-left" onClick={onOpen}>
        <div className="relative aspect-video w-full overflow-hidden bg-muted/30">
        {previewSrc ? (
          <Image
            src={previewSrc}
            alt={asset.title}
            width={512}
            height={288}
            unoptimized
            /**
             * `contain` for the generated silhouette, `cover` for a real image.
             *
             * The schematic is drawn at 320×180 with its own margins; cropping it to fill would cut the
             * page's own edges off and make every card look like a zoomed-in grey smudge.
             */
            className={cn('h-full w-full', asset.thumbnailUrl ? 'object-cover' : 'object-contain')}
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
    </li>
  );
}

export default AssetCard;
