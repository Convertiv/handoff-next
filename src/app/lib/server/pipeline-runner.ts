import 'server-only';

import {
  claimNextPipelineJob,
  completePipelineJob,
  failPipelineJob,
  getUpstreamResults,
  releasePipelineJob,
  skipRemainingStages,
  type PipelineStage,
} from '@/lib/server/pipeline-queue';
import { handlerFor, STAGE_MIN_BUDGET_MS } from '@/lib/server/pipeline-stages';

/**
 * Drain the pipeline queue for as long as this invocation has budget.
 *
 * The point of the queue is that each stage gets its own invocation, so this deliberately does NOT try
 * to run a whole pipeline in one pass. It runs what fits and leaves the rest for the next tick — which
 * is what makes a 114s asset generation followed by a 100s composite possible at all.
 *
 * It will chain opportunistically when there's room, so a cheap stage doesn't cost a whole cron
 * interval. The budget check happens *before* claiming: claiming and then abandoning would burn a retry
 * attempt for no reason.
 */
export interface DrainResult {
  ran: { stage: string; artifactId: string; ok: boolean; ms: number; error?: string }[];
  /** Stages left alone because the remaining budget was too small to start them honestly. */
  deferred: number;
}

export async function drainPipeline(opts: { budgetMs: number }): Promise<DrainResult> {
  const startedAt = Date.now();
  const remaining = () => opts.budgetMs - (Date.now() - startedAt);
  const ran: DrainResult['ran'] = [];
  let deferred = 0;

  // The smallest stage worth starting; below this, nothing can be claimed usefully.
  const cheapest = Math.min(...Object.values(STAGE_MIN_BUDGET_MS));

  while (remaining() > cheapest) {
    const job = await claimNextPipelineJob();
    if (!job) break;

    const handler = handlerFor(job.stage);
    if (!handler) {
      // Unknown stage: fail it terminally rather than retrying something that cannot succeed.
      await failPipelineJob(job.id, `No handler registered for stage "${job.stage}".`);
      await skipRemainingStages(job.pipelineId, job.seq, `Upstream stage "${job.stage}" has no handler.`);
      ran.push({ stage: job.stage, artifactId: job.artifactId, ok: false, ms: 0, error: 'no handler' });
      continue;
    }

    const need = STAGE_MIN_BUDGET_MS[job.stage as PipelineStage] ?? cheapest;
    if (remaining() < need) {
      // Claimed but unaffordable. Release rather than fail: claiming incremented `attempts`, and a
      // long stage repeatedly claimed late in a tick would otherwise exhaust its retry budget without
      // ever being attempted.
      await releasePipelineJob(job.id, `Deferred: needs ~${Math.round(need / 1000)}s, ${Math.round(remaining() / 1000)}s left this tick.`);
      deferred += 1;
      break;
    }

    const t0 = Date.now();
    try {
      const upstream = await getUpstreamResults(job.pipelineId, job.seq);
      const result = await handler({ job, upstream, budgetMs: remaining() });
      await completePipelineJob(job.id, result);
      ran.push({ stage: job.stage, artifactId: job.artifactId, ok: true, ms: Date.now() - t0 });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const { willRetry } = await failPipelineJob(job.id, error);
      if (!willRetry) {
        // A terminally failed stage must not leave its successors pending forever — they can never
        // become runnable, and would sit in the queue looking like work in progress.
        await skipRemainingStages(job.pipelineId, job.seq, `Upstream stage "${job.stage}" failed: ${error}`);
      }
      console.error('[pipeline] stage failed', job.stage, job.artifactId, willRetry ? '(will retry)' : '(terminal)', error);
      ran.push({ stage: job.stage, artifactId: job.artifactId, ok: false, ms: Date.now() - t0, error });
    }
  }

  return { ran, deferred };
}
