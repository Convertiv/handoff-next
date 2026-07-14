-- Track 6.1: record playground-page (pattern) changes in the unified changelog,
-- so Claude-driven page writes are visible + diffable like components/tokens,
-- and carry a "why" (human message + lazy AI summary). Idempotent.

CREATE TABLE IF NOT EXISTS "handoff_pattern_change" (
  "id" serial PRIMARY KEY,
  "pattern_id" text NOT NULL,
  "action" text NOT NULL,               -- created | updated | deleted
  "title" text,
  "block_count" integer,
  "pushed_at" timestamp DEFAULT now(),
  "pushed_by_user_id" text,
  "pushed_by_name" text,
  "trigger" text NOT NULL DEFAULT 'mcp',
  "message" text,
  "ai_summary" text
);
