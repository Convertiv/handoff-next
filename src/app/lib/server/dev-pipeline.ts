import 'server-only';

import { getDesignArtifactById } from '@/lib/db/queries';
import { planAssetsFromSpec } from '@/lib/spec/asset-plan';
import {
  enqueuePipeline,
  getLatestPipelineIdForArtifact,
  getPipelineJobs,
  isPipelineFinished,
  type StageSpec,
} from '@/lib/server/pipeline-queue';
import type { ComponentSpec } from '@/lib/server/design-spec-types';

/**
 * Start a design pipeline for an artifact.
 *
 * The pipeline is where asset-first generation actually happens: assets are produced individually at
 * their declared aspect ratios, then the composite is assembled from them, then the specification is
 * (re)generated against the result. Ordering matters and the stages are individually long — asset
 * generation measured 114s and the composite 100s — so each gets its own invocation via the queue
 * rather than sharing one 300s budget.
 *
 * Stages are chosen from what the artifact actually needs, not fixed:
 *  - **assets** only when the spec declares imagery. A form or an atom needs none, and enqueuing an
 *    empty stage would burn an invocation to do nothing.
 *  - **composite** only when asked, since regenerating the image is destructive to the current one.
 *  - **spec** last, so it describes what was actually produced rather than what preceded it.
 */
export type DevPipelineIntent = 'assets-and-composite' | 'assets-only' | 'spec-only' | 'full';

export interface StartPipelineResult {
  ok: boolean;
  pipelineId?: string;
  stages?: string[];
  error?: string;
}

export async function startDevPipeline(args: {
  artifactId: string;
  intent: DevPipelineIntent;
}): Promise<StartPipelineResult> {
  const row = await getDesignArtifactById(args.artifactId);
  if (!row) return { ok: false, error: 'Design not found' };

  const spec = (row.componentSpec ?? null) as ComponentSpec | null;
  const declaresImagery = spec ? planAssetsFromSpec(spec).length > 0 : false;

  const stages: StageSpec[] = [];

  const wantsAssets = args.intent === 'assets-and-composite' || args.intent === 'assets-only' || args.intent === 'full';
  const wantsComposite = args.intent === 'assets-and-composite' || args.intent === 'full';
  const wantsSpec = args.intent === 'spec-only' || args.intent === 'full';

  if (wantsAssets) {
    if (!spec) {
      return {
        ok: false,
        error: 'Asset generation is driven by the specification, and this artifact has none yet. Run the spec stage first.',
      };
    }
    if (!declaresImagery) {
      // Not an error — most components genuinely have no photographs. Say so rather than queuing a
      // stage that would immediately no-op.
      if (args.intent === 'assets-only') {
        return { ok: false, error: 'The specification declares no imagery, so there are no assets to generate.' };
      }
    } else {
      // One retry only: image generation is expensive, and a second failure is rarely transient.
      stages.push({ stage: 'assets', maxAttempts: 2 });
    }
  }

  if (wantsComposite) stages.push({ stage: 'composite', maxAttempts: 2 });
  if (wantsSpec) stages.push({ stage: 'spec', maxAttempts: 2 });

  if (!stages.length) return { ok: false, error: 'Nothing to do for this intent.' };

  const pipelineId = await enqueuePipeline({ artifactId: args.artifactId, stages });
  if (!pipelineId) return { ok: false, error: 'Could not enqueue the pipeline.' };

  return { ok: true, pipelineId, stages: stages.map((s) => s.stage) };
}

export interface PipelineProgress {
  pipelineId: string;
  /** The artifact this pipeline belongs to — callers authorize against it. */
  artifactId: string;
  finished: boolean;
  stages: { stage: string; status: string; attempts: number; error: string | null }[];
  /** Coarse 0–1 progress across the pipeline's stages. */
  progress: number;
  /** The stage currently running, or null. */
  current: string | null;
}

/**
 * Progress for whatever pipeline is most recent on an artifact.
 *
 * The id-less entry point. A caller that has an artifact — the detail page, or an agent that just
 * asked for asset generation and didn't keep the id — can still see what's running, which the
 * pipelineId-only API made impossible.
 */
export async function getLatestDevPipelineProgress(artifactId: string): Promise<PipelineProgress | null> {
  const pipelineId = await getLatestPipelineIdForArtifact(artifactId);
  return pipelineId ? getDevPipelineProgress(pipelineId) : null;
}

/** Progress for one pipeline run — what a caller polls after `startDevPipeline`. */
export async function getDevPipelineProgress(pipelineId: string): Promise<PipelineProgress | null> {
  const jobs = await getPipelineJobs(pipelineId);
  if (!jobs.length) return null;
  const done = jobs.filter((j) => j.status === 'done' || j.status === 'skipped').length;
  return {
    pipelineId,
    artifactId: jobs[0].artifactId,
    finished: isPipelineFinished(jobs),
    stages: jobs.map((j) => ({ stage: j.stage, status: j.status, attempts: j.attempts, error: j.error })),
    progress: jobs.length ? done / jobs.length : 0,
    current: jobs.find((j) => j.status === 'running')?.stage ?? null,
  };
}
