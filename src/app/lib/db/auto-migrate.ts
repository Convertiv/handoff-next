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
 * Migrations folder resolution (tried in order):
 *  1. <cwd>/lib/db/migrations        — materialized app layout (legacy / runtime)
 *  2. <package-dir>/src/app/lib/db/migrations — development (source tree)
 */
export async function autoMigrate(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return; // workspace mode — no DB, nothing to migrate

  const cwd = process.cwd();

  // Candidate paths for the migrations folder
  const candidates: string[] = [
    path.join(cwd, 'lib', 'db', 'migrations'),
  ];

  // In development / monorepo, src/app may be the cwd
  try {
    const pkgDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
    candidates.push(path.join(pkgDir, 'lib', 'db', 'migrations'));
    candidates.push(path.join(pkgDir, 'src', 'app', 'lib', 'db', 'migrations'));
  } catch {
    // fileURLToPath not available in all environments
  }

  const { existsSync } = await import('fs');
  const migrationsFolder = candidates.find((c) => existsSync(c));
  if (!migrationsFolder) {
    console.warn('[handoff] auto-migrate: could not locate migrations folder — skipping.');
    return;
  }

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
    console.log('[handoff] Database schema is up to date.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "no migrations to run" is fine — anything else is worth logging
    if (!msg.includes('no migrations')) {
      console.error('[handoff] auto-migrate error:', msg);
      throw err; // re-throw so Vercel build/startup knows the DB is broken
    }
  } finally {
    await client.end({ timeout: 0 }).catch(() => {});
  }
}
