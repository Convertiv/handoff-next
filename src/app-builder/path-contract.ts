import fs from 'fs-extra';
import path from 'path';
import type { Config, MaterializationLayout, MaterializationStrategy } from '@handoff/types/config';

/** Minimal Handoff shape for path resolution (avoids circular imports with `Handoff`). */
export type HandoffPathContext = {
  workingPath: string;
  modulePath: string;
  config: Config | null;
};

export interface PathContract {
  workingRoot: string;
  moduleRoot: string;
  /** Directory where `next dev` / `next build` runs (materialized or deploy root). */
  appRoot: string;
  /** `.handoff/` under working root (SQLite, cache, sync state). */
  handoffDataRoot: string;
  layout: MaterializationLayout;
  strategy: MaterializationStrategy;
}

export const BUNDLE_VERSION_FILENAME = '.handoff-app-bundle-version.json';

export function resolveMaterializationLayout(ctx: HandoffPathContext): MaterializationLayout {
  const env = process.env.HANDOFF_APP_MATERIALIZATION_LAYOUT?.trim().toLowerCase();
  if (env === 'legacy' || env === 'runtime' || env === 'root') {
    return env;
  }
  const cfg = ctx.config?.app?.materialization_layout ?? ctx.config?.app?.materializationLayout;
  if (cfg === 'legacy' || cfg === 'runtime' || cfg === 'root') {
    return cfg;
  }
  return 'legacy';
}

export function resolveMaterializationStrategy(ctx: HandoffPathContext): MaterializationStrategy {
  const env = process.env.HANDOFF_APP_MATERIALIZATION_STRATEGY?.trim().toLowerCase();
  if (env === 'overlay') return 'overlay';
  if (env === 'full') return 'full';
  const cfg = ctx.config?.app?.materialization_strategy ?? ctx.config?.app?.materializationStrategy;
  if (cfg === 'overlay') return 'overlay';
  return 'full';
}

export function resolveAppRoot(ctx: HandoffPathContext, layout: MaterializationLayout): string {
  const workingRoot = path.resolve(ctx.workingPath);
  if (layout === 'runtime') {
    return path.resolve(workingRoot, 'handoff-runtime');
  }
  if (layout === 'root') {
    return workingRoot;
  }
  return path.resolve(workingRoot, '.handoff', 'app');
}

export function getPathContract(ctx: HandoffPathContext): PathContract {
  const layout = resolveMaterializationLayout(ctx);
  const strategy = resolveMaterializationStrategy(ctx);
  const workingRoot = path.resolve(ctx.workingPath);
  const moduleRoot = path.resolve(ctx.modulePath);
  const appRoot = resolveAppRoot(ctx, layout);
  const handoffDataRoot = path.resolve(workingRoot, '.handoff');
  return {
    workingRoot,
    moduleRoot,
    appRoot,
    handoffDataRoot,
    layout,
    strategy: layout === 'root' ? 'full' : strategy,
  };
}

export async function readHandoffPackageVersion(moduleRoot: string): Promise<string> {
  try {
    const pkg = await fs.readJson(path.join(moduleRoot, 'package.json'));
    return String(pkg.version ?? '0.0.0');
  } catch {
    return '0.0.0';
  }
}
