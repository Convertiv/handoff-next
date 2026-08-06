-- Invite to Build, step 1: the brief object (see docs/INVITE-TO-BUILD.md).
-- ADDITIVE only, every statement idempotent, and the backfill is guarded so a re-run is a no-op.
--
-- Numbering note: check `select max(created_at) from drizzle.__drizzle_migrations` before hand-authoring the
-- next one. Drizzle skips any journal entry whose `when` is not greater than the newest applied row — and it
-- still logs "database schema is up to date" while doing so. That cost a debugging session on 0027.

-- ── The brief ────────────────────────────────────────────────────────────────
-- A brief is a frozen, versioned snapshot of a page. `source_page_id` is the page it came from; distinct from
-- `template_id`, which on a *built page* means "the brief I was built from". Opposite directions — conflating
-- them would invert every diff that reads `template_id`.
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "source_page_id" text;

-- SET NULL, not CASCADE: a brief records what outsiders were sent, so it must outlive its parent page.
DO $$
BEGIN
  ALTER TABLE "handoff_pattern"
    ADD CONSTRAINT "handoff_pattern_source_page_id_fk"
    FOREIGN KEY ("source_page_id") REFERENCES "handoff_pattern"("id") ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS "pattern_source_page_idx" ON "handoff_pattern" ("source_page_id");

-- Stored, never derived. Deleting v2 must leave v3 as v3 — a computed ordinal renumbers and silently
-- invalidates every "we sent them v3" conversation.
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "brief_version" integer;

-- On a built page: the email its author gave, for state-change notifications. Collected with disclosure.
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "submitted_by_email" text;

-- ── Passphrase on an invite link ─────────────────────────────────────────────
-- scrypt, not the SHA-256 used for link secrets: right for a high-entropy token, wrong for four
-- human-memorable words. Attempts are counted per link with a resettable temporary lock — never a permanent
-- ban, which would let an attacker lock out the legitimate recipient with ten wrong guesses.
ALTER TABLE "handoff_share_link" ADD COLUMN IF NOT EXISTS "passphrase_hash" text;
ALTER TABLE "handoff_share_link" ADD COLUMN IF NOT EXISTS "passphrase_salt" text;
ALTER TABLE "handoff_share_link" ADD COLUMN IF NOT EXISTS "attempt_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "handoff_share_link" ADD COLUMN IF NOT EXISTS "locked_until" timestamp;

-- ── Publication log ─────────────────────────────────────────────────────────
-- "Published" is NOT a lifecycle state: a page can go to WordPress *and* HubSpot, be pushed then reverted, or
-- succeed in one and fail in another. None of that fits in an enum value, and the plugin roadmap guarantees
-- more than one destination. The UI chip is derived from "has >=1 successful publication".
CREATE TABLE IF NOT EXISTS "handoff_publication" (
  "id" serial PRIMARY KEY,
  "pattern_id" text NOT NULL REFERENCES "handoff_pattern"("id") ON DELETE CASCADE,
  "destination" text NOT NULL,
  "external_id" text,
  "external_url" text,
  "status" text NOT NULL DEFAULT 'ok',
  "error" text,
  "published_by_user_id" text,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "publication_pattern_idx" ON "handoff_publication" ("pattern_id");
CREATE INDEX IF NOT EXISTS "publication_destination_idx" ON "handoff_publication" ("destination", "created_at");

-- ── Backfill existing briefs from the audit trail ───────────────────────────
-- `savePageAsTemplate` records {action:'save-as-template', fromPageId} in edit_history, so the parent link is
-- recoverable. This is the payoff for keeping provenance in the audit trail rather than overloading
-- `template_id`: that shortcut would have left nothing to backfill from.
--
-- The EXISTS guard matters: `removePattern` hard-deletes today, so a brief can name a page that is gone. Without
-- it the FK would reject the update and the whole migration would fail.
UPDATE "handoff_pattern" p
SET "source_page_id" = src.from_page_id
FROM (
  SELECT DISTINCT ON (eh."entity_id")
    eh."entity_id" AS pattern_id,
    eh."diff" ->> 'fromPageId' AS from_page_id
  FROM "edit_history" eh
  WHERE eh."entity_type" = 'pattern'
    AND eh."diff" ->> 'action' = 'save-as-template'
    AND eh."diff" ->> 'fromPageId' IS NOT NULL
  ORDER BY eh."entity_id", eh."created_at" ASC
) src
WHERE p."id" = src.pattern_id
  AND p."source" = 'template'
  AND p."source_page_id" IS NULL
  AND EXISTS (SELECT 1 FROM "handoff_pattern" parent WHERE parent."id" = src.from_page_id);

-- Version numbers in creation order within each parent page. Briefs whose parent could not be recovered are
-- left null rather than guessed — a wrong version number is worse than a missing one.
UPDATE "handoff_pattern" p
SET "brief_version" = ranked.rn
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "source_page_id" ORDER BY "created_at" ASC, "id" ASC) AS rn
  FROM "handoff_pattern"
  WHERE "source" = 'template' AND "source_page_id" IS NOT NULL
) ranked
WHERE p."id" = ranked."id" AND p."brief_version" IS NULL;

-- One version number per parent page. Created after the backfill (nulls never conflict), so the constraint
-- describes reality from the moment it exists. This is what turns "clicked Invite twice" into an error the
-- caller can retry rather than two briefs both claiming to be v3.
CREATE UNIQUE INDEX IF NOT EXISTS "pattern_brief_version_unique"
  ON "handoff_pattern" ("source_page_id", "brief_version")
  WHERE "source" = 'template' AND "source_page_id" IS NOT NULL AND "brief_version" IS NOT NULL;
