/**
 * Decoding and identifying image bytes.
 *
 * Pure, and its own module, because the thing that needs it (`server/store-image-asset.ts`) is
 * `server-only` and cannot be imported by the test runner — the same split as `url-safety.ts` and
 * `composition-summary.ts`. Separation rather than weakening the marker.
 */

import crypto from 'node:crypto';

/**
 * What we are willing to store.
 *
 * A deny-by-default list rather than trusting a declared content type: these bytes come from an image
 * model or a remote URL, get written to a public-read bucket, and are served back with that type. An
 * `image/svg+xml` in that position is a stored XSS, which is why SVG is absent despite being an image
 * the asset library otherwise supports (it has a dedicated `svgContent` column and its own path).
 */
export const STORABLE_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type StorableImageMimeType = (typeof STORABLE_IMAGE_MIME_TYPES)[number];

export function isStorableImageMimeType(value: unknown): value is StorableImageMimeType {
  return typeof value === 'string' && (STORABLE_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** Extension for a filename. Only ever called with a type that passed the check above. */
export function extensionForMimeType(mimeType: StorableImageMimeType): string {
  return mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
}

export interface DecodedImage {
  bytes: Buffer;
  mimeType: StorableImageMimeType;
}

/**
 * Decode the `data:image/png;base64,...` string `openAiImageEdit` returns.
 *
 * Returns null rather than throwing for anything unusable — a caller mid-generation wants to record a
 * failed job, not unwind. Rejects a declared type we do not store, and rejects empty payloads, which
 * are the shape a truncated or errored response takes.
 */
export function decodeImageDataUrl(value: unknown): DecodedImage | null {
  if (typeof value !== 'string') return null;
  // `[\s\S]` rather than `.` with the `s` flag: the tsconfig target predates dotall, and real payloads
  // do arrive line-wrapped.
  const match = /^data:([a-z0-9.+/-]+);base64,([\s\S]*)$/i.exec(value.trim());
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  if (!isStorableImageMimeType(mimeType)) return null;

  // Base64 decoding is famously permissive — it discards junk rather than failing — so the round-trip
  // below is the actual validation. Without it, a mangled payload becomes a stored, unopenable file.
  const payload = match[2].replace(/\s+/g, '');
  if (!payload) return null;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(payload, 'base64');
  } catch {
    return null;
  }
  if (!bytes.length || bytes.toString('base64').replace(/=+$/, '') !== payload.replace(/=+$/, '')) return null;

  return { bytes, mimeType };
}

/**
 * Should these bytes be re-encoded to WebP before storing?
 *
 * Generated PNGs are enormous — a 1536x1024 from the image model runs 2-3MB, and with no S3 configured
 * that becomes 3-4MB of base64 in a Postgres row, which is the pattern already identified as the
 * workbench's performance root cause. WebP at photographic quality is roughly a tenth of that, and
 * re-encoding drops the C2PA provenance blocks and embedded icon that make up a visible slice of the
 * original.
 *
 * Two things it must not do. Re-encoding WebP to WebP is a second lossy pass for no gain. And lossy
 * compression is wrong for authored artwork — a logo or a screenshot with text should be stored as
 * given, which is why callers can opt out rather than this being unconditional.
 */
/**
 * Copy bytes onto a backing store the AWS SDK will accept.
 *
 * **The bug this fixes.** `@smithy/core`'s `toBase64` — reached whenever the SDK base64s a body or a
 * checksum — does this, with no `Buffer.isBuffer` short-circuit:
 *
 * ```js
 * return fromArrayBuffer(input.buffer, input.byteOffset, input.byteLength).toString('base64');
 * ```
 *
 * and `fromArrayBuffer` throws on anything failing `instanceof ArrayBuffer`:
 *
 *     The "input" argument must be ArrayBuffer. Received type object ([object SharedArrayBuffer])
 *
 * A `Buffer` whose backing store is a **SharedArrayBuffer** is a completely valid Buffer, so nothing in
 * our code is wrong — but the SDK rejects it. Whether Node's Buffer pool is shared depends on the
 * runtime: it is a plain ArrayBuffer on a normal local Node (which is why this reproduces only on some
 * deployments and never in dev), and the bytes here pass through OpenAI, base64, and sharp before
 * reaching S3, any of which may hand back a pooled Buffer.
 *
 * Cheapest correct fix: hand the SDK bytes we allocated ourselves. `Buffer.from(new ArrayBuffer(n))` is a
 * view over a plain ArrayBuffer by construction, so the check cannot fail. The copy is skipped entirely
 * when the backing store is already fine, which is the normal case.
 */
export function toPlainBuffer(bytes: Buffer | Uint8Array): Buffer {
  // `instanceof` is the same test the SDK applies, so agreeing with it is the point.
  if (Buffer.isBuffer(bytes) && bytes.buffer instanceof ArrayBuffer) return bytes;

  const copy = Buffer.from(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

export function shouldReencodeToWebp(mimeType: StorableImageMimeType, requested = true): boolean {
  if (!requested) return false;
  return mimeType === 'image/png' || mimeType === 'image/jpeg';
}

/**
 * Content-addressed id, matching the `img_<hash>` convention the Figma ingest already established.
 *
 * Addressing by content means generating the same image twice costs one row, and re-running a failed
 * job is idempotent rather than a duplicate. 12 hex chars of SHA-256 — the same width used elsewhere,
 * and collision risk is irrelevant at asset-library scale.
 */
export function assetIdForBytes(bytes: Buffer): string {
  return `img_${contentHashForBytes(bytes).slice(0, 12)}`;
}

export function contentHashForBytes(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}
