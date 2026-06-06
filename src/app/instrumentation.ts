/**
 * Next.js instrumentation hook — runs once at Node.js process startup before
 * the first request. Used to apply pending database migrations automatically
 * so new Vercel deployments and fresh Docker setups work without manual CLI steps.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run in the Node.js runtime (not Edge) and only when a DB is configured
  if (process.env.NEXT_RUNTIME === 'edge') return;
  if (!process.env.DATABASE_URL?.trim()) return;

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
