-- Add brand token trees to the DTCG singleton row.
-- Stores per-brand DTCG token files parsed from CSS brand files (theme.css + brands/*.css).
-- Shape: { shared: { gray: { ... } }, resolvet: { ... }, hagyard: { ... } }
ALTER TABLE handoff_registry_dtcg
  ADD COLUMN IF NOT EXISTS brands JSONB NOT NULL DEFAULT '{}';
