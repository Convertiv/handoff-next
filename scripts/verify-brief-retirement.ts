/**
 * Retiring briefs (reflow R.5): the repoint, and what must survive it.
 *
 * **The risk this is written against** is not that the UPDATE fails — it is that something downstream keeps
 * working *by accident* and stops working silently. `notifyBuildSubmitted` walked build → brief → page, and the
 * moment `template_id` names a template instead of a brief that second hop finds nothing and the owner's email
 * simply never arrives. Nothing throws. So the checks here follow the data through the readers, not just the
 * column.
 *
 * The whole journal runs, so 0029 and 0030 execute in the order a real deploy will run them.
 *
 *   SCRATCH_DATABASE_URL='postgres://postgres:test@localhost:55440/handoff_test?sslmode=disable' \
 *     npx tsx --conditions=react-server scripts/verify-brief-retirement.ts
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

const applied = new Set<string>();
async function applyMigration(tag: string) {
  for (const statement of fs.readFileSync(path.join(MIGRATIONS, `${tag}.sql`), 'utf8').split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) await sql.unsafe(trimmed);
  }
  applied.add(tag);
}
async function applyThrough(tag: string) {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[];
  };
  for (const entry of journal.entries) {
    if (!applied.has(entry.tag)) await applyMigration(entry.tag);
    if (entry.tag === tag) return;
  }
}

async function main() {
  console.log('— migrating to 0029 (the state R.4 left behind)');
  await applyThrough('0029_pages_templates_reflow');

  console.log('— seeding the pre-R.5 world');
  await sql`INSERT INTO "user" (id, email) VALUES ('u_owner', 'owner@example.com') ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO handoff_pattern (id, title, components, source, kind, user_id, visibility, status, template_id,
                                 source_page_id, brief_version, provenance)
    VALUES
      ('page',      'The page',     '[]'::jsonb, 'playground', 'page',     'u_owner', 'team',    'draft',  NULL,      NULL,   NULL, NULL),
      ('brief_1',   'Brief v1',     '[]'::jsonb, 'template',   'brief',    'u_owner', 'team',    'draft',  NULL,      'page', 1,    NULL),
      -- A build made through the brief, with the provenance 0029 reconstructed for it.
      ('built_1',   'Through brief','[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'review', 'brief_1', NULL,   NULL,
        ${sql.json({ templateId: 'page', forkedAt: '2026-08-01T00:00:00Z', legacy: true, blocks: [] })}::jsonb),
      -- A build made by the legacy wizard AFTER 0029 ran: brief-pointing, no provenance at all.
      ('built_2',   'No provenance','[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'review', 'brief_1', NULL,   NULL, NULL),
      -- An orphan: its brief lost its parent page, so there is nowhere honest to repoint it.
      ('brief_x',   'Orphan brief', '[]'::jsonb, 'template',   'brief',    'u_owner', 'team',    'draft',  NULL,      NULL,   NULL, NULL),
      ('built_x',   'Orphan build', '[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'review', 'brief_x', NULL,   NULL, NULL),
      -- Built the new way: already correct, and must be left exactly as it is.
      ('built_new', 'New model',    '[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'review', 'page',    NULL,   NULL,
        ${sql.json({ templateId: 'page', forkedAt: '2026-08-11T00:00:00Z', submittedAt: '2026-08-11T01:00:00Z', blocks: [] })}::jsonb)
    ON CONFLICT (id) DO NOTHING`;

  console.log('\n— applying 0030');
  await applyThrough('0030_retire_briefs');

  const rows = Object.fromEntries(
    (await sql`SELECT id, template_id, kind, status, provenance FROM handoff_pattern`).map((r) => [r.id, r])
  );

  check('a brief-built page now points at the template', rows.built_1.template_id === 'page', rows.built_1.template_id);
  check('so does one the wizard made after 0029', rows.built_2.template_id === 'page', rows.built_2.template_id);
  check('and it gained the provenance it never had', rows.built_2.provenance?.templateId === 'page', rows.built_2.provenance);
  check('a new-model page is untouched', rows.built_new.template_id === 'page', rows.built_new.template_id);
  check(
    'and its fork copy was NOT overwritten',
    rows.built_new.provenance?.submittedAt === '2026-08-11T01:00:00Z' && rows.built_new.provenance?.forkedAt === '2026-08-11T00:00:00Z',
    rows.built_new.provenance
  );
  check(
    'the reconstructed fork copy survived too',
    rows.built_1.provenance?.forkedAt === '2026-08-01T00:00:00Z' && rows.built_1.provenance?.legacy === true,
    rows.built_1.provenance
  );

  check('an orphan keeps pointing at its brief — nowhere honest to move it', rows.built_x.template_id === 'brief_x', rows.built_x.template_id);
  check('briefs are archived, not deleted', rows.brief_1.status === 'archived' && rows.brief_x.status === 'archived', {
    b1: rows.brief_1.status,
    bx: rows.brief_x.status,
  });
  check('the brief rows still exist', Boolean(rows.brief_1 && rows.brief_x));

  console.log('\n— running it again (auto-migrate runs on every boot)');
  const before = await sql`SELECT id, template_id, status, provenance FROM handoff_pattern ORDER BY id`;
  await applyMigration('0030_retire_briefs');
  const after = await sql`SELECT id, template_id, status, provenance FROM handoff_pattern ORDER BY id`;
  check('a second run changes nothing', JSON.stringify(before) === JSON.stringify(after));

  // ── The readers, which is where a silent break would live ──────────────────
  console.log('\n— the readers');
  const { listBuildsForPage, listBriefsForPage, listTemplateSubmissions } = await import('../src/app/lib/db/queries');

  const builds = await listBuildsForPage('page');
  const ids = builds.map((b) => b.id).sort();
  check('the template lists every page built from it, once each', ids.join(',') === 'built_1,built_2,built_new', ids);
  check('none of them claims a brief any more', builds.every((b) => b.briefId === null), builds.map((b) => b.briefId));

  check('the invitations dropdown is empty — briefs are gone from the UI', (await listBriefsForPage('page')).length === 0);
  const submissions = await listTemplateSubmissions('page');
  check('“submissions of a template” now means what its name says', submissions.length === 3, submissions.map((s) => s.id));

  /**
   * The silent one. `notifyBuildSubmitted` used to walk build → brief → page; with `template_id` naming a
   * template, the second hop finds nothing and the email never arrives. This asserts the resolution the fixed
   * version performs, for every shape of row.
   */
  console.log('\n— who gets told about a submission');
  const { readProvenance } = await import('../src/app/lib/page-provenance');
  const ownerPageFor = async (buildId: string) => {
    const [b] = await sql`SELECT template_id, provenance FROM handoff_pattern WHERE id = ${buildId}`;
    const firstHop = readProvenance(b.provenance)?.templateId ?? b.template_id ?? null;
    if (!firstHop) return null;
    const [t] = await sql`SELECT kind, source_page_id FROM handoff_pattern WHERE id = ${firstHop}`;
    if (!t) return null;
    return t.kind === 'brief' ? t.source_page_id : firstHop;
  };
  check('a repointed build resolves to the page', (await ownerPageFor('built_1')) === 'page');
  check('a new-model build resolves to the page', (await ownerPageFor('built_new')) === 'page');
  check('one with no provenance resolves too', (await ownerPageFor('built_2')) === 'page');
  check('an orphan still resolves through its brief, and finds nothing', (await ownerPageFor('built_x')) === null);

  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
  await sql.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
