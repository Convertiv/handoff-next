/**
 * Mark migrations as already applied without running SQL (for DBs created before drizzle journal existed).
 *
 * Usage: npm run db:migrate:baseline -- 0000_init
 */
import { config } from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
config({ path: path.join(repoRoot, '.env') });

const migrationsFolder = path.join(repoRoot, 'src/app/lib/db/migrations');
const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');

const throughTag = process.argv[2]?.trim() || '0000_init';
const url = process.env.DATABASE_URL?.trim();
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

type Journal = { entries: { idx: number; tag: string }[] };
const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) as Journal;
const throughIdx = journal.entries.findIndex((e) => e.tag === throughTag);
if (throughIdx < 0) {
  console.error(`Unknown migration tag "${throughTag}". Known: ${journal.entries.map((e) => e.tag).join(', ')}`);
  process.exit(1);
}

const migrations = readMigrationFiles({ migrationsFolder });
const usePooler = /-pooler\.|pooler\.|neon\.tech/i.test(url);
const client = postgres(url, { max: 1, connect_timeout: 15, prepare: !usePooler });

let exitCode = 0;

try {
  await client`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await client`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `;

  const existing = await client<{ hash: string }[]>`
    SELECT hash FROM drizzle.__drizzle_migrations
  `;
  const have = new Set(existing.map((r) => r.hash));

  for (let i = 0; i <= throughIdx; i++) {
    const meta = migrations[i];
    if (!meta) {
      console.error(`Missing migration file for index ${i}`);
      exitCode = 1;
      break;
    }
    if (have.has(meta.hash)) {
      console.log(`Skip (already recorded): ${journal.entries[i].tag}`);
      continue;
    }
    await client`
      INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
      VALUES (${meta.hash}, ${meta.folderMillis})
    `;
    console.log(`Baselined: ${journal.entries[i].tag}`);
  }

  if (exitCode === 0) {
    console.log(`Done. Run npm run db:migrate to apply migrations after ${throughTag}.`);
  }
} catch (err) {
  console.error('Baseline failed:', err);
  exitCode = 1;
} finally {
  try {
    await client.end({ timeout: 0 });
  } catch {
    /* ignore */
  }
  process.exit(exitCode);
}
