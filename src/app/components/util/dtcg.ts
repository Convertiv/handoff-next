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

export async function fetchDtcgBrands() {
  return getDataProvider().getDtcgBrands();
}

/**
 * Fetch raw localStyles color objects from the pushed tokens snapshot.
 * Used as a fallback on the colors page when no DTCG brand tokens have been
 * pushed (e.g. projects that use primitive/semantic token dirs instead of brands/).
 */
export async function fetchLocalStylesColors(): Promise<Array<{
  name: string;
  machineName: string;
  value: string;
  group: string;
}> | null> {
  try {
    const tokens = await getDataProvider().getTokens();
    const localStyles = (tokens as unknown as Record<string, unknown>)?.localStyles;
    const colors = (localStyles as Record<string, unknown> | undefined)?.color;
    return Array.isArray(colors) ? (colors as Array<{ name: string; machineName: string; value: string; group: string }>) : null;
  } catch {
    return null;
  }
}
