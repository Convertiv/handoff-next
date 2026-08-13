-- Pages / Templates reflow, step 1 — the storage (see docs/PAGES-TEMPLATES-REFLOW.md).
--
-- ADDITIVE ONLY. Every statement idempotent, every backfill guarded so a re-run is a no-op. Nothing here
-- changes what any existing reader sees: `template_id` keeps its current meaning, briefs keep working, and the
-- library keeps filtering exactly as it does today. The readers move in R.2.
--
-- Numbering note: check `select max(created_at) from drizzle.__drizzle_migrations` before hand-authoring the
-- next one. Drizzle skips any journal entry whose `when` is not greater than the newest applied row — and it
-- still logs "database schema is up to date" while doing so. That cost a debugging session on 0027.

-- ── What a row *is*, separated from how it got here ──────────────────────────
-- `source` already answers "how did this arrive" (playground / ai / import / guest) and was carrying a third
-- meaning on top: `source = 'template'` means "this is a brief". Stacking kind onto origin is what made a
-- built page's row ambiguous, so kind gets its own column and origin keeps its own.
--
--   page     — a working document. The default, and what a guest submission becomes.
--   template — a page others may build from.
--   brief    — ⚠️ TRANSITIONAL. The frozen snapshot object the reflow removes. Recorded truthfully rather than
--              relabelled as a template: briefs are versioned children of one page, and calling three of them
--              templates would put v1, v2 and v3 of the same page in the Templates lane. Retired in R.5.
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'page';

-- ── Provenance: where a page came from, and what was true when it arrived ────
-- The fork-time copy lives here rather than in a brief object. §2.1 of the reflow doc has the argument in
-- full; the short version is that removing the frozen copy from the *product* is right, and removing it from
-- *storage* would silently re-base every built page's diff against a template that has moved on.
--
-- Written once, at submit. Never edited afterwards — a provenance record that can be updated is not one.
ALTER TABLE "handoff_pattern" ADD COLUMN IF NOT EXISTS "provenance" jsonb;

-- Only pages built from something carry it, so the index is partial — this is the "show me everything built
-- from template X" query, and on a library of mostly hand-authored pages a full index would be mostly nulls.
CREATE INDEX IF NOT EXISTS "pattern_provenance_template_idx"
  ON "handoff_pattern" (("provenance" ->> 'templateId'))
  WHERE "provenance" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "pattern_kind_idx" ON "handoff_pattern" ("kind", "updated_at");

-- ── Threaded notes on a page ────────────────────────────────────────────────
-- Owner and creator talking about one page. Exactly one author column is set: a signed-in user has an id, a
-- guest has only the email they gave and the link they hold.
CREATE TABLE IF NOT EXISTS "handoff_page_note" (
  "id" serial PRIMARY KEY,
  "pattern_id" text NOT NULL REFERENCES "handoff_pattern"("id") ON DELETE CASCADE,
  -- Self-reference, one level deep by convention rather than by constraint: a reply-to-a-reply is a product
  -- decision, and forbidding it in the schema would make changing our mind a migration.
  "parent_id" integer REFERENCES "handoff_page_note"("id") ON DELETE CASCADE,
  "author_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "author_guest_email" text,
  "body" text NOT NULL,
  "resolved_at" timestamp,
  "resolved_by_user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  -- One author, and at least one. A note from nobody is unattributable, and a note from both is a bug that
  -- would otherwise surface months later as a UI that picks whichever it read first.
  CONSTRAINT "page_note_one_author" CHECK (
    ("author_user_id" IS NOT NULL AND "author_guest_email" IS NULL)
    OR ("author_user_id" IS NULL AND "author_guest_email" IS NOT NULL)
  )
);
-- The thread, in order, for one page — the only read this table has.
CREATE INDEX IF NOT EXISTS "page_note_pattern_idx" ON "handoff_page_note" ("pattern_id", "created_at");

-- ── Backfill: kind ──────────────────────────────────────────────────────────
-- Guarded on the current value so a re-run is a no-op, and so a row already reclassified by hand is left
-- alone rather than reverted by the next deploy.
UPDATE "handoff_pattern" SET "kind" = 'brief'
  WHERE "source" = 'template' AND "kind" = 'page';

-- ── Backfill: provenance for pages built from a brief ───────────────────────
-- Reconstructs, for each built page, what it was handed: the brief's blocks (the frozen copy), which page that
-- brief was cut from (the template, under the new model), and when.
--
-- `templateId` is the brief's `source_page_id` — the *page*, not the brief. This is the repoint, staged in
-- JSON where nothing reads it yet; the `template_id` column is deliberately left pointing at the brief so
-- today's review diff keeps working. R.2 moves the readers and the column together.
--
-- `legacy: true` marks a record that was reconstructed rather than written at submit. It is the difference
-- between "this is what they were given" and "this is our best reconstruction of what they were given", and a
-- reviewer is entitled to know which they are looking at.
--
-- Left null where the brief is gone or was never linked to a parent: an unrecoverable provenance record is
-- worth strictly less than an absent one, because absence is honest.
UPDATE "handoff_pattern" p
SET "provenance" = jsonb_strip_nulls(jsonb_build_object(
  'templateId',        b."source_page_id",
  'templateUpdatedAt', to_char(b."updated_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'forkedAt',          to_char(b."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'submittedAt',       to_char(p."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'submittedByEmail',  p."submitted_by_email",
  'shareLinkToken',    p."share_link_token",
  'blocks',            b."components",
  'legacy',            true,
  'legacyBriefId',     b."id",
  'legacyBriefVersion', b."brief_version"
))
FROM "handoff_pattern" b
WHERE p."template_id" = b."id"
  AND b."source" = 'template'
  AND b."source_page_id" IS NOT NULL
  AND p."provenance" IS NULL;

-- A built page whose brief has no recoverable parent still gets the copy it was handed. Same record, minus the
-- template link — which is exactly what is true about it.
UPDATE "handoff_pattern" p
SET "provenance" = jsonb_strip_nulls(jsonb_build_object(
  'forkedAt',          to_char(b."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'submittedAt',       to_char(p."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
  'submittedByEmail',  p."submitted_by_email",
  'shareLinkToken',    p."share_link_token",
  'blocks',            b."components",
  'legacy',            true,
  'legacyBriefId',     b."id",
  'legacyBriefVersion', b."brief_version"
))
FROM "handoff_pattern" b
WHERE p."template_id" = b."id"
  AND b."source" = 'template'
  AND b."source_page_id" IS NULL
  AND p."provenance" IS NULL;
