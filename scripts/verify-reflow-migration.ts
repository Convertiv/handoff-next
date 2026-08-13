/**
 * Run the R.0 migration against a real Postgres and check the backfill — including that running it twice
 * changes nothing.
 *
 * **Why this exists as a script rather than a unit test.** The interesting parts of `0029_pages_templates_reflow`
 * are SQL: a CHECK constraint, a partial expression index, and two backfill UPDATEs that join briefs to the pages
 * built from them. None of that can be asserted against a mock — the last two schema moves both had a defect
 * (a rejected FK on a hard-deleted parent; a journal `when` that silently skipped the file) that only a real
 * database would have shown.
 *
 * Usage — point it at a **throwaway** database, never a real one:
 *
 *   docker run -d --name handoff-r0-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=handoff_test \
 *     -p 55433:5432 postgres:16-alpine
 *   SCRATCH_DATABASE_URL=postgres://postgres:test@localhost:55433/handoff_test \
 *     npx tsx scripts/verify-reflow-migration.ts
 *
 * It refuses to run against anything that looks like a real deployment.
 */

import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const url = process.env.SCRATCH_DATABASE_URL;
if (!url) {
  console.error('SCRATCH_DATABASE_URL is required. Point it at a throwaway database — this script drops tables.');
  process.exit(1);
}
/**
 * A guard, not a formality. This script drops and rewrites tables, and the one thing standing between it and a
 * real registry is the operator remembering which URL they exported.
 */
if (/neon\.tech|supabase|amazonaws|render\.com|prod/i.test(url)) {
  console.error('Refusing to run: SCRATCH_DATABASE_URL looks like a hosted database.');
  process.exit(1);
}

const MIGRATIONS = path.join(process.cwd(), 'src/app/lib/db/migrations');
const sql = postgres(url, { max: 1, onnotice: () => {} });

let failures = 0;
function check(name: string, pass: boolean, detail?: unknown) {
  console.log(`${pass ? '✓' : '✗'} ${name}${!pass && detail !== undefined ? `  ← ${JSON.stringify(detail)}` : ''}`);
  if (!pass) failures += 1;
}

/**
 * Tags already applied in this run.
 *
 * Needed because the point of the exercise is to apply 0029 **twice**, and the migrations before it are not
 * idempotent (0000 creates tables outright, as a first migration should). Drizzle tracks this in
 * `drizzle.__drizzle_migrations`; here a set is enough.
 */
const applied = new Set<string>();

/** Apply one migration file, statement breakpoints and all. */
async function applyMigration(tag: string): Promise<void> {
  const file = path.join(MIGRATIONS, `${tag}.sql`);
  if (!fs.existsSync(file)) throw new Error(`journal names ${tag} but ${file} does not exist`);
  for (const statement of fs.readFileSync(file, 'utf8').split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) await sql.unsafe(trimmed);
  }
  applied.add(tag);
}

/** Apply every migration in journal order, exactly as the app's auto-migrate does. */
async function applyThrough(tag: string): Promise<void> {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const entry of journal.entries) {
    if (!applied.has(entry.tag)) await applyMigration(entry.tag);
    if (entry.tag === tag) return;
  }
  throw new Error(`journal has no entry for ${tag}`);
}

