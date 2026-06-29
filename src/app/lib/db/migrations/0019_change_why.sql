-- "Why" on changes: a human-authored message (from push --message, later) and
-- an AI-drafted summary generated from the diff on demand. Both nullable; UI
-- shows message when present, else ai_summary. Idempotent.

ALTER TABLE "handoff_component_version"
  ADD COLUMN IF NOT EXISTS "message" text;
ALTER TABLE "handoff_component_version"
  ADD COLUMN IF NOT EXISTS "ai_summary" text;

ALTER TABLE "handoff_token_change"
  ADD COLUMN IF NOT EXISTS "message" text;
ALTER TABLE "handoff_token_change"
  ADD COLUMN IF NOT EXISTS "ai_summary" text;

ALTER TABLE "handoff_page_change"
  ADD COLUMN IF NOT EXISTS "message" text;
ALTER TABLE "handoff_page_change"
  ADD COLUMN IF NOT EXISTS "ai_summary" text;
