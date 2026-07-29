import { NextResponse, type NextRequest } from 'next/server';
import { getPendingDesignGenerationJobs, getPendingSpecArtifactIds, reapStuckDesignArtifactJobs } from '@/lib/db/queries';
import { runDesignGenerationJob } from '@/lib/server/design-generation-worker';
import { runQueuedSpecGeneration } from '@/lib/server/dev-handoff';
import { drainPipeline } from '@/lib/server/pipeline-runner';

// Long enough to process a small batch of image generations serially.
export const maxDuration = 300;

/**
 * Durable runner for MCP-queued design generation jobs.
 *
 * MCP tools (handoff_generate_design_image) enqueue a job row instead of running
 * the worker inline — a detached worker "silently never runs" on Vercel. This
 * Vercel Cron (see vercel.json, `* * * * *`) drains pending jobs FIFO.
 *
 * Auth: Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the
 * CRON_SECRET env var is set. No other cron pattern exists in this repo, so we
 * gate on CRON_SECRET exactly (503 if unconfigured, 401 on mismatch).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured on the server' }, { status: 503 });
  }
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Reap first, and independently of the drain below: asset extraction and spec generation run
  // in `after()` callbacks that die with their invocation, so a killed function leaves the row
  // in `extracting`/`generating` with nothing left to finalize it. This sweep is the only thing
  // that guarantees those rows reach a terminal state. Never let a reap failure block the drain.
  let reaped: { extractions: number; specs: number } = { extractions: 0, specs: 0 };
  try {
    reaped = await reapStuckDesignArtifactJobs();
    if (reaped.extractions || reaped.specs) {
      console.warn('[design-jobs/run] reaped stuck design jobs', reaped);
    }
  } catch (err) {
    console.error('[design-jobs/run] reaper failed', err);
  }

  const startedAt = Date.now();
  /** Leave headroom under maxDuration so whatever runs last can still write its terminal status. */
  const remainingMs = () => 285_000 - (Date.now() - startedAt);

  const jobs = await getPendingDesignGenerationJobs(3);
  let processed = 0;
  for (const job of jobs) {
    try {
      await runDesignGenerationJob(job.id, job.userId);
      processed += 1;
    } catch (err) {
      console.error('[design-jobs/run] job failed', job.id, err);
    }
  }

  // Drain queued specifications. These used to run in an `after()` callback alongside asset
  // extraction, where they shared one invocation with a request of unknowable duration and were
  // twice killed before their own watchdog could fire. Here each gets a real slice of a dedicated
  // invocation, and the atomic claim inside runQueuedSpecGeneration makes overlapping ticks safe.
  let specs = 0;
  try {
    for (const artifact of await getPendingSpecArtifactIds(2)) {
      // A specification needs a meaningful budget; starting one with seconds left just strands it.
      if (remainingMs() < 90_000) {
        console.log('[design-jobs/run] stopping spec drain — insufficient budget this tick');
        break;
      }
      const ran = await runQueuedSpecGeneration(artifact.id, { budgetMs: remainingMs() - 20_000 });
      if (ran) specs += 1;
    }
  } catch (err) {
    console.error('[design-jobs/run] spec drain failed', err);
  }

  // Drain the pipeline queue LAST, with whatever budget is left. It runs one stage per pass by design
  // — a 114s asset generation followed by a 100s composite cannot share an invocation, which is the
  // whole reason the queue exists. Anything it can't afford is left for the next tick.
  let pipeline: Awaited<ReturnType<typeof drainPipeline>> = { ran: [], deferred: 0 };
  try {
    pipeline = await drainPipeline({ budgetMs: remainingMs() });
    if (pipeline.ran.length || pipeline.deferred) {
      console.log('[design-jobs/run] pipeline drain', JSON.stringify(pipeline));
    }
  } catch (err) {
    console.error('[design-jobs/run] pipeline drain failed', err);
  }

  return NextResponse.json({ processed, specs, reaped, pipeline });
}
