import 'server-only';

import { after } from 'next/server';
import { runDevHandoff } from '@/lib/server/dev-handoff';
import { generateSpecForArtifact } from '@/lib/server/design-spec-generator';

/**
 * Queue the full dev handoff (extract assets → generate specification) after the HTTP response
 * is sent.
 *
 * Both steps run inside one `after()` callback so the specification starts the instant
 * extraction finishes, and both are sequenced by `runDevHandoff` so every entry point — the
 * design-artifact route, the MCP tools, the lifecycle transition — gets identical behavior and
 * one error surface. `runDevHandoff` never throws.
 *
 * NOTE: `after()` is bounded by the invocation. If the function is torn down mid-flight the row
 * is left non-terminal, which the design-jobs cron reaper sweeps within 15 minutes. The
 * extraction step additionally self-fails at 240s. See DEVLOG 2026-07-28.
 */
export function scheduleDesignAssetExtraction(artifactId: string): void {
  after(() => {
    void runDevHandoff(artifactId);
  });
}

/** Alias that says what it does at the call site. Prefer this in new code. */
export const scheduleDevHandoff = scheduleDesignAssetExtraction;

/** Trigger specification (re-)generation only, without re-running asset extraction. */
export function scheduleSpecGeneration(artifactId: string): void {
  after(() => {
    void generateSpecForArtifact(artifactId).catch((err) => {
      console.error('[design-asset-schedule] spec generation failed', artifactId, err);
    });
  });
}
