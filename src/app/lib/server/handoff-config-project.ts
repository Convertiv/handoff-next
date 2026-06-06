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
  const root = path.resolve(/* turbopackIgnore: true */ projectRoot);
  const rootPkg = path.join(root, 'package.json');
  if (fs.existsSync(rootPkg)) return rootPkg;
  const mp = process.env.HANDOFF_MODULE_PATH?.trim();
  if (mp) {
    const modPkg = path.join(path.resolve(/* turbopackIgnore: true */ mp), 'package.json');
    if (fs.existsSync(modPkg)) return modPkg;
  }
  return rootPkg;
}

/** Turbopack NFT: scope filesystem reads to a single known file under `root`. */
function configFileExists(root: string, name: string): boolean {
  const full = path.join(/* turbopackIgnore: true */ root, name);
  return fs.existsSync(/* turbopackIgnore: true */ full);
}

/** Project root used for component export / entry-dir resolution (linked client or handoff-app). */
export function getComponentExportProjectRoot(): string {
  const w = process.env.HANDOFF_WORKING_PATH?.trim();
  if (w) return path.resolve(/* turbopackIgnore: true */ w);
  const mp = process.env.HANDOFF_MODULE_PATH?.trim();
  if (mp) return path.resolve(/* turbopackIgnore: true */ mp);
  // Materialized Handoff apps always set the env vars above; cwd fallback is dev-only.
  return path.resolve(/* turbopackIgnore: true */ process.cwd());
}

/**
 * Load `handoff.config.*` from a specific project directory (e.g. client root
 * from `HANDOFF_WORKING_PATH`), not the handoff-app repo root.
 */
export function loadHandoffConfigFromDir(projectRoot: string): { config: Config; configPath: string } | null {
  const root = path.resolve(/* turbopackIgnore: true */ projectRoot);
  const requireFrom = packageJsonForRequire(root);

  for (const name of CONFIG_NAMES) {
    if (!configFileExists(root, name)) continue;
    const full = path.join(/* turbopackIgnore: true */ root, name);
    try {
      if (full.endsWith('.json')) {
        const config = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ full, 'utf8')) as Config;
        return { config, configPath: full };
      }
      // turbopackIgnore: createRequire + dynamic req(full) trace as "very dynamic
      // require" which causes NFT to include the whole project — and once the
      // symlinked node_modules gets into the trace, Vercel rejects the deploy
      // with "framework produced an invalid deployment package... files in
      // symlinked directories". This dynamic load only runs in workspace mode
      // anyway (CLI start), so excluding it from NFT is safe.
      const req = createRequire(/* turbopackIgnore: true */ requireFrom);
      const resolved = req.resolve(/* turbopackIgnore: true */ full);
      delete req.cache[resolved];
      const mod = req(/* turbopackIgnore: true */ full) as { default?: Config } | Config;
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
  const base = path.resolve(/* turbopackIgnore: true */ projectRoot);
  return roots.map((p) => path.resolve(base, p));
}
