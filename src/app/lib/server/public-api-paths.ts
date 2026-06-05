import path from 'node:path';

/**
 * Built JSON from `build:components`, mirrored into `<app-root>/public/api` during materialization.
 * Uses cwd (the Next app root) only — no HANDOFF_* env reads so App Routes do not trace next.config.mjs.
 */
export function getPublicApiDir(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), 'public', 'api');
}

/** Shared global component assets (main.css, main.js, shared.css). */
export function getPublicApiComponentDir(): string {
  return path.join(getPublicApiDir(), 'component');
}

/** Per-component build artifact directory: components/[id]/dist/ */
export function getComponentDistDir(id: string): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), 'components', id, 'dist');
}
