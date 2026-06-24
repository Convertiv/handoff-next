import crypto from 'crypto';
import fs from 'fs-extra';
import path from 'path';
import { ingestFigmaFillAsset } from '../db/queries';

type FigmaFillManifestEntry = {
  assetId: string;
  imageRef: string;
  filename: string;
  contentHash: string;
  mimeType: string;
};

type FigmaFillManifest = {
  figmaFileKey: string;
  fills: FigmaFillManifestEntry[];
};

const EXT_FROM_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

function buildFigmaApiHeaders(accessToken: string): HeadersInit {
  return /^Bearer\s+/i.test(accessToken.trim())
    ? { Authorization: accessToken.trim() }
    : { 'X-Figma-Token': accessToken.trim() };
}

/**
 * Stream all image fills for a Figma file directly from the Figma CDN into the DB asset
 * store — no disk writes. Used by the server-side fetch runner where Lambda /tmp is
 * constrained; bypasses the disk-based fetchAndSaveFigmaImageFills + ingestFigmaFillsFromManifest
 * two-step that would buffer all 1000+ fills on disk simultaneously.
 */
export async function streamFigmaFillsToDb(
  fileKey: string,
  accessToken: string,
  userId: string | null | undefined,
): Promise<{ ingested: number; skipped: number }> {
  const headers = buildFigmaApiHeaders(accessToken);
  let imageMap: Record<string, string>;
  try {
    const resp = await fetch(`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/images`, { headers });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.warn(`[figma-fills] GET /files/${fileKey}/images failed (${resp.status}): ${text.slice(0, 200)}`);
      return { ingested: 0, skipped: 0 };
    }
    const json = (await resp.json()) as { err?: string | null; meta?: { images?: Record<string, string> } };
    if (json.err) {
      console.warn(`[figma-fills] Figma error: ${json.err}`);
      return { ingested: 0, skipped: 0 };
    }
    imageMap = json.meta?.images ?? {};
  } catch (e) {
    console.warn(`[figma-fills] Network error fetching image map: ${e instanceof Error ? e.message : String(e)}`);
    return { ingested: 0, skipped: 0 };
  }

  const refs = Object.entries(imageMap).filter(([, url]) => typeof url === 'string' && url.startsWith('http'));
  if (refs.length === 0) return { ingested: 0, skipped: 0 };

  console.log(`[figma-fills] Streaming ${refs.length} image fill(s) directly to DB (concurrency=5)…`);

  let ingested = 0;
  let skipped = 0;
  const queue = [...refs];
  const CONCURRENCY = 5;
  const PER_IMAGE_TIMEOUT_MS = 15_000;

  async function worker() {
    while (queue.length > 0) {
      const entry = queue.shift();
      if (!entry) break;
      const [imageRef, cdnUrl] = entry;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PER_IMAGE_TIMEOUT_MS);
        let imgResp: Response;
        try {
          imgResp = await fetch(cdnUrl, { signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }
        if (!imgResp.ok) {
          console.warn(`[figma-fills] Download failed for ${imageRef} (${imgResp.status})`);
          skipped++;
          continue;
        }
        const rawMime = imgResp.headers.get('content-type')?.split(';')[0].trim() ?? 'image/png';
        const mimeType = EXT_FROM_MIME[rawMime] ? rawMime : 'image/png';
        const ext = EXT_FROM_MIME[mimeType] ?? 'png';
        const buffer = Buffer.from(await imgResp.arrayBuffer());
        const contentHash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 12);
        const assetId = `img_${contentHash}`;
        const safeRef = imageRef.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
        const filename = `${safeRef}.${ext}`;
        await ingestFigmaFillAsset({
          assetId,
          filename,
          mimeType,
          contentHash,
          dataBase64: buffer.toString('base64'),
          figmaFileKey: fileKey,
          figmaImageRef: imageRef,
          userId: userId ?? null,
        });
        ingested++;
      } catch (e) {
        console.warn(`[figma-fills] Error streaming ${imageRef}: ${e instanceof Error ? e.message : String(e)}`);
        skipped++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, refs.length) }, worker));
  console.log(`[figma-fills] Streamed ${ingested}/${refs.length} fill(s) to DB.`);
  return { ingested, skipped };
}

/**
 * Read the Figma image fills manifest written by `fetchAndSaveFigmaImageFills` during the
 * fetch step and ingest each image directly into the DB asset store.
 *
 * This is the worker-side counterpart to `pushFigmaImageFills` — it bypasses the HTTP
 * ingest endpoint and calls the DB directly, which is appropriate inside the fetch worker
 * process that already has a DB connection.
 */
export async function ingestFigmaFillsFromManifest(
  outputPath: string,
  userId: string | null | undefined,
): Promise<{ ingested: number; skipped: number }> {
  const fillsDir = path.join(outputPath, 'figma-fills');
  const manifestPath = path.join(fillsDir, 'fills.json');

  if (!(await fs.pathExists(manifestPath))) {
    return { ingested: 0, skipped: 0 };
  }

  const manifest = (await fs.readJson(manifestPath)) as FigmaFillManifest;
  if (!Array.isArray(manifest.fills) || manifest.fills.length === 0) {
    return { ingested: 0, skipped: 0 };
  }

  let ingested = 0;
  let skipped = 0;

  for (const fill of manifest.fills) {
    const filePath = path.join(fillsDir, fill.filename);
    if (!(await fs.pathExists(filePath))) {
      skipped++;
      continue;
    }
    try {
      const bytes = await fs.readFile(filePath);
      await ingestFigmaFillAsset({
        assetId: fill.assetId,
        filename: fill.filename,
        mimeType: fill.mimeType,
        contentHash: fill.contentHash,
        dataBase64: bytes.toString('base64'),
        figmaFileKey: manifest.figmaFileKey,
        figmaImageRef: fill.imageRef,
        userId: userId ?? null,
      });
      ingested++;
    } catch (e) {
      console.error(`[figma-fills-ingest] Failed to ingest ${fill.imageRef}:`, e instanceof Error ? e.message : String(e));
      skipped++;
    }
  }

  return { ingested, skipped };
}
