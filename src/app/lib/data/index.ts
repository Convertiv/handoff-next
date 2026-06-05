import { usePostgres } from '../db/dialect';
import { DynamicDataProvider } from './dynamic-provider';
import { HybridDataProvider } from './hybrid-provider';
import { StaticDataProvider } from './static-provider';
import type { DataProvider } from './types';

export type { DataProvider, DocPageContent } from './types';
export { StaticDataProvider } from './static-provider';
export { HybridDataProvider } from './hybrid-provider';
export { DynamicDataProvider } from './dynamic-provider';
export { getComponentIdsForStaticParams } from './static-provider';
export { getPublicApiDir } from '../server/public-api-paths';

// Resolved once at module load — mode cannot change between requests.
// registry mode (DATABASE_URL present): DynamicDataProvider (Postgres, StaticDataProvider fallback for migration)
// workspace mode (no DATABASE_URL):     StaticDataProvider (filesystem only, zero DB access)
let cached: DataProvider | null = null;

export function getDataProvider(): DataProvider {
  if (cached) return cached;
  cached = usePostgres() ? new DynamicDataProvider() : new StaticDataProvider();
  return cached;
}

/** @deprecated Prefer `getDataProvider()` — re-export for incremental migration */
export {
  staticBuildMenu,
  fetchDocPageMarkdown,
  fetchDocPageMarkdownAsync,
  fetchFoundationDocPageMarkdown,
  fetchFoundationDocPageMarkdownAsync,
  fetchCompDocPageMarkdown,
  fetchCompDocPageMarkdownAsync,
} from '../../components/util';
export {
  buildCatchAllStaticPaths,
  fetchComponents,
  fetchPatterns,
  getClientRuntimeConfig,
  getTokens,
  getCurrentSection,
  fetchDocPageMetadataAndContent,
  MARKDOWN_CATCHALL_RESERVED_FIRST_SEGMENTS,
  pluralizeComponent,
} from '../../components/util';
