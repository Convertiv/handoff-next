import 'server-only';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Run autoMigrate() at most once per process. Subsequent calls (concurrent or
 * sequential) return the same promise. Used by self-healing entry points like
 * /setup and getDataProvider() to ensure the schema exists before the first
 * real DB query, even if instrumentation.ts didn't fire at cold start.
 */
let cachedMigrationPromise: Promise<void> | null = null;
export function ensureMigrationsApplied(): Promise<void> {
  if (!cachedMigrationPromise) {
    cachedMigrationPromise = autoMigrate().catch((err) => {
      // Reset on failure so a subsequent call can retry (e.g. transient connect issue)
      cachedMigrationPromise = null;
      throw err;
    });
  }
  return cachedMigrationPromise;
}

/**
 * Automatically apply any pending Drizzle migrations at server startup.
 *
 * Called from instrumentation.ts so it runs once when the Node.js process boots
 * (before the first request).
 *
 * ⚠️ Drizzle's migrator does NOT take any lock — this comment used to claim it did, and that
 * wrong belief is why nothing guarded the race. `pg-core/dialect.js` migrate() creates the
 * `drizzle.__drizzle_migrations` bookkeeping table, reads the last applied row, then runs every
 * pending migration in ONE transaction. Nothing serializes two runners. On a fresh registry that
 * bites hard: every cold-starting lambda migrates the same empty database at once, migration 0000
 * is drizzle-generated so its `CREATE TABLE "account"` has no IF NOT EXISTS, the losers roll back
 * their whole transaction, and nothing ever commits. Observed on outsystems-handoff (2026-08-19):
 * 8 failed runs, all on `CREATE TABLE "account"`, schema still empty.
 *
 * So we take the lock ourselves — see MIGRATION_LOCK_KEY below. Safe to call concurrently now.
 *
 * Migrations folder resolution tries multiple candidate paths because we run
 * in several environments with different filesystem layouts:
 *   1. Vercel deployed (cwd=src/app, migrations bundled via outputFileTracingIncludes)
 *   2. Local `next dev` (cwd=src/app, migrations live at lib/db/migrations)
 *   3. Materialized .handoff/runtime/ (cwd=runtime root, same relative path)
 *   4. Resolved via import.meta.url (compiled file location)
 *   5. From repo root via src/app/lib/db/migrations (npm scripts run from root)
 *
 * All candidate paths are logged on resolution failure so Vercel function logs
 * tell us exactly where we looked.
 */
