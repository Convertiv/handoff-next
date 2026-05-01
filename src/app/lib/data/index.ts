import { DynamicDataProvider } from './dynamic-provider';
import { StaticDataProvider } from './static-provider';
import type { DataProvider } from './types';

export type { DataProvider, DocPageContent } from './types';
export { StaticDataProvider } from './static-provider';
export { DynamicDataProvider } from './dynamic-provider';
export { getComponentIdsForStaticParams, getPublicApiDir } from './static-provider';

let cached: DataProvider | null = null;

export function getDataProvider(): DataProvider {
  if (cached) return cached;
  cached = new DynamicDataProvider();
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
