-- Phase B, Stage 1: multiuser sharing/visibility foundation (ADDITIVE only).
-- Adds visibility + lifecycle columns and the grant / share-link tables. No read
-- query or route behavior changes in this stage — Stage 2 consumes these. All
-- statements idempotent.

-- Playground patterns: per-resource visibility + lifecycle status.
-- visibility: private | shared | team | public. status: prototype | draft | review | approved | archived.
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'private';
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'draft';

-- Design artifacts: per-resource visibility. public_access is retained (deprecated later);
-- backfill visibility from any already-public artifacts so behavior is preserved.
ALTER TABLE "handoff_design_artifact" ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'private';
UPDATE "handoff_design_artifact" SET "visibility" = 'public' WHERE "public_access" = true AND "visibility" <> 'public';

-- Explicit per-user grants on a resource (view | edit).
CREATE TABLE IF NOT EXISTS "handoff_resource_grant" (
  "id" serial PRIMARY KEY,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "grantee_user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "level" text NOT NULL DEFAULT 'view',
  "granted_by_user_id" text,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "resource_grant_resource_idx" ON "handoff_resource_grant" ("resource_type", "resource_id");
CREATE INDEX IF NOT EXISTS "resource_grant_grantee_idx" ON "handoff_resource_grant" ("grantee_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "resource_grant_unique" ON "handoff_resource_grant" ("resource_type", "resource_id", "grantee_user_id");

-- Tokenized share links for a resource.
CREATE TABLE IF NOT EXISTS "handoff_share_link" (
  "token" text PRIMARY KEY,
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "created_by_user_id" text,
  "expires_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "share_link_resource_idx" ON "handoff_share_link" ("resource_type", "resource_id");
