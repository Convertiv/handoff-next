CREATE TABLE IF NOT EXISTS "figma_fetch_job" (
  "id" serial PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "error" text,
  "triggered_by_user_id" text,
  "created_at" timestamp DEFAULT now(),
  "completed_at" timestamp
);

DO $$ BEGIN
  ALTER TABLE "figma_fetch_job"
    ADD CONSTRAINT "figma_fetch_job_triggered_by_user_id_user_id_fk"
    FOREIGN KEY ("triggered_by_user_id")
    REFERENCES "public"."user"("id")
    ON DELETE set null
    ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
