import fs from 'node:fs';
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

/**
 * Default shipped markdown (`system`, `foundations`, `design`, …) used for nav + catch-all routes.
 * Prefer the copy under the materialized app (present on Vercel / serverless); else `handoff-app` package.
 */
export function getDefaultDocsDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const materialized = path.join(getMaterializedAppRoot(env), 'config', 'docs');
  if (fs.existsSync(materialized)) {
    return materialized;
  }
  const mp = env.HANDOFF_MODULE_PATH?.trim();
  if (mp && !mp.startsWith('%HANDOFF_')) {
    const mod = path.join(path.resolve(mp), 'config', 'docs');
    if (fs.existsSync(mod)) {
      return mod;
    }
  }
  return null;
}
