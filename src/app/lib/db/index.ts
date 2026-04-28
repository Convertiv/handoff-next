import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getMode } from '../mode';
import * as schema from './schema';

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;
type PostgresClient = ReturnType<typeof postgres>;

const globalForDb = globalThis as unknown as {
  handoffPostgres?: PostgresClient;
  handoffDrizzle?: DrizzleClient;
};

/**
 * Returns a Drizzle client when `HANDOFF_MODE=dynamic` and `DATABASE_URL` is set.
 * Otherwise returns `null` (static export / no DB).
 */
export function getDb(): DrizzleClient | null {
  if (getMode() !== 'dynamic') {
    return null;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    return null;
  }
  if (!globalForDb.handoffDrizzle) {
    const client = postgres(url, { max: 10 });
    globalForDb.handoffPostgres = client;
    globalForDb.handoffDrizzle = drizzle(client, { schema });
  }
  return globalForDb.handoffDrizzle ?? null;
}
