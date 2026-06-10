-- Migration 0008: design generation jobs
-- Background job queue for server-side design generation.
-- Stores serialized request params so jobs can survive browser navigation.

CREATE TABLE IF NOT EXISTS "handoff_design_generation_job" (
  "id"             serial PRIMARY KEY,
  "artifact_id"    text REFERENCES "handoff_design_artifact"("id") ON DELETE SET NULL,
  "user_id"        text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "status"         text NOT NULL DEFAULT 'pending',
  "stage"          text NOT NULL DEFAULT 'preparing',
  "image_url"      text,
  "error"          text,
  "request_params" jsonb NOT NULL DEFAULT '{}',
  "created_at"     timestamp NOT NULL DEFAULT NOW(),
  "updated_at"     timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "design_gen_job_user_status_idx"
  ON "handoff_design_generation_job" ("user_id", "status");

CREATE INDEX IF NOT EXISTS "design_gen_job_artifact_idx"
  ON "handoff_design_generation_job" ("artifact_id");
