import type { Config } from '@handoff/types/config';
import { getComponentExportProjectRoot, loadHandoffConfigFromDir, resolveComponentEntryDirsAt } from './handoff-config-project';

/**
 * Resolve the project root for runtime config loading.
 * Prefers `HANDOFF_WORKING_PATH` / `HANDOFF_MODULE_PATH` from generated next.config;
 * falls back to cwd only in dev via `getComponentExportProjectRoot()`.
 */
export function resolveHandoffRepoRoot(): string {
  return getComponentExportProjectRoot();
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
  return loadHandoffConfigFromDir(resolveHandoffRepoRoot());
}

/** Component root directories from `entries.components` (absolute paths, relative to handoff-app repo root). */
export function resolveComponentEntryDirs(config: Config | null): string[] {
  return resolveComponentEntryDirsAt(config, resolveHandoffRepoRoot());
}
