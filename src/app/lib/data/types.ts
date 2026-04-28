import type { ComponentListObject, ComponentObject, PatternListObject, PatternObject } from '@handoff/transformers/preview/types';
import type { ClientConfig } from '@handoff/types/config';
import type { Types as CoreTypes } from 'handoff-core';
import type { ComponentDocumentationOptions } from '@handoff/types/preview';
import type { SectionLink } from '../../components/util';

export type DocPageContent = {
  metadata: Record<string, unknown>;
  content: string;
  options: ComponentDocumentationOptions;
};

/**
 * Unified data access for static export vs dynamic (DB-backed) deployment.
 */
export interface DataProvider {
  getComponents(): Promise<ComponentListObject[]>;
  getComponent(id: string): Promise<ComponentObject | null>;
  getPatterns(): Promise<PatternListObject[]>;
  getPattern(id: string): Promise<PatternObject | null>;
  getTokens(): Promise<CoreTypes.IDocumentationObject>;
  getPageContent(localPath: string, slug: string | string[] | undefined): Promise<DocPageContent>;
  getConfig(): ClientConfig;
  getMenu(): Promise<SectionLink[]>;
}
