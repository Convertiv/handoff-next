/*
 * These are plain predicates, not React hooks. Keep the `is` prefix: a `use` prefix makes
 * `react-hooks/rules-of-hooks` treat every server-side call site as a hook call, which is
 * what forced the rule to a warning before these were renamed from `usePostgres`/`useSqlite`.
 */

/** True when this process uses Postgres (hosted deployment or local with DATABASE_URL). */
export function isPostgres(): boolean {
  return Boolean(typeof process !== 'undefined' && process.env.DATABASE_URL?.trim());
}

/** @deprecated SQLite removed — always false. */
export function isSqlite(): boolean {
  return false;
}
