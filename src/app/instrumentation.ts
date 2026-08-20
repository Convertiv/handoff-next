/**
 * Next.js instrumentation hook — runs once at Node.js process startup before
 * the first request. Used to apply pending database migrations automatically
 * so new Vercel deployments and fresh Docker setups work without manual CLI steps.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  console.log(`[handoff] instrumentation.register() — runtime=${process.env.NEXT_RUNTIME ?? 'nodejs'}, hasDB=${Boolean(process.env.DATABASE_URL?.trim())}`);

  // Only run in the Node.js runtime (not Edge) and only when a DB is configured
  if (process.env.NEXT_RUNTIME === 'edge') return;
  if (!process.env.DATABASE_URL?.trim()) return;

  /**
   * Never migrate from here on Vercel — `scripts/migrate-on-deploy.mjs` owns it at build time.
   *
   * register() is background work on a serverless instance: it races the first request and is
   * FROZEN the moment that request is answered. Measured on outsystems-handoff (2026-08-19):
   * instances logged `migration lock held, starting migrate()…` and then never logged success,
   * failure, or the 90s internal timeout — frozen instances don't run timers. The schema stayed
   * empty and each one sat on the advisory lock, which then blocked the build that was trying to
   * do the migration properly. Local and docker keep this path; there the process actually lives.
   */
  if (process.env.VERCEL) {
    console.log('[handoff] instrumentation: on Vercel — migrations run at build time, skipping runtime migrate.');
    return;
  }

  try {
    const { autoMigrate } = await import('./lib/db/auto-migrate');
    await autoMigrate();
  } catch (err) {
    // Log but do not crash the process — a broken DB should surface as request
    // errors, not a failed startup, so operators see the real error message.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[handoff] Startup migration failed — check DATABASE_URL and database connectivity:', msg);
  }
}
