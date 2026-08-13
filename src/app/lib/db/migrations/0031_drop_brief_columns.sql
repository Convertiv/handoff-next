-- Retire briefs, step 2 of 2 — the drop (reflow R.5b).
--
-- 0030 repointed `template_id` from briefs to templates and archived every brief row, and it **kept**
-- `source_page_id` and `brief_version` on purpose: they are the evidence that repoint reasons from, and at the
-- time it had never run against a real registry. It has now — the migration applied and a guest built a page,
-- returned to it through its link, and edited it (Brad, 2026-08-13). That was the precondition.
--
-- ⚠️ **This one is not reversible.** Everything else in this reflow could be undone with an UPDATE; dropping a
-- column loses what was in it. What is lost is only the brief-era bookkeeping: which page a brief was cut from,
-- and which version it was. The pages built through those briefs keep their own record — `provenance` holds the
-- copy they were handed and the template they came from, which is what a reviewer actually reads.
--
-- Numbering note: check `select max(created_at) from drizzle.__drizzle_migrations` before hand-authoring the
-- next one. Drizzle skips any journal entry whose `when` is not greater than the newest applied row — and it
-- still logs "database schema is up to date" while doing so.

-- ── The index that enforced one version number per parent page ──────────────
-- Partial-unique on (source_page_id, brief_version); both columns are going.
DROP INDEX IF EXISTS "pattern_brief_version_unique";

-- ── The lookup index for "briefs of this page" ──────────────────────────────
-- The query it served (`listBriefsForPage`) was deleted in R.5.
DROP INDEX IF EXISTS "pattern_source_page_idx";

-- ── The self-referencing FK ─────────────────────────────────────────────────
-- Postgres drops a column's constraints with the column, but naming it makes the intent legible in the diff
-- rather than implicit in a cascade.
ALTER TABLE "handoff_pattern" DROP CONSTRAINT IF EXISTS "handoff_pattern_source_page_id_fk";

-- ── The columns ─────────────────────────────────────────────────────────────
ALTER TABLE "handoff_pattern" DROP COLUMN IF EXISTS "source_page_id";
ALTER TABLE "handoff_pattern" DROP COLUMN IF EXISTS "brief_version";
