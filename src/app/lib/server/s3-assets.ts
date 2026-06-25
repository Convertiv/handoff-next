import { CloudFrontClient, CreateInvalidationCommand } from '@aws-sdk/client-cloudfront';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ── Config ────────────────────────────────────────────────────────────────────

export type S3AssetConfig = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  cdnUrl?: string;
  distributionId?: string;
};

function getConfig(): S3AssetConfig | null {
  const bucket = process.env.HANDOFF_S3_BUCKET;
  const region = process.env.HANDOFF_S3_REGION;
  const accessKeyId = process.env.HANDOFF_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.HANDOFF_S3_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    cdnUrl: process.env.HANDOFF_S3_CDN_URL,
    distributionId: process.env.HANDOFF_CLOUDFRONT_DISTRIBUTION_ID,
  };
}

export function isS3Configured(): boolean {
  return getConfig() !== null;
}

function makeS3Client(cfg: S3AssetConfig): S3Client {
  return new S3Client({
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

function makeCFClient(cfg: S3AssetConfig): CloudFrontClient {
  return new CloudFrontClient({
    region: 'us-east-1',
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
}

// ── URL helpers ───────────────────────────────────────────────────────────────

/**
 * Returns the public-facing URL for an S3 key.
 * Uses CDN domain when configured, otherwise falls back to the S3 bucket URL.
 */
export function getAssetPublicUrl(key: string, cfg: S3AssetConfig = getConfig()!): string {
  if (cfg.cdnUrl) return `${cfg.cdnUrl.replace(/\/$/, '')}/${key}`;
  return `https://${cfg.bucket}.s3.${cfg.region}.amazonaws.com/${key}`;
}

// ── Presigned upload ──────────────────────────────────────────────────────────

export type PresignResult = {
  uploadUrl: string;
  storageKey: string;
  publicUrl: string;
};

/**
 * Generate a presigned PUT URL. The caller uploads directly to S3 — the server
 * never handles the bytes.
 *
 * @param key      S3 object key (caller constructs, e.g. `assets/uuid.png`)
 * @param mimeType Content-Type for the PUT request
 * @param ttlSecs  URL expiry in seconds (default 300 = 5 minutes)
 */
export async function generatePresignedUploadUrl(
  key: string,
  mimeType: string,
  ttlSecs = 300
): Promise<PresignResult> {
  const cfg = getConfig();
  if (!cfg) throw new Error('S3 is not configured. Set HANDOFF_S3_BUCKET, HANDOFF_S3_REGION, HANDOFF_S3_ACCESS_KEY_ID, HANDOFF_S3_SECRET_ACCESS_KEY.');

  const client = makeS3Client(cfg);
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: mimeType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: ttlSecs });
  return { uploadUrl, storageKey: key, publicUrl: getAssetPublicUrl(key, cfg) };
}

// ── Server-side upload ────────────────────────────────────────────────────────

/**
 * Upload a buffer directly to S3 from the server (Lambda → S3).
 * Uses content-addressed caching headers — safe since all keys are immutable
 * hashes. Returns the public CDN URL for the object.
 */
export async function putToS3(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const cfg = getConfig();
  if (!cfg) throw new Error('S3 is not configured. Set HANDOFF_S3_BUCKET, HANDOFF_S3_REGION, HANDOFF_S3_ACCESS_KEY_ID, HANDOFF_S3_SECRET_ACCESS_KEY.');
  const s3 = makeS3Client(cfg);
  await s3.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    })
  );
  return getAssetPublicUrl(key, cfg);
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete an object from S3 and optionally invalidate its CloudFront path.
 * No-ops gracefully when S3 is not configured.
 */
export async function deleteAssetFromS3(key: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;

  const s3 = makeS3Client(cfg);
  await s3.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));

  if (cfg.distributionId) {
    await invalidateCloudFrontPaths(cfg, [`/${key}`]);
  }
}

// ── CloudFront invalidation ───────────────────────────────────────────────────

/**
 * Create a CloudFront invalidation for the given paths.
 * Silently no-ops when distributionId is not configured.
 */
export async function invalidateCloudFrontPaths(cfg: S3AssetConfig, paths: string[]): Promise<void> {
  if (!cfg.distributionId) return;
  const cf = makeCFClient(cfg);
  await cf.send(
    new CreateInvalidationCommand({
      DistributionId: cfg.distributionId,
      InvalidationBatch: {
        CallerReference: `handoff-${Date.now()}`,
        Paths: { Quantity: paths.length, Items: paths },
      },
    })
  );
}

/**
 * Invalidate a single asset key in CloudFront after an update/replace.
 */
export async function invalidateAsset(key: string): Promise<void> {
  const cfg = getConfig();
  if (!cfg?.distributionId) return;
  await invalidateCloudFrontPaths(cfg, [`/${key}`]);
}

// ── Key helpers ───────────────────────────────────────────────────────────────

/** Build a deterministic S3 key for an uploaded asset. */
export function buildAssetKey(assetId: string, filename: string): string {
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  return `assets/${assetId}${ext}`;
}

/** Build a thumbnail key derived from the asset key. */
export function buildThumbnailKey(assetId: string): string {
  return `assets/thumbs/${assetId}.png`;
}
