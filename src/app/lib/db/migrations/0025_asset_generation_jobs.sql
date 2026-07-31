-- Playground asset generation: let a generation job land a library asset instead of a design
-- artifact. ADDITIVE only — existing jobs keep working unchanged. All statements idempotent.
--
-- The queue itself is reused rather than duplicated: `handoff_design_generation_job` already has
-- status/stage/error, a cron drain, ownership and poll endpoints. What it lacked was somewhere to
-- record an *asset* result, since `artifact_id` points at the design library.
--
-- `intent` lives in the existing `request_params` jsonb (absent = 'artifact', the old behaviour), so
-- no column is needed for it and no backfill either.

-- Where a finished asset job put its image. Nullable and unconstrained by a FK on purpose: a job may
-- fail before an asset exists, and deleting an asset should not cascade into deleting the history of
-- the job that made it.
ALTER TABLE "handoff_design_generation_job" ADD COLUMN IF NOT EXISTS "asset_id" text;

-- The drain scans for pending work every minute; `status` alone already has an index only in
-- combination with user_id, which does not serve a status-only FIFO scan.
CREATE INDEX IF NOT EXISTS "design_gen_job_status_created_idx"
  ON "handoff_design_generation_job" ("status", "created_at");
