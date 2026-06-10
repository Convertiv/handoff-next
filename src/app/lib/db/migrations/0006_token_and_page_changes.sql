-- Migration 0006: handoff_token_change + handoff_page_change
-- Append-only changelog tables for tokens pushes and page pushes.
-- Idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "handoff_token_change" (
  "id" serial PRIMARY KEY NOT NULL,
  "pushed_at" timestamp DEFAULT now(),
  "trigger" text DEFAULT 'push' NOT NULL,
  "added_count" integer DEFAULT 0 NOT NULL,
  "removed_count" integer DEFAULT 0 NOT NULL,
  "modified_count" integer DEFAULT 0 NOT NULL,
  "total_count" integer DEFAULT 0 NOT NULL,
  "added_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "removed_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "modified_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "snapshot_id" integer REFERENCES "handoff_tokens_snapshot"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "handoff_page_change" (
  "id" serial PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "action" text NOT NULL,
  "pushed_at" timestamp DEFAULT now(),
  "pushed_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "pushed_by_name" text,
  "trigger" text DEFAULT 'push' NOT NULL,
  "title_before" text,
  "title_after" text,
  "markdown_length_before" integer,
  "markdown_length_after" integer
);

CREATE INDEX IF NOT EXISTS "token_change_pushed_at_idx"
  ON "handoff_token_change" ("pushed_at" DESC);

CREATE INDEX IF NOT EXISTS "page_change_slug_idx"
  ON "handoff_page_change" ("slug");

CREATE INDEX IF NOT EXISTS "page_change_pushed_at_idx"
  ON "handoff_page_change" ("pushed_at" DESC);
