import 'server-only';

import { deleteAsset, getAsset, getAssetBlob, insertAsset, upsertAssetBlob } from '@/lib/db/queries';
import {
  assetIdForBytes,
  contentHashForBytes,
  extensionForMimeType,
  shouldReencodeToWebp,
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
  /**
   * Re-encode PNG/JPEG to WebP before storing. Default on — see `shouldReencodeToWebp`.
   *
   * Pass `false` for authored artwork: a logo, an icon, a screenshot with text in it. Lossy
   * compression is right for a generated photograph and wrong for a diagram.
   */
  reencode?: boolean;
}

export interface StoredImageAsset {
  assetId: string;
  /** What a block's image field should be set to. */
  storageUrl: string;
  /** True when these bytes were already in the library and nothing new was inserted. */
  deduped: boolean;
  /** True when an existing row was found with its bytes missing and they were written back. */
  repaired?: boolean;
}

export async function storeImageAsset(input: StoreImageAssetInput): Promise<StoredImageAsset> {
  if (!input.bytes.length) throw new Error('storeImageAsset: empty bytes');

  // **Convert first, then derive everything from the result.** The id, the content hash, the recorded
  // size and the stored bytes must all describe the same thing; hashing the input and storing the
  // output would make `fileSizeBytes` a lie and the content-addressed id not address the content.
  const { bytes, mimeType } = await toStorageFormat(input.bytes, input.mimeType, input.reencode);

  const contentHash = contentHashForBytes(bytes);
  const assetId = assetIdForBytes(bytes);

  const s3 = isS3Configured();

  // Content-addressed, so this is the dedupe: the same image generated twice, or a retried job, is one
  // row. Checked by id rather than by blob content-hash because the S3 path writes no blob row, and
  // `findAssetIdByContentHash` only sees DB-backed bytes — it would miss every S3 asset.
  const existing = await getAsset(assetId);
  if (existing) {
    // **A row is not proof of bytes.** On the DB-backed path the row's `storageUrl` points at
    // `/api/handoff/assets/<id>/raw`, which reads the blob table — so a row whose blob is missing
    // returns a 404 image *and* dedupe keeps handing that URL out forever, on every future generation
    // of the same content. Exactly what happened: an image generated, inserted, and 404'd.
    //
    // Rows can outlive their bytes for several dull reasons — an interrupted write, a blob pruned
    // separately, a row created by an ingest path that stored elsewhere. Repairing is cheap and we are
    // holding the bytes right now, so verify rather than assume.
    if (!s3) {
      const blob = await getAssetBlob(assetId).catch(() => null);
      if (!blob) {
        await upsertAssetBlob({ assetId, data: bytes.toString('base64'), contentType: mimeType, contentHash });
        const repairedUrl = existing.storageUrl || `/api/handoff/assets/${assetId}/raw`;
        return { assetId, storageUrl: repairedUrl, deduped: true, repaired: true };
      }
    }
    return { assetId, storageUrl: existing.storageUrl, deduped: true };
  }

  const filename = `${assetId}.${extensionForMimeType(mimeType)}`;
  let storageUrl: string;
  let storageKey: string | null = null;
  let thumbnailUrl: string | null = null;

  if (s3) {
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
    // No S3: bytes live in Postgres and are served by /api/handoff/assets/[id]/raw. The URL is
    // derivable from the id, so it can be known before the bytes are written — which matters, see
    // the ordering note below. Storage follows whatever the deployment already does.
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

  // **The asset row first, then its bytes.** `handoff_asset_blob.asset_id` is a foreign key to
  // `handoff_asset.id`, so writing the blob first fails the constraint — which is exactly what it did
  // on the first successful generation. `ingestReferencedImageAsset` has always done it in this order;
  // this was simply backwards.
  if (!s3) {
    try {
      await upsertAssetBlob({ assetId, data: bytes.toString('base64'), contentType: mimeType, contentHash });
    } catch (err) {
      // The row is already in, pointing at a `/raw` URL that would 404. A broken library entry is
      // worse than no entry, so take it back out before surfacing the failure.
      await deleteAsset(assetId).catch(() => {});
      throw err;
    }
  }

  return { assetId, storageUrl, deduped: false };
}

/**
 * Re-encode to WebP where that is a win, and fall back to the original bytes if it is not.
 *
 * Never fatal. A generation that has already cost a minute of compute and real money should not be
 * thrown away because an encoder hiccuped — storing the original PNG is worse than WebP and far better
 * than storing nothing.
 *
 * One consequence worth knowing: because the id is the hash of the *encoded* bytes, a future sharp
 * version that encodes differently would give the same source image a new asset id. That is a
 * duplicate row, not a broken one, and it is the cheaper end of the trade against `fileSizeBytes` and
 * the id describing something other than what is stored.
 */
async function toStorageFormat(
  bytes: Buffer,
  mimeType: StorableImageMimeType,
  reencode?: boolean
): Promise<{ bytes: Buffer; mimeType: StorableImageMimeType }> {
  if (!shouldReencodeToWebp(mimeType, reencode ?? true)) return { bytes, mimeType };

  try {
    const sharp = (await import('sharp')).default;
    // Quality 82 is the usual photographic sweet spot. Metadata is dropped by default, which is what
    // strips the C2PA provenance blocks and the embedded icon that bulk out a generated PNG.
    const webp = await sharp(bytes).webp({ quality: 82 }).toBuffer();
    // Trust the result only if it is actually smaller — for a flat or already-optimal image it may not
    // be, and there is no reason to take a lossy pass for a worse file.
    if (webp.length && webp.length < bytes.length) {
      console.log('[store-image-asset] re-encoded to webp', {
        from: bytes.length,
        to: webp.length,
        saved: `${Math.round((1 - webp.length / bytes.length) * 100)}%`,
      });
      return { bytes: webp, mimeType: 'image/webp' };
    }
    return { bytes, mimeType };
  } catch (err) {
    console.warn('[store-image-asset] webp re-encode failed, storing original', err);
    return { bytes, mimeType };
  }
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
