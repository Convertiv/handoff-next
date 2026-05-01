/**
 * Standalone worker: `npx tsx src/app/lib/server/design-asset-worker.ts <artifactId>`
 * Run from handoff-app repo root with DATABASE_URL or local SQLite + HANDOFF_AI_API_KEY.
 */
import { runDesignAssetExtractionForArtifact } from './design-asset-extractor';
import { getDb } from '../db';

async function main() {
  const artifactId = process.argv[2]?.trim();
  if (!artifactId) {
    console.error('Usage: tsx design-asset-worker.ts <artifactId>');
    process.exit(1);
  }

  getDb();

  await runDesignAssetExtractionForArtifact(artifactId);
  process.exit(0);
}

main().catch((err) => {
  console.error('[design-asset-worker]', err);
  process.exit(1);
});
