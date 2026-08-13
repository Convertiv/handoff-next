/**
 * The level collapse (reflow R.4): a submitted page opens straight from the template it came from.
 *
 * **What only a database can answer**: `listBuildsForPage` is now a UNION over two descent paths — the new one
 * (`provenance.templateId`) and the legacy chain (`template_id` → a brief snapshotted from this page). A page
 * backfilled by 0029 has *both*, so the obvious version lists it twice; and the legacy half filters on the
 * brief's own status, which an OR-with-LEFT-JOIN would have turned into "drop every new-model page".
 *
 *   SCRATCH_DATABASE_URL='postgres://postgres:test@localhost:55438/handoff_test?sslmode=disable' \
 *     npx tsx --conditions=react-server scripts/verify-level-collapse.ts
 */

import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const url = process.env.SCRATCH_DATABASE_URL;
if (!url) {
  console.error('SCRATCH_DATABASE_URL is required. Point it at a throwaway database.');
  process.exit(1);
}
if (/neon\.tech|supabase|amazonaws|render\.com|prod/i.test(url)) {
  console.error('Refusing to run: SCRATCH_DATABASE_URL looks like a hosted database.');
  process.exit(1);
}
process.env.DATABASE_URL = url;

const MIGRATIONS = path.join(process.cwd(), 'src/app/lib/db/migrations');
const sql = postgres(url, { max: 1, onnotice: () => {} });

let failures = 0;
function check(name: string, pass: boolean, detail?: unknown) {
  console.log(`${pass ? '✓' : '✗'} ${name}${!pass && detail !== undefined ? `  ← ${JSON.stringify(detail)}` : ''}`);
  if (!pass) failures += 1;
}

async function migrate() {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const entry of journal.entries) {
    for (const statement of fs.readFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), 'utf8').split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await sql.unsafe(trimmed);
    }
  }
}

const prov = (templateId: string) => sql.json({ templateId, forkedAt: '2026-08-10T00:00:00Z', blocks: [] });

async function main() {
  console.log('— migrating');
  await migrate();

  const { listBuildsForPage } = await import('../src/app/lib/db/queries');
  const { submissionBelongsToTemplate, levelFor } = await import('../src/app/lib/workbench-level');

  console.log('— seeding a template with both kinds of descendant');
  await sql`INSERT INTO "user" (id, email) VALUES ('u_owner', 'o@example.com') ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO handoff_pattern (id, title, components, source, kind, user_id, visibility, status, template_id,
                                 source_page_id, brief_version, provenance, updated_at)
    VALUES
      ('tpl',       'The template',  '[]'::jsonb, 'playground', 'template', 'u_owner', 'team',    'draft',  NULL,    NULL,  NULL, NULL, now()),
      -- New model: no brief anywhere, provenance names the template.
      ('new_1',     'Built new',     '[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'review', NULL,    NULL,  NULL, ${prov('tpl')}::jsonb, now()),
      -- Legacy: a brief cut from the template, and a build hanging off the brief.
      ('brief_1',   'Brief v1',      '[]'::jsonb, 'template',   'brief',    'u_owner', 'team',    'draft',  NULL,    'tpl', 1,    NULL, now()),
      ('legacy_1',  'Built legacy',  '[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'review', 'brief_1', NULL, NULL, NULL, now()),
      -- Backfilled by 0029: BOTH a brief chain and provenance. Must appear exactly once.
      ('both_1',    'Backfilled',    '[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'review', 'brief_1', NULL, NULL, ${prov('tpl')}::jsonb, now()),
      -- Someone else's, and an archived one: neither belongs in the list.
      ('other',     'Another page',  '[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'review', NULL,    NULL,  NULL, ${prov('tpl_other')}::jsonb, now()),
      ('archived_1','Archived',      '[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'archived', NULL,  NULL,  NULL, ${prov('tpl')}::jsonb, now())
    ON CONFLICT (id) DO NOTHING`;

  const builds = await listBuildsForPage('tpl');
  const ids = builds.map((b) => b.id).sort();
  check('lists both descent paths', ids.join(',') === 'both_1,legacy_1,new_1', ids);
  check('a backfilled page appears exactly once', builds.filter((b) => b.id === 'both_1').length === 1, builds.length);
  check('another template’s page is not listed', !ids.includes('other'), ids);
  check('an archived page is not listed', !ids.includes('archived_1'), ids);

  const byId = Object.fromEntries(builds.map((b) => [b.id, b]));
  check('a new-model page reports no brief', byId.new_1?.briefId === null, byId.new_1);
  check('a legacy page still reports its brief', byId.legacy_1?.briefId === 'brief_1', byId.legacy_1);
  check(
    'a backfilled page opens directly, not through its old brief',
    byId.both_1?.briefId === null,
    byId.both_1
  );

  console.log('\n— what may appear inside this template’s shell');
  const rows = Object.fromEntries(
    (await sql`SELECT id, provenance FROM handoff_pattern`).map((r) => [r.id, r])
  );
  check('a page whose provenance names this template may', submissionBelongsToTemplate(rows.new_1, 'tpl') === true);
  check('another template’s page may not', submissionBelongsToTemplate(rows.other, 'tpl') === false);
  check('a page with no provenance may not', submissionBelongsToTemplate(rows.legacy_1, 'tpl') === false);
  check('nothing at all may not', submissionBelongsToTemplate(null, 'tpl') === false);

  // The collapse itself: a build id with no brief is now a level rather than an inconsistent URL.
  check('?build= alone is a level', levelFor(false, true) === 'build');
  check('?brief= alone still is', levelFor(true, false) === 'brief');
  check('neither is the page', levelFor(false, false) === 'page');

  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
  await sql.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
