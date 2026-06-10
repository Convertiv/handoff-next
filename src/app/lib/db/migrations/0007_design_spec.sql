-- Migration 0007: design artifact spec columns
-- Adds component spec (structured JSON), editable markdown, and spec generation status.
-- Idempotent via IF NOT EXISTS / DO $$ blocks.

ALTER TABLE "handoff_design_artifact"
  ADD COLUMN IF NOT EXISTS "component_spec"    jsonb,
  ADD COLUMN IF NOT EXISTS "component_spec_md" text,
  ADD COLUMN IF NOT EXISTS "spec_status"       text NOT NULL DEFAULT 'none';
-- spec_status: none | pending | generating | done | failed
