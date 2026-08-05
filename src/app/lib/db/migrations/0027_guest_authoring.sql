-- Guest authoring, Slice 1: write-capable share links (see docs/GUEST-AUTHORING.md).
--
-- Numbered 0027, not 0025: `feature/spec-driven` owns 0025_design_spec_version and 0026_pipeline_job,
-- and both are ALREADY APPLIED to the shared dev database. Drizzle skips any journal entry whose `when`
-- is not greater than the newest applied row, so a migration authored here with a lower `when` is
-- silently ignored — the log still says "database schema is up to date". Hence `when: 1783500000000`,
-- past everything applied. Whoever merges these branches reconciles the journal.
-- ADDITIVE only, every statement idempotent. Existing read-only share links keep working
-- untouched: they have no capabilities (treated as view-only) and a null token_hash, which
-- means "the token column IS the secret" — the legacy shape.

-- What a link permits. A list rather than a boolean, because "build a page" and "submit it"
-- are independent. Default '[]' so an existing row grants nothing new by accident.
ALTER TABLE "handoff_share_link" ADD COLUMN IF NOT EXISTS "capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Secret handling for write-capable links. The URL carries "<token>.<secret>": `token` stays the
-- lookup id (non-secret, already the primary key) and `token_hash` holds the SHA-256 of the secret.
-- NULL = legacy read-only link whose `token` is itself the secret, compared directly.
ALTER TABLE "handoff_share_link" ADD COLUMN IF NOT EXISTS "token_hash" text;

-- Operator affordances: name a link, cap and count its uses, see whether it is being used.
ALTER TABLE "handoff_share_link" ADD COLUMN IF NOT EXISTS "label" text;
ALTER TABLE "handoff_share_link" ADD COLUMN IF NOT EXISTS "max_uses" integer;
ALTER TABLE "handoff_share_link" ADD COLUMN IF NOT EXISTS "use_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "handoff_share_link" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp;

-- Which template a page was built from. Enables the review diff (what did the guest change?)
-- and tells a template apart from an ordinary saved page.
-- SET NULL on delete: losing the template must not delete submitted work.
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "template_id" text;
DO $$
BEGIN
  ALTER TABLE "handoff_pattern"
    ADD CONSTRAINT "handoff_pattern_template_id_fk"
    FOREIGN KEY ("template_id") REFERENCES "handoff_pattern"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "pattern_template_idx" ON "handoff_pattern" ("template_id");

-- The link a page was created through. This is what scopes a guest to their OWN submission:
-- guest pages are owned by the link's creator, so ownership cannot do that job.
-- No FK — revoking or pruning a link must not cascade into submitted pages, and the column is
-- provenance that should outlive the link.
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "share_link_token" text;
CREATE INDEX IF NOT EXISTS "pattern_share_link_idx" ON "handoff_pattern" ("share_link_token");

-- Review-queue lookup: "everything waiting on a reviewer", which is a status-only scan today.
CREATE INDEX IF NOT EXISTS "pattern_status_idx" ON "handoff_pattern" ("status");
