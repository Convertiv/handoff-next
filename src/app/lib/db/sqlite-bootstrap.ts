import type Database from 'better-sqlite3';

/**
 * Idempotent SQLite DDL for local mode. Kept in code so it works when the Next app
 * runs from `<workingPath>/.handoff/app/` without relying on `node_modules/.../migrations` paths.
 */
export function runSqliteBootstrap(db: Database.Database): void {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
CREATE TABLE IF NOT EXISTS "user" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text,
  "email" text NOT NULL UNIQUE,
  "emailVerified" integer,
  "image" text,
  "role" text NOT NULL DEFAULT 'member',
  "password_hash" text
);

CREATE TABLE IF NOT EXISTS "password_reset_token" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL,
  "expires_at" integer NOT NULL,
  "used_at" integer
);

CREATE TABLE IF NOT EXISTS "account" (
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "type" text NOT NULL,
  "provider" text NOT NULL,
  "providerAccountId" text NOT NULL,
  "refresh_token" text,
  "access_token" text,
  "expires_at" integer,
  "token_type" text,
  "scope" text,
  "id_token" text,
  "session_state" text,
  PRIMARY KEY ("provider", "providerAccountId")
);

CREATE TABLE IF NOT EXISTS "session" (
  "sessionToken" text PRIMARY KEY NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "expires" integer NOT NULL
);

CREATE TABLE IF NOT EXISTS "verificationToken" (
  "identifier" text NOT NULL,
  "token" text NOT NULL,
  "expires" integer NOT NULL,
  PRIMARY KEY ("identifier", "token")
);

CREATE TABLE IF NOT EXISTS "handoff_component" (
  "id" text PRIMARY KEY NOT NULL,
  "path" text,
  "title" text NOT NULL DEFAULT '',
  "description" text,
  "group" text,
  "image" text,
  "type" text,
  "properties" text,
  "previews" text,
  "data" text,
  "source" text NOT NULL DEFAULT 'disk',
  "created_at" integer DEFAULT (unixepoch()),
  "updated_at" integer DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "handoff_pattern" (
  "id" text PRIMARY KEY NOT NULL,
  "path" text,
  "title" text NOT NULL DEFAULT '',
  "description" text,
  "group" text,
  "tags" text,
  "components" text,
  "data" text,
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "source" text NOT NULL DEFAULT 'build',
  "thumbnail" text,
  "created_at" integer DEFAULT (unixepoch()),
  "updated_at" integer DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "handoff_design_artifact" (
  "id" text PRIMARY KEY NOT NULL,
  "title" text NOT NULL DEFAULT '',
  "description" text NOT NULL DEFAULT '',
  "status" text NOT NULL DEFAULT 'draft',
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "image_url" text NOT NULL DEFAULT '',
  "source_images" text NOT NULL DEFAULT '[]',
  "component_guides" text NOT NULL DEFAULT '[]',
  "foundation_context" text NOT NULL DEFAULT '{}',
  "conversation_history" text NOT NULL DEFAULT '[]',
  "metadata" text NOT NULL DEFAULT '{}',
  "assets" text NOT NULL DEFAULT '[]',
  "assets_status" text NOT NULL DEFAULT 'none',
  "public_access" integer NOT NULL DEFAULT 0,
  "created_at" integer DEFAULT (unixepoch()),
  "updated_at" integer DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "handoff_tokens_snapshot" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "payload" text NOT NULL,
  "created_at" integer DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "edit_history" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "diff" text,
  "created_at" integer DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "handoff_event_log" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "category" text NOT NULL,
  "event_type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'success',
  "actor_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "route" text,
  "entity_type" text,
  "entity_id" text,
  "duration_ms" integer,
  "error" text,
  "provider" text,
  "model" text,
  "estimated_input_tokens" integer,
  "estimated_output_tokens" integer,
  "estimated_cost_usd" real,
  "request_preview" text,
  "metadata" text NOT NULL DEFAULT '{}',
  "created_at" integer DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "component_build_job" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "component_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "error" text,
  "created_at" integer DEFAULT (unixepoch()),
  "completed_at" integer
);

CREATE TABLE IF NOT EXISTS "figma_fetch_job" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "error" text,
  "triggered_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" integer DEFAULT (unixepoch()),
  "completed_at" integer
);

CREATE TABLE IF NOT EXISTS "handoff_page" (
  "slug" text PRIMARY KEY NOT NULL,
  "frontmatter" text NOT NULL DEFAULT '{}',
  "markdown" text NOT NULL DEFAULT '',
  "created_at" integer DEFAULT (unixepoch()),
  "updated_at" integer DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "sync_event" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" text NOT NULL,
  "action" text NOT NULL,
  "payload" text,
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" integer DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS "handoff_reference_material" (
  "id" text PRIMARY KEY NOT NULL,
  "content" text NOT NULL DEFAULT '',
  "generated_at" integer DEFAULT (unixepoch()),
  "metadata" text NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS "component_generation_job" (
  "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  "artifact_id" text NOT NULL REFERENCES "handoff_design_artifact"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "component_id" text NOT NULL,
  "renderer" text NOT NULL DEFAULT 'handlebars',
  "status" text NOT NULL DEFAULT 'queued',
  "iteration" integer NOT NULL DEFAULT 0,
  "max_iterations" integer NOT NULL DEFAULT 3,
  "a11y_standard" text NOT NULL DEFAULT 'none',
  "behavior_prompt" text NOT NULL DEFAULT '',
  "use_extracted_assets" integer NOT NULL DEFAULT 1,
  "generation_log" text NOT NULL DEFAULT '[]',
  "validation_results" text NOT NULL DEFAULT '{}',
  "visual_score" real,
  "last_build_job_id" integer,
  "error" text,
  "created_at" integer DEFAULT (unixepoch()),
  "completed_at" integer
);

CREATE INDEX IF NOT EXISTS "component_generation_job_artifact_id_idx"
  ON "component_generation_job" ("artifact_id");
CREATE INDEX IF NOT EXISTS "component_generation_job_user_id_idx"
  ON "component_generation_job" ("user_id");

INSERT OR IGNORE INTO "user" ("id", "email", "name", "role") VALUES ('local', 'local@handoff.local', 'Local dev', 'admin');
`);
}
