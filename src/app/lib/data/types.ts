import type { ComponentListObject, ComponentObject, PatternListObject, PatternObject } from '@handoff/transformers/preview/types';
import type { ClientConfig } from '@handoff/types/config';
import type { Types as CoreTypes } from 'handoff-core';
import type { ComponentDocumentationOptions } from '@handoff/types/preview';
import type { SectionLink } from '../../components/util';

export type DocPageContent = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
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

// ─── Icon catalog ─────────────────────────────────────────────────────────────

export type IconSource =
  | { type: 'library'; library: string; iconifyId: string }
  | { type: 'custom'; svg: string }
  | { type: 'fa-pro'; faId: string; svg: string };

export type IconCatalogEntry = {
  id: string;
  name: string;
  description?: string;
  category: string;
  tags?: string[];
  usage?: string;
  source: IconSource;
  /** Optional DTCG semantic token alias pointing at this icon */
  tokenAlias?: string;
};

export type IconCatalog = IconCatalogEntry[];

// ─── Logo set ──────────────────────────────────────────────────────────────

export type LogoVariant = {
  id: string;
  name: string;
  description?: string;
  /** 'light' | 'dark' | 'color' | 'mono' | 'reversed' */
  variant: string;
  /** 'primary' | 'alternate' | 'wordmark' | 'icon-only' */
  form: string;
  svg: string;
  /** Background color hex or CSS value this variant is designed for */
  background?: string;
  /** Usage guidance for this specific variant */
  usage?: string;
};

export type LogoSet = {
  name: string;
  description?: string;
  clearspace?: string;
  minWidth?: string;
  doNot?: string[];
  variants: LogoVariant[];
};

/** Summary shape used to build the Design System → Components sidebar (grouped by type and group). */
export type ComponentMenuSummary = { id: string; type?: string; group: string; name: string; description?: string };

/** Unified data access for the Handoff app (filesystem and/or DB-backed sources at runtime). */
export interface DataProvider {
  getComponents(): Promise<ComponentListObject[]>;
  getComponent(id: string): Promise<ComponentObject | null>;
  getComponentSummaries(): Promise<ComponentMenuSummary[]>;
  getPatterns(): Promise<PatternListObject[]>;
  getPattern(id: string): Promise<PatternObject | null>;
  getTokens(): Promise<CoreTypes.IDocumentationObject>;
  getDtcgTokenStrings(type: DtcgTokenType): Promise<DtcgTokenStrings | null>;
  getDtcgManifest(): Promise<DtcgManifest | null>;
  getDtcgBrands(): Promise<DtcgBrandTokens | null>;
  getPageContent(localPath: string, slug: string | string[] | undefined): Promise<DocPageContent>;
  getConfig(): ClientConfig;
  getMenu(): Promise<SectionLink[]>;
  getIconCatalog(): Promise<IconCatalog>;
  getLogoSet(): Promise<LogoSet | null>;
}
