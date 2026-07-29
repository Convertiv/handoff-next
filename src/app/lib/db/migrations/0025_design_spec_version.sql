-- Spec versioning (prerequisite for the spec-driven workbench).
--
-- The specification is becoming the source of truth rather than a by-product of image generation,
-- which means "what changed, when, by whom, and why" has to be durable. `handoff_design_artifact`
-- keeps `component_spec` / `component_spec_md` as the CURRENT version so every existing reader is
-- unaffected; this table is the append-only history behind it.
--
-- `diff` stores the semantic diff against the previous version, computed at write time by
-- lib/spec/diff.ts. Storing it (rather than recomputing on read) means the changelog reflects what
-- the differ actually said at the time, and a later change to the differ cannot silently rewrite
-- history.
--
-- ADDITIVE only. All statements idempotent.

CREATE TABLE IF NOT EXISTS "handoff_design_spec_version" (
  "id" serial PRIMARY KEY,
  "artifact_id" text NOT NULL,
  -- Monotonic per artifact, starting at 1. Assigned by the writer under the unique index below.
  "version" integer NOT NULL,
  "spec" jsonb NOT NULL,
  "spec_md" text,
  -- generated | edited | imported — how this version came to exist.
  "source" text NOT NULL DEFAULT 'generated',
  -- The human "why". Free text; the point of the whole table.
  "change_reason" text,
  -- Semantic diff vs the previous version (null on version 1).
  "diff" jsonb,
  "created_by_user_id" text,
  "created_at" timestamp DEFAULT now()
);

-- One row per (artifact, version): makes the version number a real constraint rather than a
-- convention, so a concurrent writer conflicts instead of silently forking history.
CREATE UNIQUE INDEX IF NOT EXISTS "design_spec_version_unique" ON "handoff_design_spec_version" ("artifact_id", "version");

-- History reads are always "this artifact, newest first".
CREATE INDEX IF NOT EXISTS "design_spec_version_artifact_idx" ON "handoff_design_spec_version" ("artifact_id", "version" DESC);
