-- Migration 0005: handoff_component_version — immutable version snapshots per component.
-- One row is appended every time a push results in a detectable change.
-- Idempotent via IF NOT EXISTS / IF NOT EXISTS index.

CREATE TABLE IF NOT EXISTS "handoff_component_version" (
  "id" serial PRIMARY KEY NOT NULL,
  "component_id" text NOT NULL REFERENCES "handoff_component"("id") ON DELETE CASCADE,
  "version_number" integer NOT NULL,
  "pushed_at" timestamp DEFAULT now() NOT NULL,
  "pushed_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "pushed_by_name" text,
  "pushed_by_email" text,
  "trigger" text DEFAULT 'push' NOT NULL,
  "snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "change_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "source_file_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "artifact_filenames" jsonb DEFAULT '[]'::jsonb NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "component_version_unique"
  ON "handoff_component_version" ("component_id", "version_number");
