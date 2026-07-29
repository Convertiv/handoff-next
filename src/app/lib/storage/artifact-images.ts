import 'server-only';
import { get, put } from '@vercel/blob';

/**
 * Phase 1 (Workbench/Playground roadmap): move design-artifact images OUT of
 * Postgres and into Vercel Blob. Base64 data URLs stored inline in JSONB
 * (`imageUrl`, `sourceImages[].dataUrl`, `conversationHistory[].imageUrl`,
 * `assets[].imageUrl`) were the root cause of multi-MB rows and slow reads.
 *
 * **Serving model: PRIVATE store + authorizing proxy** (corrected 2026-07-29).
 *
 * An earlier revision of this header claimed `access: 'public'` with a random suffix was the chosen
 * model. That was wrong — private stores were the decision, and 8x8's store is configured private.
 * The mismatch meant every `put` threw *"Cannot use public access on a private store"*, the catch
 * below swallowed it, and **no artifact image ever reached Blob**: rows stayed at ~6.4MB of inline
 * base64, which is what made every downstream timing marginal.
 *
 * Private is also the only coherent choice: the Library enforces visibility lanes, per-user grants
 * and share links, and public blob URLs would bypass all of it permanently.
 *
 * What we persist is therefore NOT the blob URL but a proxy URL
 * (`/api/handoff/artifact-asset?p=<pathname>`), so:
 *   - anything rendering `<img src={imageUrl}>` keeps working with no change
 *   - the proxy authorizes each read against the owning artifact's permissions
 *   - server-side consumers short-circuit to `readBlobAsDataUrl()` and skip HTTP entirely
 *
 * Graceful degradation: when `BLOB_READ_WRITE_TOKEN` is absent (local dev / workspace mode) or an
 * upload fails, values pass through UNCHANGED (inline data URL preserved). Offloading must never
 * block a save.
 */

export function blobEnabled(): boolean {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}

export function isDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('data:');
}

function contentTypeToExt(ct: string): string {
  switch (ct) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/svg+xml':
      return 'svg';
    case 'image/avif':
      return 'avif';
    default:
      return 'bin';
  }
}

function parseDataUrl(dataUrl: string): { contentType: string; buffer: Buffer; ext: string } | null {
  const m = /^data:([^;,]+)?((?:;[^,]*)*),([\s\S]*)$/i.exec(dataUrl);
  if (!m) return null;
  const contentType = (m[1] || 'application/octet-stream').toLowerCase();
  const meta = m[2] || '';
  const body = m[3] || '';
  const isBase64 = /;base64/i.test(meta);
  try {
    const buffer = isBase64 ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'utf8');
    return { contentType, buffer, ext: contentTypeToExt(contentType) };
  } catch {
    return null;
  }
}

/**
 * Route that streams a private blob back out. Stored in place of the image itself, so anything
 * that puts the value straight into `<img src>` keeps working unchanged.
 */
export const ARTIFACT_ASSET_ROUTE = '/api/handoff/artifact-asset';

/** Build the proxy URL we persist for a stored blob. */
export function artifactAssetProxyUrl(pathname: string): string {
  return `${ARTIFACT_ASSET_ROUTE}?p=${encodeURIComponent(pathname)}`;
}

/** Recover the blob pathname from a stored proxy URL. Null when this isn't one. */
export function blobPathnameFromProxyUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.includes(ARTIFACT_ASSET_ROUTE)) return null;
  const q = value.indexOf('?');
  if (q === -1) return null;
  const p = new URLSearchParams(value.slice(q + 1)).get('p');
  return p?.trim() || null;
}

/**
 * The artifact a blob belongs to, from its pathname.
 *
 * Paths are written as `design-artifacts/<artifactId>/<slot>-<random>.<ext>`, so the owning
 * artifact is the second segment. This is what lets the proxy route authorize a read against the
 * artifact's own permissions instead of trusting possession of the URL.
 */
export function artifactIdFromBlobPathname(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 3 || parts[0] !== 'design-artifacts') return null;
  return parts[1] || null;
}

/**
 * Upload one data URL to Blob and return the proxy URL to persist.
 *
 * **Private access, deliberately.** Artifact images are client design work, and the Library's
 * visibility lanes / grants / share links would be meaningless if the underlying images were
 * publicly readable by URL forever. Writing `access: 'public'` against a private store is also
 * exactly the bug that silently kept every 8x8 artifact inline as base64 (see DEVLOG 2026-07-29).
 *
 * Passthrough (returns the input unchanged) when it's not a data URL, Blob isn't configured, or
 * the upload fails — but a failure now also throws a visible warning rather than being invisible.
 */
