import fs from 'node:fs';
import path from 'path';

const isUnset = (v: string | undefined): boolean => !v || v.startsWith('%HANDOFF_');

/**
 * Read a Next.js env-inlined variable.
 *
 * `next.config.mjs` `env:` replaces **literal** `process.env.HANDOFF_*` at
 * compile time. Accessing the same key through a parameter alias
 * (`env.HANDOFF_APP_ROOT`) bypasses inlining, so the actual `process.env`
 * (which may not have the key) is used instead.
 *
 * This helper falls back to the inlined constants when a caller-supplied
 * `env` object does not carry the key.
 */
function readEnv(key: string, env?: NodeJS.ProcessEnv): string | undefined {
  const fromArg = env?.[key];
  if (fromArg !== undefined) return fromArg;

  /* eslint-disable @typescript-eslint/no-unnecessary-condition -- direct access ensures Next.js inlines the value */
  switch (key) {
    case 'HANDOFF_APP_ROOT':
      return process.env.HANDOFF_APP_ROOT;
    case 'HANDOFF_WORKING_PATH':
      return process.env.HANDOFF_WORKING_PATH;
    case 'HANDOFF_MODULE_PATH':
      return process.env.HANDOFF_MODULE_PATH;
    default:
      return undefined;
  }
  /* eslint-enable */
}

/**
 * Root of the materialized Next app (where `app/`, `next.config.mjs`, etc. live).
 * Prefer `HANDOFF_APP_ROOT` (set by `next.config.mjs`); else legacy `.handoff/app` under `HANDOFF_WORKING_PATH`.
 */
export function getMaterializedAppRoot(env: NodeJS.ProcessEnv = process.env): string {
  const appRoot = readEnv('HANDOFF_APP_ROOT', env)?.trim();
  if (!isUnset(appRoot)) {
    return path.resolve(/* turbopackIgnore: true */ appRoot!);
  }
  const w = readEnv('HANDOFF_WORKING_PATH', env)?.trim();
  if (!isUnset(w)) {
    return path.resolve(/* turbopackIgnore: true */ w!, '.handoff', 'app');
  }
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), '.handoff', 'app');
}

/**
 * Default shipped markdown (`system`, `foundations`, `design`, …) used for nav + catch-all routes.
 * Prefer the copy under the materialized app (present on Vercel / serverless); else `handoff-app` package.
 */
export function getDefaultDocsDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const materialized = path.join(getMaterializedAppRoot(env), 'config', 'docs');
  const mp = readEnv('HANDOFF_MODULE_PATH', env)?.trim();
  const moduleDocs =
    mp && !mp.startsWith('%HANDOFF_') ? path.join(path.resolve(mp), 'config', 'docs') : null;

  if (fs.existsSync(materialized)) return materialized;
  if (moduleDocs && fs.existsSync(moduleDocs)) return moduleDocs;
  return null;
}
