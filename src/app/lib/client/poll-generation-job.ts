/**
 * Wait for a generation job to finish, from the browser.
 *
 * Polling rather than streaming, deliberately: the job outlives the request that started it and may
 * outlive the chat turn or the edit sheet by minutes. A 3s poll against work that takes 1-4 minutes is
 * cheap, and it survives the user navigating away and coming back in a way an open socket does not.
 *
 * Shared by the chat panel and the block editor's per-field Generate. They do very different things
 * with the result — one swaps a placeholder across the whole canvas, the other writes one field — but
 * the waiting, the retry semantics and the deadline are identical, and a second hand-rolled copy of
 * this loop is where the two would quietly drift apart.
 */

export interface GenerationJobResult {
  status: 'done' | 'failed';
  /** Where the finished image lives. Present only on `done`. */
  imageUrl?: string;
  error?: string;
  /**
   * The job was abandoned because nothing is draining the queue, not because generation failed. The
   * row is still `pending` server-side and a recovered drain will process it; the caller stopped
   * waiting. Worth distinguishing in the UI — it is an operator problem, not a bad prompt.
   */
  stalled?: boolean;
}

export interface PollOptions {
  intervalMs?: number;
  /** Matches the server-side reaper, so the client gives up at roughly the same time the server does. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function pollGenerationJob(jobId: number, options: PollOptions = {}): Promise<GenerationJobResult> {
  const { intervalMs = 3000, timeoutMs = 15 * 60 * 1000, signal } = options;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (signal?.aborted) return { status: 'failed', error: 'Cancelled.' };
    await sleep(intervalMs, signal);
    if (signal?.aborted) return { status: 'failed', error: 'Cancelled.' };

    let job: { status?: string; imageUrl?: string | null; error?: string | null } | undefined;
    let queue: { stalled?: boolean; reason?: string } | undefined;
    try {
      const res = await fetch(`/api/handoff/ai/design-generation-job/${jobId}`, { credentials: 'include', signal });
      if (!res.ok) throw new Error(String(res.status));
      ({ job, queue } = (await res.json()) as { job: typeof job; queue: typeof queue });
    } catch (err) {
      if (signal?.aborted) return { status: 'failed', error: 'Cancelled.' };
      // A blip is not a failure — the job is still running server-side. Keep polling until the
      // deadline; a transient error should cost one interval, not the whole generation.
      continue;
    }

    /**
     * Stop early when the server says nothing will pick this up. Waiting out the full deadline in that
     * case teaches the user the product hangs, which is a worse lie than an error — and the reason
     * text names the actual fault, so someone can fix it instead of retrying.
     */
    if (queue?.stalled) {
      return { status: 'failed', stalled: true, error: queue.reason ?? 'The image queue is not running.' };
    }

    if (!job || job.status === 'pending' || job.status === 'running') continue;
    if (job.status === 'done' && job.imageUrl) {
      return { status: 'done', imageUrl: job.imageUrl };
    }
    return { status: 'failed', error: job.error ?? 'Generation failed.' };
  }

  return { status: 'failed', error: 'Timed out waiting for the image.' };
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // Resolve rather than reject on abort: every caller re-checks the signal immediately after, and an
    // unhandled rejection from a cancelled wait is noise.
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}
