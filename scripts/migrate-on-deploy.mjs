/**
 * Apply pending migrations during the BUILD, not at runtime.
 *
 * Why this exists (2026-08-19, outsystems-handoff's first boot — see DEVLOG):
 * `autoMigrate()` runs from `instrumentation.register()`, which on Vercel means it races the
 * first request and then gets FROZEN when that request is answered. Observed with the advisory
 * lock in place: two instances took the lock, logged `starting migrate()…`, and never logged
 * success, failure, or even the 90s internal timeout — a frozen instance doesn't run timers.
 * The schema stayed empty and the lock stayed held. No endpoint choice or locking fixes that;
 * background work on a serverless instance simply has no guarantee of completing.
 *
 * A build step has none of those problems: one process, awaited to completion, nothing to race.
 *
 * Two deliberate behaviours:
 *   - No DB configured → exit 0 quietly. A brand-new registry's FIRST build has no database
 *     (you cannot attach Neon to a project that has never deployed). That build must succeed;
 *     the deploy that follows the attach is the one that migrates.
 *   - DB configured but migration failed → exit 1 and fail the build. An unmigrated registry
 *     that boots looking healthy is exactly the failure mode this is here to prevent, so it is
 *     better to break loudly at deploy time than to serve 42P01s.
 *
 * The runtime `autoMigrate()` stays as the fallback for local/docker, where the process lives.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsFolder = path.join(repoRoot, 'src/app/lib/db/migrations');

/** Direct endpoint first: Neon's pooled host is PgBouncer in transaction mode and holds no session state. */
const url =
  process.env.DATABASE_URL_UNPOOLED?.trim() ||
  process.env.POSTGRES_URL_NON_POOLING?.trim() ||
  process.env.DATABASE_URL?.trim();

if (!url) {
  console.log('[handoff] migrate-on-deploy: no database configured — skipping (first deploy or workspace mode).');
  process.exit(0);
}

const isDirect = Boolean(process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.POSTGRES_URL_NON_POOLING?.trim());
const sslMode = /[?&]sslmode=disable(&|$)/i.test(url) ? false : 'require';

const client = postgres(url, {
  max: 1,
  connect_timeout: 30,
  idle_timeout: 20,
  // Prepared statements are unsupported on Neon's pooler; harmless to skip on the direct endpoint too.
  prepare: false,
  ssl: sslMode,
  onnotice: () => {},
});

let exitCode = 0;
try {
  console.log(`[handoff] migrate-on-deploy: connecting (endpoint=${isDirect ? 'direct' : 'pooled'})…`);
  await client`SET lock_timeout = '60s'`;
  await client`SET statement_timeout = '300s'`;

  // Same key as autoMigrate(), so a build and a stray runtime attempt can never interleave.
  await client`SELECT pg_advisory_lock(4242042001)`;
  console.log(`[handoff] migrate-on-deploy: lock held, applying migrations from ${migrationsFolder}`);

  await migrate(drizzle(client), { migrationsFolder });
  console.log('[handoff] migrate-on-deploy: database schema is up to date.');
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  const code = err?.cause?.code;
  console.error(`[handoff] migrate-on-deploy: FAILED${code ? ` (${code})` : ''}: ${msg}`);
  if (code === '42P07') {
    console.error(
      '[handoff] Tables exist but Drizzle has no record of them. Baseline first:\n' +
        '  npm run db:migrate:baseline -- <last-matching-tag>'
    );
  }
  console.error('[handoff] Failing the build rather than deploying a registry with no schema.');
  exitCode = 1;
} finally {
  await client`SELECT pg_advisory_unlock_all()`.catch(() => {});
  await client.end({ timeout: 5 }).catch(() => {});
  process.exit(exitCode);
}
