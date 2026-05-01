import path from 'path';

const isUnset = (v: string | undefined): boolean => !v || v.startsWith('%HANDOFF_');

/**
 * Root of the materialized Next app (where `app/`, `next.config.mjs`, etc. live).
 * Prefer `HANDOFF_APP_ROOT` (set by `next.config.mjs`); else legacy `.handoff/app` under `HANDOFF_WORKING_PATH`.
 */
export function getMaterializedAppRoot(env: NodeJS.ProcessEnv = process.env): string {
  const appRoot = env.HANDOFF_APP_ROOT?.trim();
  if (!isUnset(appRoot)) {
    return path.resolve(appRoot!);
  }
  const w = env.HANDOFF_WORKING_PATH?.trim();
  if (!isUnset(w)) {
    return path.resolve(w!, '.handoff', 'app');
  }
  return path.resolve(process.cwd(), '.handoff', 'app');
}
