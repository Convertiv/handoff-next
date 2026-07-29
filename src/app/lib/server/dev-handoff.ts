import 'server-only';

import { getDesignArtifactById, updateDesignArtifactById } from '@/lib/db/queries';
import { runDesignAssetExtractionForArtifact } from '@/lib/server/design-asset-extractor';
import { generateSpecForArtifact } from '@/lib/server/design-spec-generator';

/**
 * "Transition to Dev" — the single operation that takes a design artifact from a picture to
 * something a developer can build from.
 *
 * Before this existed, asset extraction and spec generation were two independent pipelines with
 * two statuses, two pollers and two failure surfaces. That split is exactly how spec generation
 * stayed silently broken for seven weeks while extraction worked fine: nothing ever asked the
 * one question that matters — *is this design ready for dev?*
 *
 * The two underlying steps are unchanged and still own their own status columns; this module
 * sequences them, gives them one error surface, and derives one answer from the pair. Deriving
 * rather than adding a third status column keeps the stage record in one place and means there
 * is no new field to drift out of sync.
 */

// ── Derived status ────────────────────────────────────────────────────────────

export type DevHandoffStage = 'not_started' | 'extracting_assets' | 'generating_spec' | 'ready' | 'failed';

export interface DevHandoffStatus {
  stage: DevHandoffStage;
  /** Work is in flight — callers should keep polling. */
  running: boolean;
  /** Coarse 0–1 progress for a progress bar. */
  progress: number;
  /** Short human label for the current stage. */
  label: string;
  /** Why it failed. Null unless stage is `failed`. */
  error: string | null;
  /**
   * Set when the handoff completed but something degraded — most commonly extraction failing
   * while the spec still generated from the original image. Worth surfacing, not worth failing.
   */
  warning: string | null;
  assetsStatus: string;
  specStatus: string;
}

const ASSETS_RUNNING = new Set(['pending', 'extracting']);
const SPEC_RUNNING = new Set(['pending', 'generating']);

function metaString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>)[key];
  return typeof v === 'string' && v.trim() ? v : null;
}

/**
 * Collapse the two underlying statuses into one answer.
 *
 * Ordering matters: extraction runs first, so an in-flight extraction wins over whatever the
 * spec column says. A `done` spec means ready even if extraction failed, because spec generation
 * deliberately falls back to the original composite image.
 */
export function deriveDevHandoffStatus(args: {
  assetsStatus: string | null | undefined;
  specStatus: string | null | undefined;
  metadata?: unknown;
}): DevHandoffStatus {
  const assetsStatus = (args.assetsStatus ?? 'none').trim() || 'none';
  const specStatus = (args.specStatus ?? 'none').trim() || 'none';
  const assetsError = metaString(args.metadata, 'assetsExtractionError');
  const specError = metaString(args.metadata, 'specError');

  const base = { assetsStatus, specStatus };

  if (assetsStatus === 'none' && specStatus === 'none') {
    return {
      ...base,
      stage: 'not_started',
      running: false,
      progress: 0,
      label: 'Not started',
      error: null,
      warning: null,
    };
  }

  if (ASSETS_RUNNING.has(assetsStatus)) {
    return {
      ...base,
      stage: 'extracting_assets',
      running: true,
      progress: assetsStatus === 'pending' ? 0.1 : 0.35,
      label: 'Extracting assets',
      error: null,
      warning: null,
    };
  }

  if (SPEC_RUNNING.has(specStatus)) {
    return {
      ...base,
      stage: 'generating_spec',
      running: true,
      progress: specStatus === 'pending' ? 0.55 : 0.75,
      label: 'Generating specification',
      error: null,
      warning: assetsStatus === 'failed' ? assetsError ?? 'Asset extraction failed; specifying from the original image.' : null,
    };
  }

  if (specStatus === 'done') {
    return {
      ...base,
      stage: 'ready',
      running: false,
      progress: 1,
      label: 'Ready for dev',
      error: null,
      warning: assetsStatus === 'failed' ? assetsError ?? 'Asset extraction failed — the spec was generated from the original image.' : null,
    };
  }

  if (specStatus === 'failed' || assetsStatus === 'failed') {
    return {
      ...base,
      stage: 'failed',
      running: false,
      progress: 0,
      label: 'Failed',
      error: specError ?? assetsError ?? 'The dev handoff failed without recording a reason.',
      warning: null,
    };
  }

  // Assets done, spec never started — the pre-unification state of every existing artifact.
  return {
    ...base,
    stage: 'not_started',
    running: false,
    progress: assetsStatus === 'done' ? 0.4 : 0,
    label: assetsStatus === 'done' ? 'Assets extracted — no specification yet' : 'Not started',
    error: null,
    warning: null,
  };
}

