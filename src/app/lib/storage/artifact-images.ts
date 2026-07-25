import 'server-only';
import { put } from '@vercel/blob';

/**
 * Phase 1 (Workbench/Playground roadmap): move design-artifact images OUT of
 * Postgres and into Vercel Blob. Base64 data URLs stored inline in JSONB
 * (`imageUrl`, `sourceImages[].dataUrl`, `conversationHistory[].imageUrl`,
 * `assets[].imageUrl`) were the root cause of multi-MB rows and slow reads.
 *
 * Serving model (chosen 2026-07-24): `access: 'public'` with a random suffix, so
 * the blob URL is unguessable (knowing an artifact's UUID is not enough to reach
 * its images). The URL is stored directly in the same column, so readers render
 * it as-is — no proxy, no read-path rewrite.
 *
 * Graceful degradation: when `BLOB_READ_WRITE_TOKEN` is absent (local dev /
 * workspace mode) or an upload fails, values pass through UNCHANGED (inline data
 * URL preserved). Offloading must never block a save.
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
 * Upload one data URL to Blob and return its public CDN URL. Passthrough (returns
 * the input unchanged) when it's not a data URL, Blob isn't configured, or the
 * upload fails.
 */
export async function offloadDataUrl(value: string, keyHint: string): Promise<string> {
  if (!isDataUrl(value) || !blobEnabled()) return value;
  const parsed = parseDataUrl(value);
  if (!parsed) return value;
  try {
    const res = await put(`design-artifacts/${keyHint}.${parsed.ext}`, parsed.buffer, {
      access: 'public',
      addRandomSuffix: true,
      contentType: parsed.contentType,
    });
    return res.url;
  } catch (err) {
    console.warn(
      '[handoff] blob offload failed, keeping inline data URL:',
      err instanceof Error ? err.message : String(err)
    );
    return value;
  }
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
