-- Phase 0 perf hardening (Workbench & Playground roadmap, Part 1).
-- These hot tables previously had NO index beyond the primary key, so every
-- Library / playground list did a full table scan + in-memory sort on updated_at,
-- dragging large JSONB blobs along. All statements idempotent.

-- Saved design workbench outputs.
-- getDesignArtifacts() filters user_id/status and always ORDER BY updated_at DESC.
-- Composite (user_id, updated_at DESC) serves the owner-scoped list ordered.
CREATE INDEX IF NOT EXISTS "design_artifact_user_updated_idx" ON "handoff_design_artifact" ("user_id", "updated_at" DESC);
CREATE INDEX IF NOT EXISTS "design_artifact_status_idx" ON "handoff_design_artifact" ("status");

-- Playground patterns.
-- getDbPatternsFiltered() filters source and ORDER BY updated_at DESC; user_id
-- indexed ahead of Part-2 owner scoping.
CREATE INDEX IF NOT EXISTS "pattern_updated_idx" ON "handoff_pattern" ("updated_at" DESC);
CREATE INDEX IF NOT EXISTS "pattern_source_idx" ON "handoff_pattern" ("source");
CREATE INDEX IF NOT EXISTS "pattern_user_idx" ON "handoff_pattern" ("user_id");

-- Components: occasional ORDER BY updated_at on the full table.
CREATE INDEX IF NOT EXISTS "component_updated_idx" ON "handoff_component" ("updated_at");

-- Image slots: getImageSlotsForComponent() filters component_id (unindexed FK).
CREATE INDEX IF NOT EXISTS "image_slot_component_idx" ON "handoff_image_slot" ("component_id");

-- Event log: AI-cost queries filter category + created_at range on an append-only,
-- ever-growing table.
CREATE INDEX IF NOT EXISTS "event_log_category_created_idx" ON "handoff_event_log" ("category", "created_at");

-- Pattern change log: queried by pattern_id.
CREATE INDEX IF NOT EXISTS "pattern_change_pattern_idx" ON "handoff_pattern_change" ("pattern_id");
