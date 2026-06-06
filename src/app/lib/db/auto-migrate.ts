import 'server-only';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Automatically apply any pending Drizzle migrations at server startup.
 *
 * Called from instrumentation.ts so it runs once when the Node.js process boots
 * (before the first request). Safe to call multiple times — Drizzle's migrator
 * is idempotent and uses advisory locks so concurrent startup races are handled.
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
  const url = process.env.DATABASE_URL?.trim();
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

  const client = postgres(url, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => {},
  });

  try {
    const db = drizzle(client);
    await migrate(db, { migrationsFolder });
    console.log('[handoff] auto-migrate: database schema is up to date.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('no migrations')) {
      console.error('[handoff] auto-migrate: migration failed:', msg);
      // Do NOT re-throw — failing the entire process makes Vercel cold starts
      // permanently fail. Surface the error in logs instead; routes will 500
      // with clearer errors when they try to query missing tables.
    }
  } finally {
    await client.end({ timeout: 0 }).catch(() => {});
  }
}
