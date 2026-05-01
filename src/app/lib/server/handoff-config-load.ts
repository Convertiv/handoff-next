import fs from 'fs-extra';
import path from 'path';
import { createRequire } from 'module';
import type { Config } from '@handoff/types/config';
import { resolveComponentEntryDirsAt } from './handoff-config-project';

const CONFIG_NAMES = ['handoff.config.ts', 'handoff.config.js', 'handoff.config.cjs', 'handoff.config.json'] as const;

/**
 * Resolve the handoff-app package root (contains `package.json` with name handoff-app).
 * Next dev often runs with `cwd` under `src/app`, so `process.cwd()` alone is wrong.
 */
export function resolveHandoffRepoRoot(): string {
  const env = process.env.HANDOFF_COMPONENT_BUILD_REPO_ROOT;
  if (env && env.length > 0) return path.resolve(env);

  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const j = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string };
        if (j.name === 'handoff-app') return dir;
      } catch {
        /* ignore */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** @deprecated Prefer {@link resolveHandoffRepoRoot}; kept for call sites that expect this name. */
export function getHandoffRepoRoot(): string {
  return resolveHandoffRepoRoot();
}

/**
 * Load raw `Config` from the first existing handoff.config.* at repo root.
 * Returns null if no config file exists.
 */
export function loadHandoffConfigFile(): { config: Config; configPath: string } | null {
  const root = resolveHandoffRepoRoot();
  for (const name of CONFIG_NAMES) {
    const full = path.join(root, name);
    if (fs.existsSync(full)) {
      try {
        if (full.endsWith('.json')) {
          const config = JSON.parse(fs.readFileSync(full, 'utf8')) as Config;
          return { config, configPath: full };
        }
        const req = createRequire(path.join(root, 'package.json'));
        const resolved = req.resolve(full);
        delete req.cache[resolved];
        const mod = req(full) as { default?: Config } | Config;
        const config = (mod as { default?: Config }).default ?? (mod as Config);
        return { config, configPath: full };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Component root directories from `entries.components` (absolute paths, relative to handoff-app repo root). */
export function resolveComponentEntryDirs(config: Config | null): string[] {
  return resolveComponentEntryDirsAt(config, resolveHandoffRepoRoot());
}
