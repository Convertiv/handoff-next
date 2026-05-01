import fs from 'fs';
import Database from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import path from 'path';
import * as pgSchema from './schema-pg';
import * as sqliteSchema from './schema-sqlite';
import { ensureHandoffDirForSqlite, resolveLocalSqlitePath, usePostgres } from './dialect';
import { runSqliteBootstrap } from './sqlite-bootstrap';

/** Resolve bundled SQLite migrations (works from repo root or copied `.handoff/.../app`). */
function resolveSqliteMigrationsFolder(): string | undefined {
  const candidates = [
    path.join(process.cwd(), 'src/app/lib/db/migrations-sqlite'),
    path.join(process.cwd(), 'lib/db/migrations-sqlite'),
  ];
  for (const dir of candidates) {
    try {
      if (fs.existsSync(path.join(dir, 'meta', '_journal.json'))) return dir;
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Drizzle client for the active dialect (Postgres or embedded SQLite).
 * Not a union of Postgres + SQLite Drizzle clients: that breaks TS overload resolution on `.select()/.insert()` etc.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HandoffDb = any;

const globalForDb = globalThis as unknown as {
  handoffPostgres?: ReturnType<typeof postgres>;
  handoffSqliteRaw?: Database.Database;
  handoffDrizzle?: HandoffDb;
  handoffDialect?: 'pg' | 'sqlite';
};

function resetDbIfDialectChanged(): void {
  const want: 'pg' | 'sqlite' = usePostgres() ? 'pg' : 'sqlite';
  if (globalForDb.handoffDialect && globalForDb.handoffDialect !== want) {
    try {
      void globalForDb.handoffPostgres?.end({ timeout: 2 });
    } catch {
      /* ignore */
    }
    try {
      globalForDb.handoffSqliteRaw?.close();
    } catch {
      /* ignore */
    }
    globalForDb.handoffPostgres = undefined;
    globalForDb.handoffSqliteRaw = undefined;
    globalForDb.handoffDrizzle = undefined;
    globalForDb.handoffDialect = undefined;
  }
}

/**
 * Returns a Drizzle client. Postgres when `DATABASE_URL` is set; otherwise embedded SQLite at `.handoff/local.db`.
 */
export function getDb(): HandoffDb {
  resetDbIfDialectChanged();
  const want: 'pg' | 'sqlite' = usePostgres() ? 'pg' : 'sqlite';

  if (!globalForDb.handoffDrizzle) {
    if (want === 'pg') {
      const url = process.env.DATABASE_URL?.trim();
      if (!url) {
        throw new Error('DATABASE_URL is missing while Postgres mode was selected.');
      }
      const client = postgres(url, { max: 10 });
      globalForDb.handoffPostgres = client;
      globalForDb.handoffDrizzle = drizzlePg(client, { schema: pgSchema });
    } else {
      const dbPath = resolveLocalSqlitePath();
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const raw = new Database(dbPath);
      raw.pragma('journal_mode = WAL');
      runSqliteBootstrap(raw);
      globalForDb.handoffSqliteRaw = raw;
      const drizzleSqliteClient = drizzleSqlite(raw, { schema: sqliteSchema });
      const migrationsFolder = resolveSqliteMigrationsFolder();
      if (migrationsFolder) {
        try {
          migrate(drizzleSqliteClient, { migrationsFolder });
        } catch (e) {
          console.warn('[handoff] SQLite migrate() failed; continuing with bootstrap DDL only:', e);
        }
      }
      globalForDb.handoffDrizzle = drizzleSqliteClient;
    }
    globalForDb.handoffDialect = want;
  }

  return globalForDb.handoffDrizzle!;
}

/** Fire-and-forget ensure dir when async context prefers it (e.g. long-running jobs). */
export async function ensureSqliteParentDir(): Promise<void> {
  await ensureHandoffDirForSqlite();
}