/** Convenience: derive straight from an artifact row. */
export function devHandoffStatusForRow(row: {
  assetsStatus?: string | null;
  specStatus?: string | null;
  metadata?: unknown;
}): DevHandoffStatus {
  return deriveDevHandoffStatus({
    assetsStatus: row.assetsStatus,
    specStatus: row.specStatus,
    metadata: row.metadata,
  });
}

// ── The operation ─────────────────────────────────────────────────────────────

export interface StartDevHandoffResult {
  ok: boolean;
  error?: string;
  status?: DevHandoffStatus;
}

/** The stages a dev handoff can run. Selection is explicit — see DEFAULT_STAGES. */
export type DevHandoffStageName = 'assets' | 'spec';

/**
 * Stages run by default.
 *
 * **Asset extraction is deliberately excluded.** It has never once succeeded on a live registry
 * (8x8: five `none`, one `failed`, zero assets across every artifact), and because both stages share
 * one invocation it does active harm — it consumed 120s of a 270s budget and left specification 56s,
 * which then self-failed. Running a stage with no successful history at the cost of the stage that
 * works is the wrong trade.
 *
 * This is a **temporary default tied to the extraction rebuild** (`docs/ASSET-EXTRACTION-REDESIGN.md`):
 * the current path asks an image model to re-generate assets rather than extracting them, so it
 * cannot produce faithful, right-sized output at any budget. Flip this back to
 * `['assets', 'spec']` once extraction is geometry-based — and once stages have their own
 * invocations (`docs/WORKBENCH-STRATEGY.md` §9), at which point the two can no longer starve
 * each other and this trade-off disappears.
 */
const DEFAULT_STAGES: readonly DevHandoffStageName[] = ['spec'];

/**
 * Reset the statuses for the stages about to run, so the derived status reads as in-flight the
 * instant the caller returns. Doing this synchronously (rather than inside the background task) is
 * what makes the UI and MCP poll paths honest — otherwise a caller can poll before the work starts
 * and see a stale `ready` from the previous run.
 *
 * Only the selected stages are touched. A spec-only run resets `assetsStatus` to `none` and drops
 * any stale extraction error: this pass did not attempt extraction, so surfacing a previous run's
 * failure would misreport what just happened.
 */
export async function markDevHandoffQueued(
  artifactId: string,
  opts: { clearAssets: boolean; stages?: readonly DevHandoffStageName[] }
): Promise<boolean> {
  const stages = opts.stages ?? DEFAULT_STAGES;
  const runAssets = stages.includes('assets');
  const runSpec = stages.includes('spec');

  const patch: Record<string, unknown> = {};
  if (runAssets) {
    patch.assetsStatus = 'pending';
    if (opts.clearAssets) patch.assets = [];
  } else {
    patch.assetsStatus = 'none';
  }
  if (runSpec) patch.specStatus = 'pending';

  // Clear stale errors so a retry doesn't display the previous failure's reason.
  const existing = await getDesignArtifactById(artifactId);
  if (!existing) return false;
  if (existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)) {
    const meta = { ...(existing.metadata as Record<string, unknown>) };
    delete meta.assetsExtractionError;
    if (runSpec) delete meta.specError;
    patch.metadata = meta;
  }

  return updateDesignArtifactById(artifactId, patch as Parameters<typeof updateDesignArtifactById>[1]);
}

/**
 * Total wall-clock budget for the whole handoff, sized to sit under the hosting route's
 * `maxDuration = 300` with headroom for the surrounding request.
 *
 * Both steps run in ONE `after()` callback, so they share a single invocation lifetime — the two
 * timeouts cannot be chosen independently. Observed live on 8x8 (2026-07-28): a 240s extraction
 * bound against a 300s budget left spec generation ~60s, the invocation was torn down mid-spec, and
 * the row stranded at `generating` until the reaper swept it. The budget below is split explicitly
 * so that can't recur.
 */
