/**
 * Drive the notes layer against a real Postgres (reflow R.4).
 *
 * **What only a database can answer here**: the CHECK that a note has exactly one kind of author, the cascade
 * when a page is deleted, and the cross-page guards — a reply attaching to a thread on another page, or a note
 * id from elsewhere being resolved through a page the caller does have rights on. Those are the ones worth
 * running for real; the permission rules themselves are unit-tested in `test/authz-notes.test.ts`.
 *
 *   docker run -d --name handoff-r4-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=handoff_test \
 *     -p 55437:5432 postgres:16-alpine
 *   SCRATCH_DATABASE_URL='postgres://postgres:test@localhost:55437/handoff_test?sslmode=disable' \
 *     npx tsx --conditions=react-server scripts/verify-page-notes.ts
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

async function main() {
  console.log('— migrating');
  await migrate();

  const { addPageNote, listPageNotes, resolvePageNote, openNoteCount } = await import('../src/app/lib/db/note-queries');

  console.log('— seeding an owner, a template, and a guest-built page');
  await sql`INSERT INTO "user" (id, email, name) VALUES ('u_owner', 'owner@example.com', 'Ada') ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO handoff_pattern (id, title, components, source, kind, user_id, visibility, status, share_link_token)
    VALUES
      ('tpl_1',  'Template',   '[]'::jsonb, 'playground', 'template', 'u_owner', 'team',    'draft',  NULL),
      ('page_a', 'Rep A page', '[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'review', 'tok_template'),
      ('page_b', 'Rep B page', '[]'::jsonb, 'guest',      'page',     'u_owner', 'private', 'review', 'tok_template')
    ON CONFLICT (id) DO NOTHING`;

  const owner = { kind: 'user' as const, actor: { userId: 'u_owner', role: null, historyLabel: 'u_owner', trigger: 'ui' as const } };
  /** The page's author, holding the return link that points at page_a. */
  const author = {
    kind: 'guest' as const,
    guest: { shareLinkId: 'tok_return', resourceId: 'page_a', capabilities: ['view', 'edit_own_submission'], name: 'Rep A' },
    email: 'rep@example.com',
  } as Parameters<typeof addPageNote>[2];

  console.log('\n— the conversation');
  await addPageNote('page_a', { body: '  Can you shorten the headline?  ' }, owner);
  let notes = await listPageNotes('page_a', owner);
  check('the owner can open a thread', notes.length === 1 && notes[0].body === 'Can you shorten the headline?', notes);
  check('attributed to the signed-in name', notes[0]?.authorName === 'Ada' && notes[0]?.fromGuest === false, notes[0]);

  notes = await addPageNote('page_a', { body: 'Done — have a look.', parentId: notes[0].id }, author);
  check('the author can reply', notes.length === 2, notes.length);
  const reply = notes.find((n) => n.parentId != null);
  check('the reply is threaded under the note', reply?.parentId === notes[0].id, reply);

  /**
   * Attribution differs by side, and that is a privacy rule rather than a cosmetic one — so each side is asked
   * for its **own** view. (`notes` above is the list returned to the author, which is why it says "You"; the
   * first version of this check read that list and asserted the owner's answer against it.)
   */
  const asOwner = await listPageNotes('page_a', owner);
  const asAuthor = await listPageNotes('page_a', author);
  check(
    'the owner sees who they are talking to',
    asOwner.find((n) => n.fromGuest)?.authorName === 'rep@example.com',
    asOwner.map((n) => n.authorName)
  );
  check(
    'the author sees their own note as “You”, never an address',
    asAuthor.find((n) => n.fromGuest)?.authorName === 'You',
    asAuthor.map((n) => n.authorName)
  );

  console.log('\n— what the database has to enforce');
  let refused = '';
  try {
    await sql`INSERT INTO handoff_page_note (pattern_id, body) VALUES ('page_a', 'from nobody')`;
  } catch (e) {
    refused = (e as { code?: string }).code ?? '';
  }
  check('a note with no author is refused by the CHECK', refused === '23514', refused || '(accepted)');

  // A reply may not reach across pages, even for a caller with rights on both.
  const bTop = await addPageNote('page_b', { body: 'Separate thread' }, owner);
  let crossPage = '';
  try {
    await addPageNote('page_a', { body: 'sneaking in', parentId: bTop[0].id }, owner);
  } catch (e) {
    crossPage = (e as Error).message;
  }
  check('a reply cannot attach to another page’s thread', /not on this page/i.test(crossPage), crossPage || '(accepted)');

  // Nor may a note id from elsewhere be resolved through a page the caller does have rights on.
  await resolvePageNote('page_a', bTop[0].id, true, owner);
  const bStill = await listPageNotes('page_b', owner);
  check('resolving is scoped to the page named', bStill[0]?.resolvedAt === null, bStill[0]);

  console.log('\n— resolving');
  const top = (await listPageNotes('page_a', owner))[0];
  notes = await resolvePageNote('page_a', top.id, true, owner);
  check('the owner can mark a note done', notes.find((n) => n.id === top.id)?.resolvedAt !== null);
  check('open count drops', (await openNoteCount('page_a')) === 1, await openNoteCount('page_a'));
  notes = await resolvePageNote('page_a', top.id, false, owner);
  check('and reopen it — a toggle, not a delete', notes.find((n) => n.id === top.id)?.resolvedAt === null);

  let guestResolve = '';
  try {
    await resolvePageNote('page_a', top.id, true, author);
  } catch (e) {
    guestResolve = (e as Error).message;
  }
  check('the author cannot resolve', /cannot resolve/i.test(guestResolve), guestResolve || '(accepted)');

  console.log('\n— a decided page closes the thread to its author');
  await sql`UPDATE handoff_pattern SET status = 'approved' WHERE id = 'page_a'`;
  let closed = '';
  try {
    await addPageNote('page_a', { body: 'one more thing' }, author);
  } catch (e) {
    closed = (e as Error).message;
  }
  check('the author cannot write after a decision', /cannot add a note/i.test(closed), closed || '(accepted)');
  check('the owner still can', (await addPageNote('page_a', { body: 'noted' }, owner)).length === 3);

  console.log('\n— deleting the page');
  await sql`DELETE FROM handoff_pattern WHERE id = 'page_a'`;
  const left = (await sql`SELECT count(*)::int AS n FROM handoff_page_note WHERE pattern_id = 'page_a'`)[0].n;
  check('its notes go with it', left === 0, left);

  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
  await sql.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
