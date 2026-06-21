import { existsSync } from 'node:fs';
import path from 'node:path';

// In workspace mode the Next.js app runs from .handoff/app (process.cwd()), but the workspace
// keeps its built artifacts one level up under HANDOFF_WORKING_PATH. These helpers check the
// primary (cwd-based) path first and fall back to the workspace dir when it's missing.
// HANDOFF_WORKING_PATH is set in next.config.mjs env — it is NOT read at build time here.

function withWorkspaceFallback(primary: string, ...fallbackSegments: string[]): string {
  if (existsSync(primary)) return primary;
  const workingPath = process.env.HANDOFF_WORKING_PATH;
  if (workingPath) {
    const fallback = path.join(workingPath, ...fallbackSegments);
    if (existsSync(fallback)) return fallback;
  }
  return primary;
}

/** Built JSON from `build:components`. Falls back to HANDOFF_WORKING_PATH/public/api when not present under cwd. */
export function getPublicApiDir(): string {
  const primary = path.join(/* turbopackIgnore: true */ process.cwd(), 'public', 'api');
  return withWorkspaceFallback(primary, 'public', 'api');
}

/** Shared global component assets (main.css, main.js, shared.css). */
export function getPublicApiComponentDir(): string {
  return path.join(getPublicApiDir(), 'component');
}

/** Per-component build artifact directory: components/[id]/dist/ */
export function getComponentDistDir(id: string): string {
  const primary = path.join(/* turbopackIgnore: true */ process.cwd(), 'components', id, 'dist');
  return withWorkspaceFallback(primary, 'components', id, 'dist');
}
