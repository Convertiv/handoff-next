import 'server-only';
import { getClientRuntimeConfig } from '../../components/util';
import { usePostgres } from '../db/dialect';
import type { ClientConfig } from '@handoff/types/config';

/**
 * Resolve the runtime config server-side, merging the DB-pushed registry
 * config (from handoff_registry_config) into the static filesystem defaults.
 * Used by the root layout per ADR-001 §1+§3 to drive per-project branding
 * (title, client name, breakpoints, tag manager, etc.) at request time
 * without any per-project build customization.
 *
 * Workspace mode: returns static config unchanged.
 * Registry mode:  merges DB `app` block over static `app` block, DB wins.
 * If the DB query fails (table missing pre-migration, connection issue),
 * silently falls back to static — registry should never be unstyled because
 * of a config read failure.
 */
export async function getMergedRuntimeConfig(): Promise<ClientConfig> {
  const staticConfig = getClientRuntimeConfig();
  if (!usePostgres()) return staticConfig;

  try {
    const { getRegistryConfig } = await import('../db/registry-queries');
    const dbConfig = await getRegistryConfig();
    if (!dbConfig || typeof dbConfig !== 'object') return staticConfig;

    // The DB row stores Config['app'] verbatim. Merge it over the static
    // config's app block. Top-level static fields (figma_project_id, etc.)
    // are NOT overridden — those belong to the registry's own deployment.
    return {
      ...staticConfig,
      app: {
        ...(staticConfig?.app ?? {}),
        ...(dbConfig as Record<string, unknown>),
      } as ClientConfig['app'],
    } as ClientConfig;
  } catch {
    return staticConfig;
  }
}
