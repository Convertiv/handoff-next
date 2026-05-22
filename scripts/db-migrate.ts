/**
 * Apply Drizzle SQL migrations using drizzle-orm (Neon pooler-safe; preferred over drizzle-kit migrate).
 *
 * Usage: npm run db:migrate  (reads DATABASE_URL from .env or the environment)
 */
import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
config({ path: path.join(repoRoot, '.env') });

const migrationsFolder = path.join(repoRoot, 'src/app/lib/db/migrations');

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('DATABASE_URL is required (e.g. postgresql://user:pass@localhost:5432/handoff)');
  process.exit(1);
}

/** Neon / Supabase poolers need prepared statements disabled. */
const usePooler = /-pooler\.|pooler\.|neon\.tech/i.test(url);

const client = postgres(url, {
  max: 1,
  connect_timeout: 15,
  idle_timeout: 5,
  prepare: !usePooler,
  onnotice: () => {
    /* drizzle-kit-style NOTICE spam is noisy and looks like a hang */
  },
});

let exitCode = 0;

try {
  console.log(`Connecting (${usePooler ? 'pooler' : 'direct'})…`);
  await client`SELECT 1`;

  await client`SET lock_timeout = '30s'`;
  await client`SET statement_timeout = '300s'`;

  const db = drizzle(client);
  console.log(`Applying migrations from ${migrationsFolder}`);
  await migrate(db, { migrationsFolder });
  console.log('Migrations applied successfully.');
} catch (err) {
  console.error('Migration failed:', err);
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  if (code === '42P07') {
    console.error(`
Your database already has tables, but Drizzle has no record that earlier migrations ran.
Baseline through the last migration that matches your schema, then migrate again:

  npm run db:migrate:baseline -- 0000_init
  npm run db:migrate
`);
  }
  exitCode = 1;
} finally {
  try {
    await client.end({ timeout: 0 });
  } catch {
    /* force-close */
  }
  process.exit(exitCode);
}
