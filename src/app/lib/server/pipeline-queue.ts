import 'server-only';

import { and, asc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { handoffPipelineJobs } from '@/lib/db/schema-pg';

/**
 * Durable pipeline queue: one stage per serverless invocation.
 *
 * Every timeout failure in this pipeline has come from stages competing for a single budget —
 * extraction starving specification, then a 270s watchdog that never fired because `maxDuration` is
 * counted from *request* start rather than from when `after()` begins running. Asset-first generation
 * makes that unfixable by tuning: the asset alone measured 114s and the composite 100s, so a design's
 * stages simply do not fit in one 300s window.
 *
 * The fix is structural. Each stage is a row, each row gets its own invocation, and ordering is a
 * dependency rule rather than a sequence of awaits:
 *
 *   **A stage is runnable when every lower-`seq` stage in its pipeline has finished.**
 *
 * That predicate lives here once, in SQL, instead of being reimplemented per stage. Adding a stage is
 * adding a handler and a `seq` — not tightening a budget.
 */

export type PipelineStage = 'assets' | 'composite' | 'spec';
export type PipelineJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** Terminal states — a stage in one of these no longer blocks its successors. */
const FINISHED: PipelineJobStatus[] = ['done', 'failed', 'skipped'];

export interface PipelineJobRow {
  id: number;
  artifactId: string;
  pipelineId: string;
  stage: string;
  seq: number;
  status: string;
  attempts: number;
  maxAttempts: number;
  payload: unknown;
  result: unknown;
  error: string | null;
}

export interface StageSpec {
  stage: PipelineStage;
  payload?: unknown;
  /** Overrides the default retry budget for stages where a retry is wasteful. */
  maxAttempts?: number;
}

/**
 * Enqueue an ordered pipeline for one artifact.
 *
 * `seq` is assigned from array order, so the caller expresses dependencies by listing stages in the
 * order they must run. Returns the `pipelineId`, which is how a caller polls the run it started rather
 * than whatever ran most recently on that artifact.
 */
export async function enqueuePipeline(args: {
  artifactId: string;
  stages: StageSpec[];
  pipelineId?: string;
}): Promise<string | null> {
  if (!args.stages.length) return null;
  const pipelineId = args.pipelineId ?? crypto.randomUUID();
  const db = getDb();
  try {
    await db.insert(handoffPipelineJobs).values(
      args.stages.map((s, i) => ({
        artifactId: args.artifactId,
        pipelineId,
        stage: s.stage,
        seq: i,
        status: 'pending',
        maxAttempts: s.maxAttempts ?? 2,
        payload: (s.payload ?? null) as never,
      }))
    );
    return pipelineId;
  } catch (err) {
    // The (pipeline_id, stage) unique index turns a double-enqueue into a conflict rather than
    // silently queuing the same work twice.
    console.error('[pipeline] enqueue failed', args.artifactId, err);
    return null;
  }
}

/**
 * Atomically claim the next runnable stage.
 *
 * Two conditions, both enforced in the UPDATE so concurrent cron ticks cannot double-run a stage or
 * run one out of order:
 *
 *  1. the row is `pending` and has retry budget left
 *  2. no lower-`seq` stage in the same pipeline is still unfinished
 *
 * Returns null when nothing is runnable — either the queue is empty or every candidate is still
 * waiting on a predecessor.
 */
export async function claimNextPipelineJob(): Promise<PipelineJobRow | null> {
  const db = getDb();
  try {
    const rows = await db.execute(sql`
      UPDATE "handoff_pipeline_job" AS j
      SET "status" = 'running',
          "attempts" = j."attempts" + 1,
          "started_at" = now(),
          "updated_at" = now()
      WHERE j."id" = (
        SELECT c."id"
        FROM "handoff_pipeline_job" AS c
        WHERE c."status" = 'pending'
          AND c."attempts" < c."max_attempts"
          AND NOT EXISTS (
            SELECT 1 FROM "handoff_pipeline_job" AS p
            WHERE p."pipeline_id" = c."pipeline_id"
              AND p."seq" < c."seq"
              AND p."status" NOT IN ('done', 'failed', 'skipped')
          )
        ORDER BY c."created_at" ASC, c."seq" ASC, c."id" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING j."id", j."artifact_id", j."pipeline_id", j."stage", j."seq",
                j."status", j."attempts", j."max_attempts", j."payload", j."result", j."error"
    `);
    const list = (Array.isArray(rows) ? rows : ((rows as { rows?: unknown[] }).rows ?? [])) as Record<string, unknown>[];
    const r = list[0];
    if (!r) return null;
    return {
      id: Number(r.id),
      artifactId: String(r.artifact_id),
      pipelineId: String(r.pipeline_id),
      stage: String(r.stage),
      seq: Number(r.seq),
      status: String(r.status),
      attempts: Number(r.attempts),
      maxAttempts: Number(r.max_attempts),
      payload: r.payload ?? null,
      result: r.result ?? null,
      error: (r.error as string | null) ?? null,
    };
  } catch (err) {
    console.error('[pipeline] claim failed', err);
    return null;
  }
}

/** Mark a claimed stage finished, storing whatever later stages will need. */
export async function completePipelineJob(id: number, result?: unknown): Promise<void> {
  const db = getDb();
  await db
    .update(handoffPipelineJobs)
    .set({
      status: 'done',
      result: (result ?? null) as never,
      error: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(handoffPipelineJobs.id, id));
}

/**
 * Record a stage failure.
 *
 * Returns to `pending` while retry budget remains, so the next tick picks it up — a stage killed with
 * its invocation recovers without an out-of-band reaper. Only a stage out of attempts becomes
 * terminally `failed`.
 */
export async function failPipelineJob(id: number, error: string): Promise<{ willRetry: boolean }> {
  const db = getDb();
  const [row] = await db
    .select({ attempts: handoffPipelineJobs.attempts, maxAttempts: handoffPipelineJobs.maxAttempts })
    .from(handoffPipelineJobs)
    .where(eq(handoffPipelineJobs.id, id));
  const willRetry = !!row && row.attempts < row.maxAttempts;
  await db
    .update(handoffPipelineJobs)
    .set({
      status: willRetry ? 'pending' : 'failed',
      error: error.slice(0, 2000),
      finishedAt: willRetry ? null : new Date(),
      updatedAt: new Date(),
    })
    .where(eq(handoffPipelineJobs.id, id));
  return { willRetry };
}

/**
 * Hand a claimed stage back untouched.
 *
 * Distinct from `failPipelineJob` because nothing went wrong: the drain claimed a stage and then found
 * it couldn't afford to run it this tick. Claiming increments `attempts`, so releasing must decrement
 * it — otherwise a long stage that keeps getting claimed late in a tick would burn through its retry
 * budget and fail terminally without ever having been attempted.
 */
export async function releasePipelineJob(id: number, reason: string): Promise<void> {
  const db = getDb();
  await db
    .update(handoffPipelineJobs)
    .set({
      status: 'pending',
      attempts: sql`GREATEST(${handoffPipelineJobs.attempts} - 1, 0)`,
      error: reason.slice(0, 2000),
      startedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(handoffPipelineJobs.id, id));
}

/**
 * Abandon the stages after a terminal failure.
 *
 * Without this, a failed `assets` stage leaves `composite` pending forever — it can never become
 * runnable because its predecessor never finishes cleanly, and it would sit in the queue looking like
 * work in progress. `skipped` records that it was deliberately not run.
 */
export async function skipRemainingStages(pipelineId: string, afterSeq: number, reason: string): Promise<number> {
  const db = getDb();
  const updated = await db
    .update(handoffPipelineJobs)
    .set({ status: 'skipped', error: reason.slice(0, 2000), finishedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(handoffPipelineJobs.pipelineId, pipelineId),
        eq(handoffPipelineJobs.status, 'pending'),
        sql`${handoffPipelineJobs.seq} > ${afterSeq}`
      )
    )
    .returning({ id: handoffPipelineJobs.id });
  return updated.length;
}

/** All stages of one pipeline, in order — for progress reporting. */
export async function getPipelineJobs(pipelineId: string): Promise<PipelineJobRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(handoffPipelineJobs)
    .where(eq(handoffPipelineJobs.pipelineId, pipelineId))
    .orderBy(asc(handoffPipelineJobs.seq));
  return rows.map((r) => ({
    id: r.id,
    artifactId: r.artifactId,
    pipelineId: r.pipelineId,
    stage: r.stage,
    seq: r.seq,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    payload: r.payload,
    result: r.result,
    error: r.error,
  }));
}

/** Results of earlier stages in a pipeline, keyed by stage — how a stage consumes its predecessors. */
export async function getUpstreamResults(pipelineId: string, seq: number): Promise<Record<string, unknown>> {
  const jobs = await getPipelineJobs(pipelineId);
  const out: Record<string, unknown> = {};
  for (const j of jobs) {
    if (j.seq < seq && j.status === 'done') out[j.stage] = j.result;
  }
  return out;
}

/** True when every stage of a pipeline has reached a terminal state. */
export function isPipelineFinished(jobs: PipelineJobRow[]): boolean {
  return jobs.length > 0 && jobs.every((j) => FINISHED.includes(j.status as PipelineJobStatus));
}
