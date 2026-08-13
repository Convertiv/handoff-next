-- Retire briefs, step 1 of 2 — the repoint (reflow R.5; see docs/PAGES-TEMPLATES-REFLOW.md).
--
-- R.0 deliberately left `template_id` pointing at the **brief** and staged the new value inside
-- `provenance.templateId`, so that main stayed deployable while the readers still expected a brief. This is
-- where the column moves and the readers move with it.
--
-- ⚠️ **NOTHING IS DROPPED HERE, on purpose.** `source_page_id` and `brief_version` are the evidence this
-- migration reasons from; dropping them in the same pass would remove the ability to re-derive the repoint if
-- it turns out to be wrong on real data — and this has never run against a real registry (nothing is deployed
-- past 0028 yet). The columns go in a later migration, once this one has run somewhere real. That is the same
-- additive-first discipline every step of this reflow has followed.
--
-- Numbering note: check `select max(created_at) from drizzle.__drizzle_migrations` before hand-authoring the
-- next one. Drizzle skips any journal entry whose `when` is not greater than the newest applied row — and it
-- still logs "database schema is up to date" while doing so.

-- ── Repoint template_id: the brief it came through → the template it came from ──
--
-- Only rows that currently point at a brief are touched, so a re-run is a no-op and a row already pointing at
-- a template is left alone. The target is the brief's own `source_page_id`, which is the page the brief was cut
-- from — the thing the reflow calls the template.
--
-- A build whose brief has no recoverable parent keeps pointing at the brief: there is nowhere honest to move
-- it, and a null would lose the only link it has. Those rows are why the legacy read path stays until the
-- columns are dropped.
UPDATE "handoff_pattern" p
SET "template_id" = b."source_page_id"
FROM "handoff_pattern" b
WHERE p."template_id" = b."id"
  AND b."kind" = 'brief'
  AND b."source_page_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "handoff_pattern" parent WHERE parent."id" = b."source_page_id");

-- ── Provenance and the column now agree ─────────────────────────────────────
--
-- 0029 wrote `provenance.templateId` for every page it could reconstruct, but a page created *between* 0029 and
-- this migration by the legacy wizard has a brief-pointing `template_id` and no provenance at all. Give those
-- the same record, so one rule — "provenance names the template" — holds for every row afterwards.
--
-- `jsonb_strip_nulls` and the `IS NULL` guard together make this idempotent: a row that already has provenance
-- is never rewritten, so the fork copy 0029 captured cannot be flattened by this pass.
UPDATE "handoff_pattern" p
SET "provenance" = jsonb_strip_nulls(jsonb_build_object(
  'templateId', p."template_id",
  'legacy',     true
))
WHERE p."provenance" IS NULL
  AND p."source" = 'guest'
  AND p."template_id" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "handoff_pattern" t
    WHERE t."id" = p."template_id" AND t."kind" <> 'brief'
  );

-- ── Retire the brief rows themselves ────────────────────────────────────────
--
-- Archived, not deleted. A brief records what outsiders were sent, and the pages built from it still carry a
-- fork copy that was taken *from* it — deleting the row would remove the only account of an object those pages
-- refer to. Archiving hides it from every list (the same thing "delete this page" does everywhere else in this
-- codebase) and stays reversible with an UPDATE.
--
-- Guarded on the current status so a re-run is a no-op and a brief someone deliberately un-archived is left
-- alone.
UPDATE "handoff_pattern"
SET "status" = 'archived'
WHERE "kind" = 'brief' AND "status" <> 'archived';

-- ── The index that the new shape actually queries ───────────────────────────
-- "Which pages were built from this template" is now a `template_id` lookup rather than a join through briefs.
CREATE INDEX IF NOT EXISTS "pattern_template_idx" ON "handoff_pattern" ("template_id")
  WHERE "template_id" IS NOT NULL;