export async function offloadDataUrl(value: string, keyHint: string): Promise<string> {
  if (!isDataUrl(value) || !blobEnabled()) return value;
  const parsed = parseDataUrl(value);
  if (!parsed) return value;
  try {
    const res = await put(`design-artifacts/${keyHint}.${parsed.ext}`, parsed.buffer, {
      access: 'private',
      addRandomSuffix: true,
      contentType: parsed.contentType,
    });
    return artifactAssetProxyUrl(res.pathname);
  } catch (err) {
    console.warn(
      '[handoff] blob offload failed, keeping inline data URL:',
      err instanceof Error ? err.message : String(err)
    );
    return value;
  }
}

/** A private blob's bytes plus the metadata a caller needs to serve or inline it. */
export type BlobRead = { buffer: Buffer; contentType: string };

/**
 * Read a private blob by pathname. Returns null when Blob is off, the object is missing, or the
 * read fails — callers degrade rather than throw, matching the write path.
 */
export async function readPrivateBlob(pathname: string): Promise<BlobRead | null> {
  if (!blobEnabled()) return null;
  try {
    const res = await get(pathname, { access: 'private' });
    if (res.statusCode !== 200) return null;
    const buffer = Buffer.from(await new Response(res.stream).arrayBuffer());
    return { buffer, contentType: res.blob.contentType || 'application/octet-stream' };
  } catch (err) {
    console.warn('[handoff] private blob read failed:', pathname, err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Resolve a stored image value to something a server-side AI call can consume.
 *
 * Private blobs are not fetchable over plain HTTP, so every server-side consumer
 * (`imageUrlToVisionPart`, `imageUrlToEditInput`) must come through here rather than fetching the
 * stored URL. Returns the value untouched when it isn't a proxy URL — data URLs and ordinary http
 * URLs keep working, which is what lets old rows and new ones coexist.
 */
export async function resolveStoredImage(value: string): Promise<string> {
  const pathname = blobPathnameFromProxyUrl(value);
  if (!pathname) return value;
  const read = await readPrivateBlob(pathname);
  if (!read) return value;
  return `data:${read.contentType};base64,${read.buffer.toString('base64')}`;
}

export type ArtifactImageFields = {
  imageUrl?: string;
  sourceImages?: unknown;
  conversationHistory?: unknown;
  assets?: unknown;
};

async function offloadArrayField(
  arr: unknown,
  urlKey: 'dataUrl' | 'imageUrl',
  keyBase: string,
  slot: string
): Promise<unknown> {
  if (!Array.isArray(arr)) return arr;
  return Promise.all(
    arr.map(async (item, i) => {
      if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        const current = rec[urlKey];
        if (isDataUrl(current)) {
          return { ...rec, [urlKey]: await offloadDataUrl(current, `${keyBase}/${slot}-${i}`) };
        }
      }
      return item;
    })
  );
}

/**
 * Offload every inline image on the image-bearing subset of a design artifact.
 * Returns a new object with data URLs replaced by Blob URLs; non-image and
 * already-offloaded fields are untouched. Fast no-op when Blob is disabled.
 * `keyBase` should be the artifact id (a UUID) so paths are scoped + unguessable.
 */
export async function offloadArtifactImages<T extends ArtifactImageFields>(fields: T, keyBase: string): Promise<T> {
  if (!blobEnabled()) return fields;
  const out: T = { ...fields };
  if (typeof fields.imageUrl === 'string' && isDataUrl(fields.imageUrl)) {
    out.imageUrl = await offloadDataUrl(fields.imageUrl, `${keyBase}/image`);
  }
  if (fields.sourceImages !== undefined) {
    out.sourceImages = await offloadArrayField(fields.sourceImages, 'dataUrl', keyBase, 'source');
  }
  if (fields.conversationHistory !== undefined) {
    out.conversationHistory = await offloadArrayField(fields.conversationHistory, 'imageUrl', keyBase, 'turn');
  }
  if (fields.assets !== undefined) {
    out.assets = await offloadArrayField(fields.assets, 'imageUrl', keyBase, 'asset');
  }
  return out;
}
