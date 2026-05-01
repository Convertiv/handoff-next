import fs from 'fs-extra';
import path from 'path';

/** True when connecting to Postgres (team / cloud). False => embedded SQLite in the repo. */
export function usePostgres(): boolean {
  return Boolean(typeof process !== 'undefined' && process.env.DATABASE_URL?.trim());
}

/** True for local embedded DB (no DATABASE_URL). */
export function useSqlite(): boolean {
  return !usePostgres();
}

/**
 * Path to the local SQLite file (`.handoff/local.db` under the Handoff working directory).
 * Uses `HANDOFF_WORKING_PATH` when set (Next placeholder / CLI), else `process.cwd()`.
 */
export function resolveLocalSqlitePath(): string {
  const root = process.env.HANDOFF_WORKING_PATH?.trim() || process.cwd();
  return path.join(root, '.handoff', 'local.db');
}

export async function ensureHandoffDirForSqlite(): Promise<void> {
  const dir = path.dirname(resolveLocalSqlitePath());
  await fs.ensureDir(dir);
}
