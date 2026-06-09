-- Migration 0004: handoff_validation_run — append-only health snapshots for trend history.
-- Idempotent via IF NOT EXISTS.
CREATE TABLE IF NOT EXISTS "handoff_validation_run" (
  "id" serial PRIMARY KEY NOT NULL,
  "run_at" timestamp DEFAULT now() NOT NULL,
  "trigger" text DEFAULT 'push' NOT NULL,
  "score" numeric(5, 2),
  "grade" text,
  "total_components" integer DEFAULT 0 NOT NULL,
  "validated_components" integer DEFAULT 0 NOT NULL,
  "total_errors" integer DEFAULT 0 NOT NULL,
  "total_warnings" integer DEFAULT 0 NOT NULL,
  "total_infos" integer DEFAULT 0 NOT NULL,
  "passed_validators" integer DEFAULT 0 NOT NULL,
  "skipped_validators" integer DEFAULT 0 NOT NULL,
  "validator_breakdown" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "component_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL
);
