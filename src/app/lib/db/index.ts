import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as pgSchema from './schema-pg';

/**
 * Drizzle client for Postgres (hosted / team mode).
 * Local `handoff-app start` without DATABASE_URL uses filesystem-only data — do not call getDb().
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HandoffDb = any;

const globalForDb = globalThis as unknown as {
  handoffPostgres?: ReturnType<typeof postgres>;
  handoffDrizzle?: HandoffDb;
};

/**
 * Return a privacy-safe descriptor of an env var value: presence, raw length,
 * trimmed length, protocol prefix, and a sentinel pattern showing first/last 3
 * chars with middle redacted. Reveals issues like:
 *   - leading/trailing whitespace      (raw !== trimmed length)
 *   - missing/wrong protocol prefix    ("postgresql://" vs "postgres://" vs other)
 *   - empty or unsubstituted templates ("${VAR}", "[REDACTED]", empty string)
 * without leaking the actual connection string.
 */
function describeUrl(raw: string | undefined): string {
  if (raw === undefined) return 'undefined';
  if (raw === '') return 'empty-string';
  const trimmed = raw.trim();
  const proto = trimmed.split('://')[0] ?? '(no-protocol)';
  const protoStr = trimmed.includes('://') ? `${proto}://` : '(no-protocol)';
  const shape = trimmed.length <= 8
    ? `<${trimmed.length} chars>`
    : `${trimmed.slice(0, 3)}…${trimmed.slice(-3)}`;
  const ws = raw.length !== trimmed.length ? ` whitespace=yes(raw=${raw.length},trimmed=${trimmed.length})` : '';
  return `proto=${protoStr} shape="${shape}" len=${trimmed.length}${ws}`;
}

/**
 * TLS on by default; off only when the URL explicitly says so.
 *
 * ⚠️ This was a hardcoded `ssl: 'require'`, which meant **no local Postgres could ever be reached** — a
 * container on localhost speaks no TLS, so every connection died with `ECONNRESET` before the first query.
 * Hosted deployments are unaffected: they carry no `sslmode=disable`, so they still get `'require'`. The
 * choice stays explicit and opt-out rather than sniffing for `localhost`, because "it looked like a dev
 * machine" is not a good enough reason to drop transport security.
 */
export function sslOptionFor(url: string): 'require' | false {
  return /[?&]sslmode=disable(&|$)/i.test(url) ? false : 'require';
}

export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      'DATABASE_URL is required for this operation. Use filesystem-only local mode for docs, or set HANDOFF_CLOUD_URL for remote APIs.'
    );
  }
  return url;
}

export function getDb(): HandoffDb {
  if (!globalForDb.handoffDrizzle) {
    const url = requireDatabaseUrl();
    try {
      // Match the pooler-aware config the migration client uses (auto-migrate.ts).
      // Neon's `-pooler` endpoint is PgBouncer in transaction mode, which cannot
      // use prepared statements — `prepare: true` there causes "prepared statement
      // already exists" errors under concurrency. Timeouts fail fast instead of
      // silently consuming the lambda budget; a modest idle_timeout releases
      // connections so many warm isolates don't pin the small-Neon connection cap.
      const isPooler = /-pooler\.|pooler\.|neon\.tech/i.test(url);
      const client = postgres(url, {
        max: 10,
        idle_timeout: 20,
        connect_timeout: 15,
        prepare: !isPooler,
        ssl: sslOptionFor(url),
      });
      globalForDb.handoffPostgres = client;
      globalForDb.handoffDrizzle = drizzlePg(client, { schema: pgSchema });
    } catch (err) {
      // Augment the error with a privacy-safe description of what postgres-js rejected.
      const detail = describeUrl(process.env.DATABASE_URL);
      const msg = err instanceof Error ? err.message : String(err);
      const augmented = new Error(`postgres() failed to initialize from DATABASE_URL — ${msg}. URL diagnostic: ${detail}`);
      (augmented as Error & { cause?: unknown }).cause = err;
      throw augmented;
    }
  }
  return globalForDb.handoffDrizzle!;
}
