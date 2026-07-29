-- Durable pipeline queue: one stage per serverless invocation.
--
-- This is a prerequisite, not an optimization. Asset-first generation measured 114s for the asset and
-- 100s for the composite (2026-07-29), so a design's stages cannot share one 300s invocation — and
-- every timeout bug in this pipeline so far came from stages competing for a single budget
-- (extraction starving specification, then a watchdog that never fired because `maxDuration` counts
-- from request start rather than from when `after()` begins).
--
-- Shape notes:
--  * `pipeline_id` groups the stages of one run, so several runs on the same artifact don't interleave.
--  * `seq` gives ordering WITHIN a pipeline. A stage becomes runnable only when every lower-seq stage
--    in its pipeline has finished — that dependency rule lives in one SQL predicate rather than being
--    reimplemented per stage.
--  * `attempts`/`max_attempts` make retry a property of the row. A stage that dies with the function
--    is retried by the next tick instead of needing an out-of-band reaper.
--  * `payload`/`result` carry stage inputs and outputs, so a later stage can consume what an earlier
--    one produced (the composite needs the generated assets) without a side channel.
--
-- ADDITIVE only. All statements idempotent.

CREATE TABLE IF NOT EXISTS "handoff_pipeline_job" (
  "id" serial PRIMARY KEY,
  "artifact_id" text NOT NULL,
  -- Groups all stages of one pipeline run.
  "pipeline_id" text NOT NULL,
  -- assets | composite | spec — extend by adding a handler, not a column.
  "stage" text NOT NULL,
  -- Order within the pipeline; lower runs first.
  "seq" integer NOT NULL,
  -- pending | running | done | failed | skipped
  "status" text NOT NULL DEFAULT 'pending',
  "attempts" integer NOT NULL DEFAULT 0,
  "max_attempts" integer NOT NULL DEFAULT 2,
  "payload" jsonb,
  "result" jsonb,
  "error" text,
  "started_at" timestamp,
  "finished_at" timestamp,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- One row per (pipeline, stage): makes "this pipeline has one assets stage" a constraint rather than a
-- convention, so a double-enqueue conflicts instead of silently queuing the work twice.
CREATE UNIQUE INDEX IF NOT EXISTS "pipeline_job_stage_unique" ON "handoff_pipeline_job" ("pipeline_id", "stage");

-- The drain query: find runnable work, oldest pipeline first.
CREATE INDEX IF NOT EXISTS "pipeline_job_claim_idx" ON "handoff_pipeline_job" ("status", "seq", "id");

-- Status reads are always "this artifact's stages" or "this pipeline's stages".
CREATE INDEX IF NOT EXISTS "pipeline_job_artifact_idx" ON "handoff_pipeline_job" ("artifact_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "pipeline_job_pipeline_idx" ON "handoff_pipeline_job" ("pipeline_id", "seq");
