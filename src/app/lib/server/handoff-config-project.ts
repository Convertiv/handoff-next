import fs from 'fs-extra';
import path from 'path';
import { createRequire } from 'module';
import type { Config } from '@handoff/types/config';

const CONFIG_NAMES = ['handoff.config.ts', 'handoff.config.js', 'handoff.config.cjs', 'handoff.config.json'] as const;

/**
 * `package.json` path used as `createRequire` entrypoint when loading handoff.config from disk.
 * Avoids walking `process.cwd()` (breaks Turbopack NFT tracing when used from App Routes).
 */
function packageJsonForRequire(projectRoot: string): string {
  const root = path.resolve(projectRoot);
  const rootPkg = path.join(root, 'package.json');
  if (fs.existsSync(rootPkg)) return rootPkg;
  const mp = process.env.HANDOFF_MODULE_PATH?.trim();
  if (mp) {
    const modPkg = path.join(path.resolve(mp), 'package.json');
    if (fs.existsSync(modPkg)) return modPkg;
  }
  return rootPkg;
}

/** Turbopack NFT: scope filesystem reads to a single known file under `root`. */
function configFileExists(root: string, name: string): boolean {
  const full = path.join(root, name);
  return fs.existsSync(full);
}

/** Project root used for component export / entry-dir resolution (linked client or handoff-app). */
export function getComponentExportProjectRoot(): string {
  const w = process.env.HANDOFF_WORKING_PATH?.trim();
  if (w) return path.resolve(w);
  const mp = process.env.HANDOFF_MODULE_PATH?.trim();
  if (mp) return path.resolve(mp);
  // Materialized Handoff apps always set the env vars above; cwd fallback is dev-only.
  return path.resolve(/* turbopackIgnore: true */ process.cwd());
}

/**
 * Load `handoff.config.*` from a specific project directory (e.g. client root
 * from `HANDOFF_WORKING_PATH`), not the handoff-app repo root.
 */
export function loadHandoffConfigFromDir(projectRoot: string): { config: Config; configPath: string } | null {
  const root = path.resolve(projectRoot);
  const requireFrom = packageJsonForRequire(root);

  for (const name of CONFIG_NAMES) {
    if (!configFileExists(root, name)) continue;
    const full = path.join(root, name);
    try {
      if (full.endsWith('.json')) {
        const config = JSON.parse(fs.readFileSync(full, 'utf8')) as Config;
        return { config, configPath: full };
      }
      const req = createRequire(requireFrom);
      const resolved = req.resolve(full);
      delete req.cache[resolved];
      const mod = req(full) as { default?: Config } | Config;
      const config = (mod as { default?: Config }).default ?? (mod as Config);
      return { config, configPath: full };
    } catch {
      return null;
    }
  }
  return null;
}

/** Resolve `entries.components` paths against an arbitrary project root (e.g. `HANDOFF_WORKING_PATH`). */
export function resolveComponentEntryDirsAt(config: Config | null, projectRoot: string): string[] {
  const roots = config?.entries?.components ?? [];
  const base = path.resolve(projectRoot);
  return roots.map((p) => path.resolve(base, p));
}
