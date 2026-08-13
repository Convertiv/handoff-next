/**
 * Drive the R.2 guest loop against a real Postgres: fork → edit the template underneath → submit.
 *
 * **What this exists to prove.** Templates are live under the reflow, so the dangerous case is a template that
 * changes while somebody is building from it. The fork copy is supposed to make that harmless, and the only
 * way to know is to actually move the template between fork and submit and then read the record back.
 *
 * It also exercises the page cap, which is the one unauthenticated write path in the product.
 *
 * Runs the write core directly — `createGuestSubmission` / `submitGuestSubmission` — not a re-implementation of
 * it in SQL. `--conditions=react-server` is what lets a `server-only` module load outside Next.
 *
 *   docker run -d --name handoff-r2-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=handoff_test \
 *     -p 55434:5432 postgres:16-alpine
 *   SCRATCH_DATABASE_URL=postgres://postgres:test@localhost:55434/handoff_test \
 *     npx tsx --conditions=react-server scripts/verify-guest-flow.ts
 */

import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const url = process.env.SCRATCH_DATABASE_URL;
if (!url) {
  console.error('SCRATCH_DATABASE_URL is required. Point it at a throwaway database — this script writes freely.');
  process.exit(1);
}
if (/neon\.tech|supabase|amazonaws|render\.com|prod/i.test(url)) {
  console.error('Refusing to run: SCRATCH_DATABASE_URL looks like a hosted database.');
  process.exit(1);
}
// The app's own connection helper reads this.
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
    const body = fs.readFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), 'utf8');
    for (const statement of body.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) await sql.unsafe(trimmed);
    }
  }
}