async function main() {
  console.log('— applying migrations up to 0028 (the state a deployed registry is in today)');
  await applyThrough('0028_invite_to_build');

  console.log('— seeding legacy fixtures');
  const now = new Date('2026-08-01T10:00:00Z');
  const later = new Date('2026-08-05T10:00:00Z');

  // A page someone authored, plus two briefs cut from it, plus the pages guests built from each.
  await sql`
    INSERT INTO handoff_pattern (id, title, components, source, source_page_id, brief_version, template_id,
                                 submitted_by_email, share_link_token, created_at, updated_at)
    VALUES
      ('page_1',  'Campaign page', ${sql.json([{ id: 'hero' }])}::jsonb, 'playground', NULL, NULL, NULL, NULL, NULL, ${now}, ${later}),
      ('brief_1', 'Campaign v1',   ${sql.json([{ id: 'hero' }, { id: 'cta' }])}::jsonb, 'template', 'page_1', 1, NULL, NULL, NULL, ${now}, ${now}),
      ('brief_2', 'Campaign v2',   ${sql.json([{ id: 'hero' }, { id: 'cards' }])}::jsonb, 'template', 'page_1', 2, NULL, NULL, NULL, ${later}, ${later}),
      -- A guest's page, built from v1.
      ('built_1', 'Rep A page',    ${sql.json([{ id: 'hero' }])}::jsonb, 'guest', NULL, NULL, 'brief_1', 'rep-a@example.com', 'tok_a', ${later}, ${later}),
      -- A second guest, built from v2.
      ('built_2', 'Rep B page',    ${sql.json([{ id: 'hero' }])}::jsonb, 'guest', NULL, NULL, 'brief_2', 'rep-b@example.com', 'tok_b', ${later}, ${later}),
      -- ⚠️ The edge case 0028 was bitten by: a brief whose parent page was hard-deleted.
      ('brief_x', 'Orphan brief',  ${sql.json([{ id: 'hero' }])}::jsonb, 'template', NULL, NULL, NULL, NULL, NULL, ${now}, ${now}),
      ('built_x', 'Orphan build',  ${sql.json([{ id: 'hero' }])}::jsonb, 'guest', NULL, NULL, 'brief_x', NULL, NULL, ${later}, ${later}),
      -- A plain authored page that must come out the other side untouched.
      ('page_2',  'Just a page',   ${sql.json([{ id: 'hero' }])}::jsonb, 'playground', NULL, NULL, NULL, NULL, NULL, ${now}, ${now})
    ON CONFLICT (id) DO NOTHING`;

  console.log('\n— applying 0029');
  await applyThrough('0029_pages_templates_reflow');

  const kinds = Object.fromEntries(
    (await sql`SELECT id, kind FROM handoff_pattern ORDER BY id`).map((r) => [r.id, r.kind])
  );
  check('a brief is classified as a brief, not as a template', kinds.brief_1 === 'brief' && kinds.brief_2 === 'brief', kinds);
  check('guest submissions are pages', kinds.built_1 === 'page' && kinds.built_2 === 'page', kinds);
  check('an authored page is a page', kinds.page_1 === 'page' && kinds.page_2 === 'page', kinds);

  const rows = Object.fromEntries(
    (await sql`SELECT id, provenance, template_id FROM handoff_pattern ORDER BY id`).map((r) => [r.id, r])
  );

  const p1 = rows.built_1.provenance;
  check('provenance names the TEMPLATE (the page), not the brief', p1?.templateId === 'page_1', p1?.templateId);
  check('it carries the copy the guest was handed', JSON.stringify(p1?.blocks) === JSON.stringify([{ id: 'hero' }, { id: 'cta' }]), p1?.blocks);
  check('v2 gets v2 blocks, not v1', JSON.stringify(rows.built_2.provenance?.blocks) === JSON.stringify([{ id: 'hero' }, { id: 'cards' }]), rows.built_2.provenance?.blocks);
  check('the email and link come along', p1?.submittedByEmail === 'rep-a@example.com' && p1?.shareLinkToken === 'tok_a', p1);
  check('reconstructed records say so', p1?.legacy === true && p1?.legacyBriefId === 'brief_1' && p1?.legacyBriefVersion === 1, p1);
  check('timestamps are ISO-8601', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(p1?.forkedAt ?? ''), p1?.forkedAt);

  // The orphan: it still gets the copy it was handed, without a template link it cannot honestly claim.
  const px = rows.built_x.provenance;
  check('an orphaned build keeps its copy', JSON.stringify(px?.blocks) === JSON.stringify([{ id: 'hero' }]), px?.blocks);
  check('an orphaned build claims no template', px?.templateId === undefined, px);

  check('template_id is untouched — today’s review diff still works', rows.built_1.template_id === 'brief_1', rows.built_1.template_id);
  check('an authored page gets no provenance', rows.page_2.provenance === null, rows.page_2.provenance);

  // ── The claim that matters: it is safe to run again ────────────────────────
  console.log('\n— re-running 0029 (auto-migrate runs on every boot; a second pass must be a no-op)');
  const before = await sql`SELECT id, kind, provenance, template_id FROM handoff_pattern ORDER BY id`;
  // Simulate a hand-reclassified row: the re-run must respect it rather than reverting it.
  await sql`UPDATE handoff_pattern SET kind = 'template' WHERE id = 'brief_2'`;
  await applyMigration('0029_pages_templates_reflow');
  const after = await sql`SELECT id, kind, provenance, template_id FROM handoff_pattern ORDER BY id`;

  const unchanged = before
    .filter((b) => b.id !== 'brief_2')
    .every((b) => JSON.stringify(b) === JSON.stringify(after.find((a) => a.id === b.id)));
  check('a second run changes nothing', unchanged);
  check('a hand-reclassified row is not reverted', after.find((r) => r.id === 'brief_2')?.kind === 'template');

  // ── Constraints do what they say ──────────────────────────────────────────
  const oneAuthor = async (userId: string | null, email: string | null) => {
    try {
      await sql`INSERT INTO handoff_page_note (pattern_id, author_user_id, author_guest_email, body)
                VALUES ('page_1', ${userId}, ${email}, 'hi')`;
      return 'accepted';
    } catch (e) {
      return (e as { code?: string }).code === '23514' ? 'rejected' : `error:${(e as Error).message}`;
    }
  };
  check('a note from a guest is accepted', (await oneAuthor(null, 'someone@example.com')) === 'accepted');
  check('a note from nobody is rejected', (await oneAuthor(null, null)) === 'rejected');
  check('a note from both is rejected', (await oneAuthor(null, 'x@y.z')) === 'accepted' && (await oneAuthor('u1', 'x@y.z')) === 'rejected');

  const idx = await sql`SELECT indexname FROM pg_indexes WHERE tablename = 'handoff_pattern'`;
  check(
    'the provenance lookup index exists',
    idx.some((r) => r.indexname === 'pattern_provenance_template_idx'),
    idx.map((r) => r.indexname)
  );

  // Cascade: deleting a page takes its thread with it, and must not be blocked by it.
  await sql`DELETE FROM handoff_pattern WHERE id = 'page_1'`;
  const orphanNotes = await sql`SELECT count(*)::int AS n FROM handoff_page_note`;
  check('notes cascade with their page', orphanNotes[0].n === 0, orphanNotes[0]);

  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
  await sql.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
