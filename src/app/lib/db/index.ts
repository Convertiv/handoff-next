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
      const client = postgres(url, { max: 10 });
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