async function main() {
  console.log('— migrating');
  await migrate();

  const { createGuestSubmission, submitGuestSubmission } = await import('../src/app/lib/db/pattern-write');
  const { MAX_PAGES_PER_SHARE_LINK } = await import('../src/app/lib/authz/vocab');

  const AS_HANDED = [{ id: 'hero', args: { title: 'Original headline' } }];
  const AFTER_THE_OWNER_EDITED_IT = [{ id: 'hero', args: { title: 'Owner changed this later' } }, { id: 'cta' }];

  console.log('— seeding an owner and a live template');
  await sql`INSERT INTO "user" (id, email) VALUES ('u_owner', 'owner@example.com') ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO handoff_pattern (id, title, components, source, kind, user_id, visibility, status, created_at, updated_at)
    VALUES ('tpl_1', 'Campaign template', ${sql.json(AS_HANDED)}::jsonb, 'playground', 'template', 'u_owner',
            'team', 'draft', now(), now())
    ON CONFLICT (id) DO NOTHING`;
  await sql`
    INSERT INTO handoff_share_link (token, resource_type, resource_id, created_by_user_id, capabilities)
    VALUES ('tok_a', 'pattern', 'tpl_1', 'u_owner',
            ${sql.json(['create_from_template', 'use_asset_library', 'submit_for_review', 'edit_own_submission'])}::jsonb)
    ON CONFLICT (token) DO NOTHING`;

  const guest = {
    shareLinkId: 'tok_a',
    capabilities: ['create_from_template', 'use_asset_library', 'submit_for_review', 'edit_own_submission'],
    name: 'Rep A',
  } as Parameters<typeof createGuestSubmission>[1];

  console.log('\n— a visitor forks the template');
  await createGuestSubmission(
    { id: 'page_a', templateId: 'tpl_1', title: 'Rep A page', components: AS_HANDED, submittedByEmail: 'rep@example.com' },
    guest,
    'u_owner'
  );

  const forked = (await sql`SELECT kind, provenance, template_id, user_id, status FROM handoff_pattern WHERE id='page_a'`)[0];
  check('a guest submission is a page, not a kind of its own', forked.kind === 'page', forked.kind);
  check('owned by the template owner', forked.user_id === 'u_owner', forked.user_id);
  check('it points at the template', forked.template_id === 'tpl_1', forked.template_id);
  check('the fork copy is what they were handed', JSON.stringify(forked.provenance?.blocks) === JSON.stringify(AS_HANDED), forked.provenance?.blocks);
  check('the fork is timestamped', Boolean(forked.provenance?.forkedAt), forked.provenance);
  check('not yet submitted', forked.provenance?.submittedAt === undefined && forked.status === 'draft', forked.provenance);

  // ── The case the whole design turns on ──────────────────────────────────────
  console.log('\n— the owner edits the template while the visitor is still working');
  await sql`UPDATE handoff_pattern SET components = ${sql.json(AFTER_THE_OWNER_EDITED_IT)}::jsonb, updated_at = now() + interval '1 hour' WHERE id='tpl_1'`;

  console.log('— the visitor submits');
  const submitResult = submitGuestSubmission('page_a', guest, 'Done, thanks');
  await submitResult;

  const submitted = (await sql`SELECT status, provenance FROM handoff_pattern WHERE id='page_a'`)[0];
  check('status moves to review', submitted.status === 'review', submitted.status);
  check(
    'the fork copy still shows what they were handed, NOT the edited template',
    JSON.stringify(submitted.provenance?.blocks) === JSON.stringify(AS_HANDED),
    submitted.provenance?.blocks
  );
  check('the submit half was written', Boolean(submitted.provenance?.submittedAt), submitted.provenance);
  check('the fork half survived the submit write', Boolean(submitted.provenance?.forkedAt) && submitted.provenance?.templateId === 'tpl_1', submitted.provenance);

  const { templateHasMovedOn, readProvenance } = await import('../src/app/lib/page-provenance');
  const tpl = (await sql`SELECT updated_at FROM handoff_pattern WHERE id='tpl_1'`)[0];
  check('and we can tell the template moved since', templateHasMovedOn(readProvenance(submitted.provenance), tpl.updated_at) === true);

  // ── The return link (R.3) ──────────────────────────────────────────────────
  console.log('\n— the return link');
  const returned = await submitResult;
  check('submitting hands back a link, once', typeof returned.returnUrlToken === 'string' && returned.returnUrlToken.length > 10, returned.returnUrlToken);

  const { listShareLinks, getActiveShareLinkById, resolveShareLink } = await import('../src/app/lib/db/grant-queries');
  const pageLinks = await listShareLinks('pattern', 'page_a');
  check('it is scoped to the page, not the template', pageLinks.length === 1, pageLinks.map((l) => l.id));
  check('it grants edit and nothing more', JSON.stringify(pageLinks[0]?.capabilities.sort()) === JSON.stringify(['edit_own_submission', 'view']), pageLinks[0]?.capabilities);
  check('it does not expire — it is their only way back', pageLinks[0]?.expiresAt === null, pageLinks[0]?.expiresAt);

  const resolved = await resolveShareLink(returned.returnUrlToken!);
  check('the secret resolves to that link', resolved?.token === pageLinks[0]?.id, resolved?.token);
  check('and it points at the page', resolved?.resourceId === 'page_a', resolved?.resourceId);

  // The claim the authz rules rest on: the returning author is recognised by what their link points at.
  const { canGuestEditPattern } = await import('../src/app/lib/authz/guest');
  const returningGuest = {
    shareLinkId: resolved!.token,
    capabilities: ['view', 'edit_own_submission'] as const,
    name: 'Rep A',
    resourceId: resolved!.resourceId,
  };
  check('the author can edit their submitted page', canGuestEditPattern(returningGuest, { id: 'page_a', shareLinkId: 'tok_a', status: 'review' }) === true);
  check('but not a different one', canGuestEditPattern(returningGuest, { id: 'page_b_other', shareLinkId: 'tok_a', status: 'review' }) === false);

  /**
   * ⚠️ The mismatch that made R.3's link unusable, asserted directly.
   *
   * The page carries the **template** link's token, while the return link points at the **page**. Two routes
   * compared those two values inline (`row.shareLinkToken === guest.shareLinkId`) and so refused the very
   * person the link was issued to. The predicate bridges it; these checks are what would have failed before.
   */
  const { isGuestOwnPage } = await import('../src/app/lib/authz/guest');
  const pageNow = (await sql`SELECT id, share_link_token, status FROM handoff_pattern WHERE id='page_a'`)[0];
  check('the page carries the template link’s token, not the return link’s', pageNow.share_link_token === 'tok_a' && resolved!.token !== 'tok_a', {
    onRow: pageNow.share_link_token,
    held: resolved!.token,
  });
  check(
    'the shared rule recognises the author anyway',
    isGuestOwnPage(returningGuest, { id: pageNow.id, shareLinkId: pageNow.share_link_token, status: pageNow.status }) === true
  );
  check(
    'their link claims nothing about another page under the same owner',
    isGuestOwnPage(returningGuest, { id: 'page_other', shareLinkId: 'tok_a', status: 'draft' }) === false
  );

  // Revocation is what makes an emailed bearer credential acceptable.
  const { revokeShareLink } = await import('../src/app/lib/db/grant-queries');
  await revokeShareLink(pageLinks[0]!.id, { userId: 'u_owner', role: null });
  check('a revoked return link stops resolving', (await getActiveShareLinkById(pageLinks[0]!.id)) === null);
  check('the page it opened is untouched', (await sql`SELECT count(*)::int AS n FROM handoff_pattern WHERE id='page_a'`)[0].n === 1);

  /**
   * ⚠️ **The resume rule** — the bug Brad hit on the deployed preview.
   *
   * A returning author's session names their page, but the old check demanded `status === 'draft'` AND a
   * matching share token. Their page is `review` and carries the *template's* token, so both failed, the
   * request fell through to "create from template", and the link greeted its own author with
   * "This link does not allow creating a page from this template."
   */
  console.log('\n— coming back with the return link');
  const resumeRef = { id: 'page_a', shareLinkId: pageNow.share_link_token, status: pageNow.status };
  const oldRule = pageNow.status === 'draft' && pageNow.share_link_token === live!.token;
  check('the old rule would have refused them', oldRule === false, { status: pageNow.status });
  const holdsReturn = returningGuest.resourceId === 'page_a';
  check('the new rule resumes: they hold a link pointing at this page', isGuestOwnPage(returningGuest, resumeRef) && holdsReturn);
  check(
    'a template-link holder with a submitted draft still falls through to a fresh page',
    !(pageNow.status === 'draft') && guest.shareLinkId !== 'page_a'
  );

  // ── Builder notes live on the template, where every reader already looks ───
  console.log('\n— instructions and limits, written to the template');
  const { setTemplateBuilderNotes } = await import('../src/app/lib/db/pattern-write');
  const owner = { userId: 'u_owner', role: 'admin', historyLabel: 'u_owner', trigger: 'ui' } as Parameters<
    typeof setTemplateBuilderNotes
  >[2];

  await setTemplateBuilderNotes(
    'tpl_1',
    { instructions: '  Keep it short. Speak to operations leads.  ', guardrails: { defaults: { maxLength: 80 } } },
    owner
  );
  const withNotes = (await sql`SELECT data FROM handoff_pattern WHERE id='tpl_1'`)[0].data;
  check('instructions land where the guest editor reads them', withNotes?.brief?.instructions === 'Keep it short. Speak to operations leads.', withNotes?.brief);
  check('limits land where the submit gate reads them', withNotes?.guardrails?.defaults?.maxLength === 80, withNotes?.guardrails);

  // Clearing must clear, not leave an empty string that still renders as a block.
  await setTemplateBuilderNotes('tpl_1', { instructions: '   ' }, owner);
  const cleared = (await sql`SELECT data FROM handoff_pattern WHERE id='tpl_1'`)[0].data;
  check('an emptied instruction is removed, not blanked', cleared?.brief?.instructions === undefined, cleared?.brief);
  check('clearing instructions leaves the limits alone', cleared?.guardrails?.defaults?.maxLength === 80, cleared?.guardrails);

  // A plain page is not a back door into an arbitrary row's `data`.
  await sql`
    INSERT INTO handoff_pattern (id, title, components, source, kind, user_id, visibility, status)
    VALUES ('page_plain', 'Just a page', '[]'::jsonb, 'playground', 'page', 'u_owner', 'private', 'draft')
    ON CONFLICT (id) DO NOTHING`;
  let refusedNotes = '';
  try {
    await setTemplateBuilderNotes('page_plain', { instructions: 'nope' }, owner);
  } catch (e) {
    refusedNotes = (e as Error).message;
  }
  check('a plain page refuses builder notes', /only a template/i.test(refusedNotes), refusedNotes || '(nothing thrown)');

  // ── The cap ────────────────────────────────────────────────────────────────
  console.log(`\n— the page cap (${MAX_PAGES_PER_SHARE_LINK} per link)`);
  const rows = Array.from({ length: MAX_PAGES_PER_SHARE_LINK - 1 }, (_, i) => ({
    id: `filler_${i}`,
    title: 'filler',
    components: sql.json([]),
    source: 'guest',
    kind: 'page',
    template_id: 'tpl_1',
    share_link_token: 'tok_a',
    user_id: 'u_owner',
    visibility: 'private',
    status: 'draft',
  }));
  await sql`INSERT INTO handoff_pattern ${sql(rows)}`;
  const total = (await sql`SELECT count(*)::int AS n FROM handoff_pattern WHERE share_link_token='tok_a'`)[0].n;
  check(`the link is now at its limit (${total})`, total === MAX_PAGES_PER_SHARE_LINK, total);

  let refused = '';
  try {
    await createGuestSubmission({ id: 'page_over', templateId: 'tpl_1', title: 'One too many' }, guest, 'u_owner');
  } catch (e) {
    refused = (e as Error).message;
  }
  check('the next page is refused', /limit of pages/i.test(refused), refused || '(nothing thrown)');
  const exists = (await sql`SELECT count(*)::int AS n FROM handoff_pattern WHERE id='page_over'`)[0].n;
  check('and nothing was written', exists === 0, exists);

  // A different link is unaffected — the cap is per link, not per template.
  await sql`
    INSERT INTO handoff_share_link (token, resource_type, resource_id, created_by_user_id, capabilities)
    VALUES ('tok_b', 'pattern', 'tpl_1', 'u_owner',
            ${sql.json(['create_from_template', 'submit_for_review', 'edit_own_submission'])}::jsonb)
    ON CONFLICT (token) DO NOTHING`;
  await createGuestSubmission(
    { id: 'page_b', templateId: 'tpl_1', title: 'Second link' },
    { ...guest, shareLinkId: 'tok_b' } as typeof guest,
    'u_owner'
  );
  const second = (await sql`SELECT count(*)::int AS n FROM handoff_pattern WHERE id='page_b'`)[0].n;
  check('a second link starts from zero', second === 1, second);

  console.log(failures ? `\n${failures} FAILED` : '\nall checks passed');
  await sql.end();
  process.exit(failures ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