export async function autoMigrate(): Promise<void> {
  const pooledUrl = process.env.DATABASE_URL?.trim();
  /**
   * Migrations go over the DIRECT endpoint, never the pooler.
   *
   * Neon's pooled host is PgBouncer in transaction mode. It cannot hold the session-level
   * `SET lock_timeout` / `SET statement_timeout` below, and it is the wrong place to push a
   * long DDL transaction — Neon's own guidance is to migrate over the unpooled endpoint.
   * Observed on outsystems-handoff's first boot (2026-08-19): connect, auth and the two SETs
   * all succeeded against `…-pooler…`, then `migrate()` died with `write CONNECT_TIMEOUT` —
   * postgres-js cancels its connect timer at the first ReadyForQuery, so that error means the
   * session was gone and a REPLACEMENT connection never came up inside connect_timeout. Every
   * table was still missing afterwards (42P01 on `user`, `handoff_component`, …).
   *
   * The Neon/Vercel integration provisions both names, so this is normally just present.
   */
  const directUrl = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.POSTGRES_URL_NON_POOLING?.trim();
  const url = directUrl || pooledUrl;
  if (!url) {
    console.log('[handoff] auto-migrate: DATABASE_URL not set — skipping (workspace mode).');
    return;
  }

  const { existsSync } = await import('fs');
  const cwd = process.cwd();

  const candidates: string[] = [
    // (1)(2)(3) cwd-relative — covers Vercel deployment, local next dev, materialized runtime
    path.join(cwd, 'lib', 'db', 'migrations'),
  ];

  // (4) Relative to this compiled module's location. On Vercel this resolves
  // inside the lambda's traced file tree, regardless of cwd weirdness.
  try {
    const thisDir = path.dirname(fileURLToPath(import.meta.url));
    // After compilation, auto-migrate.js typically lives at .../lib/db/auto-migrate.js
    // — sibling to migrations/. Walk up looking for migrations dirs.
    for (let i = 0; i < 5; i++) {
      const ascendDir = path.resolve(thisDir, ...new Array(i).fill('..'));
      candidates.push(path.join(ascendDir, 'lib', 'db', 'migrations'));
      candidates.push(path.join(ascendDir, 'migrations'));
    }
  } catch {
    // fileURLToPath not available — skip this resolver
  }

  // (5) Repo root fallbacks (when npm scripts run from package root)
  candidates.push(path.join(cwd, 'src', 'app', 'lib', 'db', 'migrations'));

  // Dedupe and find first existing
  const uniqueCandidates = Array.from(new Set(candidates));
  const migrationsFolder = uniqueCandidates.find((c) => existsSync(c));

  console.log(`[handoff] auto-migrate: cwd=${cwd}`);
  console.log(`[handoff] auto-migrate: searched ${uniqueCandidates.length} candidate paths for migrations folder`);
  if (!migrationsFolder) {
    console.error('[handoff] auto-migrate: NO migrations folder found. Searched:');
    for (const c of uniqueCandidates) console.error(`  - ${c}`);
    console.error('[handoff] To fix: ensure lib/db/migrations is included in next.config outputFileTracingIncludes.');
    return;
  }
  console.log(`[handoff] auto-migrate: using ${migrationsFolder}`);

  // Dynamically import Drizzle migrator so this module tree-shakes cleanly
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const postgres = (await import('postgres')).default;
  const { sslOptionFor } = await import('./index');

  // Vercel Postgres / Neon / Supabase poolers all require SSL, so TLS is the default; `sslmode=disable` in the
  // URL is the one way out, which is what makes a local container reachable. See `sslOptionFor`.
  const isPooler = /-pooler\.|pooler\.|neon\.tech/i.test(url);
  console.log(
    `[handoff] auto-migrate: connecting (endpoint=${directUrl ? 'direct' : 'pooled'}, prepared-statements=${!isPooler})…` +
      (directUrl ? '' : ' ⚠ no unpooled URL in env — migrating over the pooler, which can drop the session mid-DDL')
  );

  const client = postgres(url, {
    max: 1,
    // 15s was not enough headroom for a cold / just-provisioned Neon compute to hand back a
    // replacement connection. This runs once per cold start on the miss path only.
    connect_timeout: 30,
    idle_timeout: 5,
    prepare: !isPooler, // Neon pooler can't use prepared statements
    ssl: sslOptionFor(url),
    onnotice: () => {},
  });

  try {
    // Set timeouts on this session so a stuck lock or hung query fails fast
    // instead of silently consuming the lambda's execution budget.
    await client`SET lock_timeout = '30s'`;
    await client`SET statement_timeout = '120s'`;
    console.log('[handoff] auto-migrate: session timeouts set, taking migration lock…');

    /**
     * Serialize migration runners across every instance of every registry process.
     *
     * Session-scoped, so it releases on `client.end()` below AND on an abrupt death — which
     * matters on Vercel, where an instance can be frozen mid-migration once its request has
     * been answered. A holder that never comes back drops the lock when its connection dies,
     * and the next cold start retries. `max: 1` above is what makes this correct: the lock and
     * the migration transaction ride the same session.
     *
     * The wait is bounded by the `lock_timeout` set above — a loser waits for the winner to
     * finish (the common case, a few seconds) and then runs migrate() itself, which finds
     * nothing pending and commits an empty transaction. If it waits past lock_timeout we treat
     * that as "someone else is on it" and return without error rather than piling up.
     */
    const MIGRATION_LOCK_KEY = 4242042001; // arbitrary but STABLE — every instance must agree
    try {
      await client.unsafe(`SELECT pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
    } catch (lockErr) {
      const msg = lockErr instanceof Error ? lockErr.message : String(lockErr);
      console.log(`[handoff] auto-migrate: another instance holds the migration lock (${msg}) — skipping this run.`);
      return;
    }
    console.log('[handoff] auto-migrate: migration lock held, starting migrate()…');

    const db = drizzle(client);

    // Hard wrap the migrate() call with a timeout. Vercel lambda timeouts
    // (10s Hobby / 60s Pro default) can kill us mid-migration; better to fail
    // explicitly with a clear log than silently disappear.
    const MIGRATE_TIMEOUT_MS = 90_000;
    await Promise.race([
      migrate(db, { migrationsFolder }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`migrate() exceeded ${MIGRATE_TIMEOUT_MS}ms timeout`)), MIGRATE_TIMEOUT_MS)
      ),
    ]);

    console.log('[handoff] auto-migrate: database schema is up to date.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('no migrations')) {
      console.error('[handoff] auto-migrate: migration failed:', msg);
      if (err instanceof Error && err.stack) {
        console.error('[handoff] auto-migrate: stack:', err.stack);
      }
      // Re-throw so the memoized ensureMigrationsApplied() promise rejects and
      // can be retried by a subsequent call. The /setup action will surface
      // this to the user.
      throw err;
    }
  } finally {
    // Ending the session drops the advisory lock on its own; unlocking first keeps the lock from
    // lingering for the tail of a slow client.end() when another instance is already waiting.
    await client.unsafe('SELECT pg_advisory_unlock_all()').catch(() => {});
    await client.end({ timeout: 5 }).catch((e) => {
      console.warn('[handoff] auto-migrate: client.end() failed:', e instanceof Error ? e.message : String(e));
    });
  }
}
