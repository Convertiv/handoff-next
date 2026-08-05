/**
 * Is a generation job actually going to be processed?
 *
 * Image generation is enqueue-only: `generate-image` and the chat's `request_image` tool insert a row
 * and return, and the *only* consumer of pending rows is the Vercel Cron at
 * `/api/handoff/ai/design-jobs/run`. So when that drain isn't running, a job sits `pending` forever —
 * and the reaper that would mark it failed lives inside the same route, so nothing ever moves it to a
 * terminal state either. The client polled for 15 minutes before saying a word.
 *
 * That is how the SS&C demo failed (2026-08-05): `CRON_SECRET` was unset on the deployment, the drain
 * 503'd every tick, and both generators looked like the product hangs. The env was the bug; the
 * 15-minute silence was ours. This module is the fast, honest answer.
 *
 * Deliberately advisory: it never mutates the job. A stalled verdict means "stop waiting and say why",
 * not "this job is dead" — a drain that comes back up will still process the row.
 *
 * No database import on purpose. The queue read is injected, so the branching logic is unit-testable
 * without a Postgres connection; the route supplies `getGenerationQueueActivity`.
 */

/**
 * How long a job may sit `pending` before we treat silence as a stall.
 *
 * Three ticks of the every-minute cron. Long enough that a tick landing just after the insert, or a
 * single slow drain pass, isn't reported as a fault; short enough to beat the 15-minute client
 * deadline by an order of magnitude.
 */
export const STALL_AFTER_MS = 3 * 60 * 1000;

/** The only parts of a job row this decision depends on. */
export interface QueueHealthJob {
  status: string;
  createdAt: Date | string | null;
}

/** Evidence that the drain is alive — see `getGenerationQueueActivity`. */
export interface QueueActivity {
  runningCount: number;
  lastTerminalAt: Date | null;
}

export interface QueueHealth {
  /** Whether the drain route can do any work at all — it hard-503s without `CRON_SECRET`. */
  drainConfigured: boolean;
  /** This job is not going to be picked up as things stand. Safe to surface to the user. */
  stalled: boolean;
  /** Why, in words a user can act on (or hand to whoever owns the deployment). */
  reason?: string;
}

/** Terminal jobs have an outcome already; queue health has nothing to add. */
function isTerminal(status: string): boolean {
  return status === 'done' || status === 'failed';
}

export async function describeGenerationQueueHealth(
  job: QueueHealthJob,
  readActivity: () => Promise<QueueActivity>
): Promise<QueueHealth> {
  const drainConfigured = Boolean(process.env.CRON_SECRET?.trim());

  if (isTerminal(job.status)) return { drainConfigured, stalled: false };

  /**
   * `running` is left alone even with the drain misconfigured: the inline SSE path
   * (`ai/generate-design`) also advances jobs, so a running row may be progressing without the cron.
   * Only `pending` rows are the cron's exclusive responsibility.
   */
  if (job.status !== 'pending') return { drainConfigured, stalled: false };

  if (!drainConfigured) {
    return {
      drainConfigured,
      stalled: true,
      reason:
        "the image queue isn't running on this deployment (CRON_SECRET is not set), so queued images " +
        "won't generate",
    };
  }

  const createdAtMs = job.createdAt ? new Date(job.createdAt).getTime() : NaN;
  const pendingForMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : 0;
  if (pendingForMs < STALL_AFTER_MS) return { drainConfigured, stalled: false };

  /**
   * Past this point the job has waited longer than three ticks, which on its own is ambiguous: the
   * drain takes ≤3 jobs a tick and one image legitimately runs minutes, so a backlog looks identical
   * to a dead drain from inside a single job. Only ask the extra question here, so the common poll
   * stays one cheap read.
   */
  const activity = await readActivity();
  const drainAlive =
    activity.runningCount > 0 ||
    (activity.lastTerminalAt !== null && Date.now() - activity.lastTerminalAt.getTime() < STALL_AFTER_MS);

  if (drainAlive) return { drainConfigured, stalled: false };

  /**
   * Kept short because it renders inline in the chat's image list. The causes it can't distinguish
   * between are all deployment-side: Vercel Cron only runs on production deployments, minute-level
   * schedules need a plan that allows them, and a redeploy is what registers `vercel.json` crons.
   */
  return {
    drainConfigured,
    stalled: true,
    reason: `nothing has drained the image queue in over ${Math.round(STALL_AFTER_MS / 60000)} minutes — the job runner may not be scheduled on this deployment`,
  };
}
