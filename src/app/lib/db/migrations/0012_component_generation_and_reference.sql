-- Reference materials for LLM / design-to-component context
CREATE TABLE IF NOT EXISTS "handoff_reference_material" (
  "id" text PRIMARY KEY NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "generated_at" timestamp DEFAULT now(),
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Design artifact → component generation jobs
CREATE TABLE IF NOT EXISTS "component_generation_job" (
  "id" serial PRIMARY KEY NOT NULL,
  "artifact_id" text NOT NULL REFERENCES "handoff_design_artifact"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "component_id" text NOT NULL,
  "renderer" text NOT NULL DEFAULT 'handlebars',
  "status" text NOT NULL DEFAULT 'queued',
  "iteration" integer NOT NULL DEFAULT 0,
  "max_iterations" integer NOT NULL DEFAULT 3,
  "a11y_standard" text NOT NULL DEFAULT 'none',
  "behavior_prompt" text NOT NULL DEFAULT '',
  "use_extracted_assets" boolean NOT NULL DEFAULT true,
  "generation_log" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "validation_results" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "visual_score" numeric(5, 4),
  "last_build_job_id" integer,
  "error" text,
  "created_at" timestamp DEFAULT now(),
  "completed_at" timestamp
);

CREATE INDEX IF NOT EXISTS "component_generation_job_artifact_id_idx"
  ON "component_generation_job" ("artifact_id");

CREATE INDEX IF NOT EXISTS "component_generation_job_user_id_idx"
  ON "component_generation_job" ("user_id");
