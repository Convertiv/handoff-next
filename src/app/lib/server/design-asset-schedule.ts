import 'server-only';

import { after } from 'next/server';
import { runDesignAssetExtractionForArtifact } from '@/lib/server/design-asset-extractor';
import { generateSpecForArtifact } from '@/lib/server/design-spec-generator';

/**
 * Queue extraction after the HTTP response is sent, then spec generation once extraction finishes.
 * Both run in the same `after()` callback so spec generation starts immediately when extraction completes.
 */
export function scheduleDesignAssetExtraction(artifactId: string): void {
  after(() => {
    void (async () => {
      try {
        await runDesignAssetExtractionForArtifact(artifactId);
      } catch (err) {
        console.error('[design-asset-schedule] extraction failed', artifactId, err);
      }
      // Queue spec generation regardless of extraction success — we can generate from the
      // original image even if individual layer extraction partially failed.
      try {
        await generateSpecForArtifact(artifactId);
      } catch (err) {
        console.error('[design-asset-schedule] spec generation failed', artifactId, err);
      }
    })();
  });
}

/** Trigger spec (re-)generation for an existing artifact without re-running extraction. */
export function scheduleSpecGeneration(artifactId: string): void {
  after(() => {
    void generateSpecForArtifact(artifactId).catch((err) => {
      console.error('[design-asset-schedule] spec generation failed', artifactId, err);
    });
  });
}
