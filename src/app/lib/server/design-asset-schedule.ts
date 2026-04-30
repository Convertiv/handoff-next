import 'server-only';

import { after } from 'next/server';
import { runDesignAssetExtractionForArtifact } from '@/lib/server/design-asset-extractor';

/**
 * Runs asset extraction after the HTTP response is sent. Prefer this over spawning a
 * separate process (spawn often fails when cwd/repo root or `tsx` paths do not match).
 */
export function scheduleDesignAssetExtraction(artifactId: string): void {
  after(() => {
    void runDesignAssetExtractionForArtifact(artifactId).catch((err) => {
      console.error('[design-asset-schedule] extraction failed', artifactId, err);
    });
  });
}
