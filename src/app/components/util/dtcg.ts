import { getDataProvider } from '../../lib/data';

// Re-export types so existing imports continue to work.
export type { DtcgTokenType, DtcgTokenStrings, DtcgManifest } from '../../lib/data/types';

/**
 * Async wrapper — delegates to DataProvider so both workspace-dev mode
 * (StaticDataProvider, reads filesystem) and registry mode (DynamicDataProvider,
 * reads Postgres) work transparently.
 */
export async function fetchDtcgTokenStrings(type: import('../../lib/data/types').DtcgTokenType) {
  return getDataProvider().getDtcgTokenStrings(type);
}

export async function fetchDtcgManifest() {
  return getDataProvider().getDtcgManifest();
}
