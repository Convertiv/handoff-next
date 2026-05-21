/** True when this process uses Postgres (hosted deployment or local with DATABASE_URL). */
export function usePostgres(): boolean {
  return Boolean(typeof process !== 'undefined' && process.env.DATABASE_URL?.trim());
}

/** @deprecated SQLite removed — always false. */
export function useSqlite(): boolean {
  return false;
}