const DEV_HANDOFF_BUDGET_MS = 270_000;

/** Hold this much back from extraction so specification always gets a usable slice. */
const SPEC_RESERVE_MS = 150_000;

/** Below this, don't start spec generation at all — it would only be killed mid-flight. */
const SPEC_MIN_MS = 45_000;

/**
 * Run the full handoff: extract assets, then generate the specification.
 *
 * Each step already writes its own terminal status and catches its own errors, so this never
 * throws — it is safe to call from an `after()` callback or a cron drain. Spec generation runs
 * even when extraction fails, because it can still work from the original composite image; that
 * degradation surfaces as `warning` on the derived status rather than an outright failure.
 *
 * Both steps draw from one shared deadline (see `DEV_HANDOFF_BUDGET_MS`) so neither can starve the
 * other into being killed by the platform.
 */
export async function runDevHandoff(
  artifactId: string,
  opts: { budgetMs?: number; stages?: readonly DevHandoffStageName[] } = {}
): Promise<void> {
  const id = artifactId.trim();
  const stages = opts.stages ?? DEFAULT_STAGES;
  const deadline = Date.now() + (opts.budgetMs ?? DEV_HANDOFF_BUDGET_MS);
  const remaining = () => deadline - Date.now();

  if (stages.includes('assets')) {
    try {
      // Cap extraction so at least SPEC_RESERVE_MS survives for the specification.
      const reserve = stages.includes('spec') ? SPEC_RESERVE_MS : 0;
      const extractionMs = Math.min(remaining() - reserve, 120_000);
      if (extractionMs > 15_000) {
        await runDesignAssetExtractionForArtifact(id, { timeoutMs: extractionMs });
      } else {
        console.warn('[dev-handoff] skipping extraction — insufficient budget', id, remaining());
      }
    } catch (err) {
      console.error('[dev-handoff] asset extraction threw', id, err);
    }
  }

  if (!stages.includes('spec')) return;

  // Spec generation cannot bound its own runtime, so race it against what's left of the budget and
  // write a terminal status on timeout. As with extraction, the orphaned call may still land later
  // and overwrite `failed` with a real spec — better data, not corruption.
  const specMs = remaining();
  if (specMs < SPEC_MIN_MS) {
    console.warn('[dev-handoff] insufficient budget for spec generation', id, specMs);
    await markSpecFailed(id, `Ran out of time before the specification could be generated (${Math.round(specMs / 1000)}s left). Re-run the dev handoff.`);
    return;
  }

  let specWatchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = await Promise.race([
      generateSpecForArtifact(id).then(() => false),
      new Promise<boolean>((resolve) => {
        specWatchdog = setTimeout(() => resolve(true), specMs);
      }),
    ]);
    if (timedOut) {
      await markSpecFailed(id, `Specification generation exceeded ${Math.round(specMs / 1000)}s and was abandoned. Re-run the dev handoff.`);
    }
  } catch (err) {
    console.error('[dev-handoff] spec generation threw', id, err);
    // generateSpecForArtifact writes its own `failed` on catchable errors, but a throw that
    // escapes it would leave `generating` behind. Force a terminal state so the reaper does
    // not have to wait 15 minutes to do it.
    await markSpecFailed(id, err instanceof Error ? err.message.slice(0, 2000) : 'Specification generation failed.');
  } finally {
    if (specWatchdog) clearTimeout(specWatchdog);
  }
}

/** Force `specStatus: failed` with a reason the UI can display. Never throws. */
async function markSpecFailed(artifactId: string, reason: string): Promise<void> {
  try {
    const existing = await getDesignArtifactById(artifactId);
    const meta =
      existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
        ? { ...(existing.metadata as Record<string, unknown>) }
        : {};
    meta.specError = reason;
    await updateDesignArtifactById(artifactId, {
      specStatus: 'failed',
      metadata: meta,
    } as Parameters<typeof updateDesignArtifactById>[1]);
  } catch (err) {
    console.error('[dev-handoff] could not mark spec failed', artifactId, err);
  }
}

/** Current status for one artifact, or null when it does not exist. */
export async function getDevHandoffStatus(artifactId: string): Promise<DevHandoffStatus | null> {
  const row = await getDesignArtifactById(artifactId.trim());
  if (!row) return null;
  return devHandoffStatusForRow(row);
}
