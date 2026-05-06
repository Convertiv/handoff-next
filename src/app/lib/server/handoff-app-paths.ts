import fs from 'node:fs';
import path from 'path';

const isUnset = (v: string | undefined): boolean => !v || v.startsWith('%HANDOFF_');

function docsDirHasMarkdownFiles(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.md')) return true;
      const sub = path.join(dir, name);
      try {
        if (fs.statSync(sub).isDirectory() && fs.readdirSync(sub).some((f) => f.endsWith('.md'))) return true;
      } catch {
        /* skip */
      }
    }
    return false;
  } catch {
    return false;
  }
}

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
  const mp = env.HANDOFF_MODULE_PATH?.trim();
  const moduleDocs =
    mp && !mp.startsWith('%HANDOFF_') ? path.join(path.resolve(mp), 'config', 'docs') : null;

  const materializedOk = docsDirHasMarkdownFiles(materialized);
  const moduleOk = moduleDocs ? docsDirHasMarkdownFiles(moduleDocs) : false;

  // Prefer a directory that actually contains shipped markdown so an empty
  // `config/docs` under the materialized app does not shadow `handoff-app/config/docs`.
  if (materializedOk) return materialized;
  if (moduleOk) return moduleDocs;
  if (fs.existsSync(materialized)) return materialized;
  if (moduleDocs && fs.existsSync(moduleDocs)) return moduleDocs;
  return null;
}
