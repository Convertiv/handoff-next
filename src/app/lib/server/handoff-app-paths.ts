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

  // In the Vercel Lambda runtime with standalone output, HANDOFF_APP_ROOT and
  // HANDOFF_MODULE_PATH are baked in as absolute build-machine paths that no longer
  // exist. The standalone bundle places config/docs/ relative to its tracing root,
  // which becomes process.cwd() at runtime. Check direct and one sub-level paths.
  const cwdDocs = path.join(process.cwd(), 'config', 'docs');
  // Direct registry deploy: outputFileTracingRoot is the repo root, app is at src/app/.
  // config/docs/ at repo root lands at process.cwd()/config/docs (fixed by the
  // ../../config/docs/**/* include in next.config.mjs), but also check src/app/ sub-path
  // as a safety net in case the tracing root changes.
  const cwdSrcAppDocs = path.join(process.cwd(), 'src', 'app', 'config', 'docs');

  if (fs.existsSync(materialized)) return materialized;
  if (moduleDocs && fs.existsSync(moduleDocs)) return moduleDocs;
  if (fs.existsSync(cwdDocs)) return cwdDocs;
  if (fs.existsSync(cwdSrcAppDocs)) return cwdSrcAppDocs;
  return null;
}
