import { NextResponse, type NextRequest } from 'next/server';
import { getPendingDesignGenerationJobs } from '@/lib/db/queries';
import { runDesignGenerationJob } from '@/lib/server/design-generation-worker';

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
  return NextResponse.json({ processed });
}
