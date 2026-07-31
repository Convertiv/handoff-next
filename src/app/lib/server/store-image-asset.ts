import 'server-only';

import { getAsset, insertAsset, upsertAssetBlob } from '@/lib/db/queries';
import {
  assetIdForBytes,
  contentHashForBytes,
  extensionForMimeType,
  type StorableImageMimeType,
} from '@/lib/image-bytes';
import { buildAssetKey, buildThumbnailKey, isS3Configured, putToS3 } from '@/lib/server/s3-assets';

/**
 * Put image bytes into the asset library and hand back something a page can point at.
 *
 * This did not exist. `openAiImageEdit` returns a base64 data URL, `insertAsset` writes a row and never
 * touches bytes, and the only code that re-hosted remote bytes was Figma-specific — so a generated
 * image could be shown once and never stored. Every piece needed was already here; nothing composed
 * them.
 *
 * Deliberately takes **bytes, not a source**. Generation, a chat attachment and a URL-pulled image all
 * differ only in how they obtain a buffer, and each of those is a few lines at the call site. One
 * function for all three is the point of the module.
 */

export interface StoreImageAssetInput {
  bytes: Buffer;
  mimeType: StorableImageMimeType;
  title: string;
  altText?: string | null;
  description?: string | null;
  tags?: string[];
  collectionId?: string | null;
  /** Provenance, matching the `handoff_asset.source_type` enum: `figma|upload|url|wordpress|cloudinary`. */
  sourceType?: string;
  sourceUrl?: string | null;
  sourceMetadata?: Record<string, unknown>;
  /** FK to `user.id`. Null for service callers — the column is nullable, unlike the job table's. */
  createdBy?: string | null;
}

export interface StoredImageAsset {
  assetId: string;
  /** What a block's image field should be set to. */
  storageUrl: string;
  /** True when these bytes were already in the library and nothing was written. */
  deduped: boolean;
}

export async function storeImageAsset(input: StoreImageAssetInput): Promise<StoredImageAsset> {
  const { bytes, mimeType } = input;
  if (!bytes.length) throw new Error('storeImageAsset: empty bytes');

  const contentHash = contentHashForBytes(bytes);
  const assetId = assetIdForBytes(bytes);

  // Content-addressed, so this is the dedupe: the same image generated twice, or a retried job, is one
  // row. Checked by id rather than by blob content-hash because the S3 path writes no blob row, and
  // `findAssetIdByContentHash` only sees DB-backed bytes — it would miss every S3 asset.
  const existing = await getAsset(assetId);
  if (existing) return { assetId, storageUrl: existing.storageUrl, deduped: true };

  const filename = `${assetId}.${extensionForMimeType(mimeType)}`;
  let storageUrl: string;
  let storageKey: string | null = null;
  let thumbnailUrl: string | null = null;

  if (isS3Configured()) {
    // sharp is a native module — dynamic import avoids bundler issues. Same recipe as the Figma ingest.
    const sharp = (await import('sharp')).default;
    const thumbnail = await sharp(bytes)
      .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
      .png({ quality: 85 })
      .toBuffer();

    storageKey = buildAssetKey(assetId, filename);
    const [uploaded, thumb] = await Promise.all([
      putToS3(storageKey, bytes, mimeType),
      putToS3(buildThumbnailKey(assetId), thumbnail, 'image/png'),
    ]);
    storageUrl = uploaded;
    thumbnailUrl = thumb;
  } else {
    // No S3: bytes live in Postgres and are served by /api/handoff/assets/[id]/raw. Storage follows
    // whatever the deployment already does — this is not a new decision.
    await upsertAssetBlob({ assetId, data: bytes.toString('base64'), contentType: mimeType, contentHash });
    storageUrl = `/api/handoff/assets/${assetId}/raw`;
  }

  const dimensions = await readDimensions(bytes);

  await insertAsset({
    id: assetId,
    title: input.title,
    description: input.description ?? null,
    altText: input.altText ?? null,
    assetType: 'image',
    mimeType,
    fileSizeBytes: bytes.length,
    nativeWidth: dimensions?.width ?? null,
    nativeHeight: dimensions?.height ?? null,
    storageUrl,
    storageKey,
    thumbnailUrl,
    collectionId: input.collectionId ?? null,
    sourceType: input.sourceType ?? 'upload',
    sourceUrl: input.sourceUrl ?? null,
    sourceMetadata: input.sourceMetadata ?? {},
    tags: input.tags ?? [],
    status: 'active',
    createdBy: input.createdBy ?? null,
  });

  return { assetId, storageUrl, deduped: false };
}

/**
 * Native dimensions, best-effort.
 *
 * Nice to have, not worth failing a stored asset over — an image with null dimensions is usable, and a
 * generation that succeeded should not be thrown away because `sharp` could not read a header.
 */
async function readDimensions(bytes: Buffer): Promise<{ width: number; height: number } | null> {
  try {
    const sharp = (await import('sharp')).default;
    const { width, height } = await sharp(bytes).metadata();
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}
