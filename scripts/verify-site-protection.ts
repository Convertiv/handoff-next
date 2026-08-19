/**
 * Run `0033_site_protection` against a real Postgres and check what the SQL enforces.
 *
 * Usage — a **throwaway** database only:
 *
 *   docker run -d --name handoff-sp-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=handoff_test \
 *     -p 55435:5432 postgres:16-alpine
 *   SCRATCH_DATABASE_URL=postgres://postgres:test@localhost:55435/handoff_test \
 *     npx tsx scripts/verify-site-protection.ts
 */

import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const url = process.env.SCRATCH_DATABASE_URL;
if (!url) {
  console.error('SCRATCH_DATABASE_URL is required. Point it at a throwaway database — this script drops tables.');
  process.exit(1);
}
if (/neon\.tech|supabase|amazonaws|render\.com|prod/i.test(url)) {
  console.error('Refusing to run: SCRATCH_DATABASE_URL looks like a hosted database.');
  process.exit(1);
}

const MIGRATION = path.join(process.cwd(), 'src/app/lib/db/migrations/0033_site_protection.sql');
const sql = postgres(url, { max: 1, onnotice: () => {} });

let failures = 0;
function check(name: string, pass: boolean, detail?: unknown) {
  console.log(`${pass ? '✓' : '✗'} ${name}${!pass && detail !== undefined ? `  ← ${JSON.stringify(detail)}` : ''}`);
  if (!pass) failures += 1;
}

async function main() {
  await sql`DROP TABLE IF EXISTS handoff_site_protection CASCADE`;
  await sql`DROP TABLE IF EXISTS "user" CASCADE`;
  await sql`CREATE TABLE "user" (id text PRIMARY KEY)`;
  await sql`INSERT INTO "user" (id) VALUES ('admin-1')`;

  const migration = fs.readFileSync(MIGRATION, 'utf8');
  await sql.unsafe(migration);
  check('migration applies', true);

  const [seeded] = await sql`SELECT * FROM handoff_site_protection WHERE id = 'default'`;
  check('seeds a singleton row', Boolean(seeded), seeded);
  check('...off by default — installing this must not lock anyone out', seeded?.enabled === false, seeded?.enabled);
  check('...with no password set', seeded?.password_hash === null);
  check('...at epoch 1', seeded?.epoch === 1, seeded?.epoch);

  // Re-runnable, and the replay must not wipe a configured password.
  await sql`
    UPDATE handoff_site_protection
       SET enabled = true, password_hash = 'bcrypt-hash', epoch = 7, updated_by = 'admin-1'
     WHERE id = 'default'
  `;
  await sql.unsafe(migration);
  const [afterReplay] = await sql`SELECT * FROM handoff_site_protection WHERE id = 'default'`;
  check('migration is idempotent', true);
  check(
    '...and re-running it does not reset a configured password',
    afterReplay?.password_hash === 'bcrypt-hash' && afterReplay?.enabled === true && afterReplay?.epoch === 7,
    afterReplay
  );

  // Singleton: a second row must be impossible.
  let refused = false;
  try {
    await sql`INSERT INTO handoff_site_protection (id) VALUES ('default')`;
  } catch {
    refused = true;
  }
  check('a second row with the same id is refused', refused);

  // Deleting the admin who set it must not delete the protection.
  await sql`DELETE FROM "user" WHERE id = 'admin-1'`;
  const [survived] = await sql`SELECT * FROM handoff_site_protection WHERE id = 'default'`;
  check('deleting the configuring admin leaves protection in place', survived?.enabled === true, survived);
  check('...with updated_by nulled', survived?.updated_by === null, survived?.updated_by);

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  await sql.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
