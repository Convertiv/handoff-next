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
    const client = postgres(url, { max: 10 });
    globalForDb.handoffPostgres = client;
    globalForDb.handoffDrizzle = drizzlePg(client, { schema: pgSchema });
  }
  return globalForDb.handoffDrizzle!;
}
