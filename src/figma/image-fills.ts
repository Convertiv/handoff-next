import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { Logger } from '@handoff/utils/logger';

function cleanToken(value: string | undefined | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildFigmaApiHeaders(accessToken: string | undefined | null): HeadersInit | null {
  const token = cleanToken(accessToken);
  if (!token) return null;
  if (/^Bearer\s+/i.test(token)) return { Authorization: token };
  return { 'X-Figma-Token': token };
}

const EXT_FROM_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

export type FigmaFillManifestEntry = {
  assetId: string;
  imageRef: string;
  filename: string;
  contentHash: string;
  mimeType: string;
};

export type FigmaFillManifest = {
  figmaFileKey: string;
  fetchedAt: string;
  fills: FigmaFillManifestEntry[];
};

/**
 * Fetch all image fill CDN URLs from a Figma library file, download each image,
 * content-address it, and write results to `{outputDir}/figma-fills/`.
 *
 * Uses GET /v1/files/{file_key}/images, which returns CDN URLs for every image
 * fill referenced in the file (distinct from /v1/images which exports node renders).
 * @see https://www.figma.com/developers/api#get-file-images-endpoint
 */
export async function fetchAndSaveFigmaImageFills(
  fileKey: string | undefined | null,
  accessToken: string | undefined | null,
  outputDir: string,
): Promise<FigmaFillManifest | null> {
  const headers = buildFigmaApiHeaders(accessToken);
  const fk = cleanToken(fileKey);

  if (!headers || !fk) {
    Logger.warn('[figma-image-fills] Missing fileKey or accessToken — skipping image fill fetch.');
    return null;
  }

  let imageMap: Record<string, string>;
  try {
    const resp = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fk)}/images`, { headers });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      Logger.warn(`[figma-image-fills] GET /v1/files/${fk}/images failed (${resp.status}): ${text.slice(0, 200)}`);
      return null;
    }
    const json = (await resp.json()) as { err?: string | null; meta?: { images?: Record<string, string> } };
    if (json.err) {
      Logger.warn(`[figma-image-fills] Figma error: ${json.err}`);
      return null;
    }
    imageMap = json.meta?.images ?? {};
  } catch (e) {
    Logger.warn(`[figma-image-fills] Network error: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }

  const refs = Object.entries(imageMap).filter(([, url]) => typeof url === 'string' && url.startsWith('http'));

  if (refs.length === 0) {
    Logger.info('[figma-image-fills] No image fills found in file.');
    const empty: FigmaFillManifest = { figmaFileKey: fk, fetchedAt: new Date().toISOString(), fills: [] };
    const fillsDir = path.join(outputDir, 'figma-fills');
    await fs.ensureDir(fillsDir);
    await fs.writeJSON(path.join(fillsDir, 'fills.json'), empty, { spaces: 2 });
    return empty;
  }

  Logger.info(`[figma-image-fills] Found ${refs.length} image fill(s) — downloading…`);

  const fillsDir = path.join(outputDir, 'figma-fills');
  await fs.ensureDir(fillsDir);

  const fills: FigmaFillManifestEntry[] = [];

  for (const [imageRef, cdnUrl] of refs) {
    try {
      const imgResp = await fetch(cdnUrl);
      if (!imgResp.ok) {
        Logger.warn(`[figma-image-fills] Download failed for ref ${imageRef} (${imgResp.status})`);
        continue;
      }
      const rawMime = imgResp.headers.get('content-type')?.split(';')[0].trim() ?? 'image/png';
      const mimeType = EXT_FROM_MIME[rawMime] ? rawMime : 'image/png';
      const ext = EXT_FROM_MIME[mimeType] ?? 'png';

      const buffer = Buffer.from(await imgResp.arrayBuffer());
      const contentHash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
      const assetId = `img_${contentHash}`;
      // Sanitize imageRef for use as a filename (Figma refs contain colons, slashes, etc.)
      const safeRef = imageRef.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
      const filename = `${safeRef}.${ext}`;

      await fs.writeFile(path.join(fillsDir, filename), buffer);
      fills.push({ assetId, imageRef, filename, contentHash, mimeType });
    } catch (e) {
      Logger.warn(`[figma-image-fills] Error processing ${imageRef}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const manifest: FigmaFillManifest = {
    figmaFileKey: fk,
    fetchedAt: new Date().toISOString(),
    fills,
  };

  await fs.writeJSON(path.join(fillsDir, 'fills.json'), manifest, { spaces: 2 });
  Logger.success(`[figma-image-fills] Saved ${fills.length}/${refs.length} image fill(s).`);
  return manifest;
}
