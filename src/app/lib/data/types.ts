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

export type DtcgTokenType = 'color' | 'typography' | 'shadow' | 'spacing' | 'grid' | 'border-radius' | 'motion' | 'focus' | 'elevation';

export type DtcgTokenStrings = {
  css: string;
  scss: string;
  tailwind: string;
  dtcg: string;
};

export type DtcgManifest = {
  project: string;
  generatedAt: string;
  sources: string[];
  counts: Record<string, number>;
  brands?: string[];
};

/**
 * DTCG token tree for a single brand (or the shared gray ramp).
 * Top-level keys are token groups (e.g. "resolvet-blue", "semantic", "gray").
 * Each group value is a record of token name → DTCG token node.
 */
export type DtcgToken = { $type: string; $value: string; $description?: string };
export type DtcgTokenGroup = Record<string, DtcgToken | Record<string, DtcgToken>>;
export type DtcgBrandTokens = Record<string, DtcgTokenGroup>; // keyed by brand name + 'shared'

/** Unified data access for the Handoff app (filesystem and/or DB-backed sources at runtime). */
export interface DataProvider {
  getComponents(): Promise<ComponentListObject[]>;
  getComponent(id: string): Promise<ComponentObject | null>;
  getPatterns(): Promise<PatternListObject[]>;
  getPattern(id: string): Promise<PatternObject | null>;
  getTokens(): Promise<CoreTypes.IDocumentationObject>;
  getDtcgTokenStrings(type: DtcgTokenType): Promise<DtcgTokenStrings | null>;
  getDtcgManifest(): Promise<DtcgManifest | null>;
  getDtcgBrands(): Promise<DtcgBrandTokens | null>;
  getPageContent(localPath: string, slug: string | string[] | undefined): Promise<DocPageContent>;
  getConfig(): ClientConfig;
  getMenu(): Promise<SectionLink[]>;
}
