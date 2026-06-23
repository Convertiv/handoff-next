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
