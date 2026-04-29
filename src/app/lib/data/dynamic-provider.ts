import type { InferSelectModel } from 'drizzle-orm';
import type { ComponentListObject, ComponentObject, PatternListObject, PatternObject } from '@handoff/transformers/preview/types';
import type { ClientConfig } from '@handoff/types/config';
import type { Types as CoreTypes } from 'handoff-core';
import type { SectionLink } from '../../components/util';
import {
  buildComponentSubmenusFromSummaries,
  fetchDocPageMetadataAndContent,
  getClientRuntimeConfig,
  staticBuildMenu,
  type ComponentMenuSummary,
} from '../../components/util';
import { handoffComponents, handoffPatterns } from '../db/schema';
import { getDbComponents, getDbPatterns, getDbTokensSnapshot } from '../db/queries';
import type { DataProvider, DocPageContent } from './types';
import { StaticDataProvider } from './static-provider';

type HandoffComponentRow = InferSelectModel<typeof handoffComponents>;
type HandoffPatternRow = InferSelectModel<typeof handoffPatterns>;

function componentListFromRow(r: HandoffComponentRow): ComponentListObject {
  if (r.data && typeof r.data === 'object') {
    return r.data as ComponentListObject;
  }
  return {
    id: r.id,
    path: r.path ?? `/${r.id}`,
    title: r.title,
    description: r.description ?? '',
    group: r.group ?? '',
    image: r.image ?? '',
    type: r.type ?? 'element',
    properties: (r.properties ?? {}) as ComponentObject['properties'],
    previews: (r.previews ?? {}) as ComponentObject['previews'],
  } as ComponentListObject;
}

function componentObjectFromRow(r: HandoffComponentRow): ComponentObject | null {
  if (r.data && typeof r.data === 'object') {
    return r.data as ComponentObject;
  }
  const list = componentListFromRow(r);
  return list as ComponentObject;
}

function patternListFromRow(r: HandoffPatternRow): PatternListObject {
  if (r.data && typeof r.data === 'object') {
    return r.data as PatternListObject;
  }
  return {
    id: r.id,
    path: r.path ?? `/system/pattern/${r.id}`,
    title: r.title,
    description: r.description ?? '',
    group: r.group ?? '',
    tags: (r.tags as string[]) ?? [],
    components: (r.components as PatternObject['components']) ?? [],
  } as PatternListObject;
}

function patternObjectFromRow(r: HandoffPatternRow): PatternObject | null {
  if (r.data && typeof r.data === 'object') {
    return r.data as PatternObject;
  }
  const list = patternListFromRow(r);
  return list as PatternObject;
}

/**
 * Merge static list with DB rows. When `data` jsonb is present, DB row wins (post-import source of truth).
 * When DB has a row but no `data`, keep the static list entry if any so the merged list stays rich.
 */
function mergeComponentLists(staticList: ComponentListObject[], dbRows: HandoffComponentRow[]): ComponentListObject[] {
  const merged = new Map<string, ComponentListObject>();
  for (const item of staticList) {
    merged.set(item.id, item);
  }
  for (const r of dbRows) {
    if (r.data && typeof r.data === 'object') {
      merged.set(r.id, componentListFromRow(r));
    } else if (!merged.has(r.id)) {
      merged.set(r.id, componentListFromRow(r));
    }
  }
  return [...merged.values()].sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
}

function mergedComponentsToMenuSummaries(list: ComponentListObject[]): ComponentMenuSummary[] {
  return list.map((c) => ({
    id: c.id,
    type: c.type,
    group: c.group ?? '',
    name: c.title || '',
    description: c.description || '',
  }));
}

/** Heuristic: Design System → Components blocks use links under `system/component/`. */
function looksLikeComponentCatalogSubSections(sub: SectionLink['subSections']): boolean {
  if (!sub || sub.length === 0) return false;
  return sub.some(
    (sec) =>
      sec.menu &&
      sec.menu.length > 0 &&
      sec.menu.some((m) => typeof m.path === 'string' && m.path.includes('system/component/'))
  );
}

function injectMergedComponentMenus(menu: SectionLink[], merged: ComponentListObject[]): SectionLink[] {
  const summaries = mergedComponentsToMenuSummaries(merged);
  const rebuilt = buildComponentSubmenusFromSummaries(summaries, true) as Array<{ title: string; menu: { path: string; title: string }[] }>;
  const asSubSections: SectionLink['subSections'] = rebuilt.map((block) => ({
    title: block.title,
    path: '',
    image: '',
    menu: block.menu.map((item) => ({
      title: item.title,
      path: item.path,
      image: '',
    })),
  }));

  return menu.map((section) => {
    const isSystemSection = section.path === '/system' || section.path?.endsWith('/system');
    if (!isSystemSection || !section.subSections?.length) return section;
    if (!looksLikeComponentCatalogSubSections(section.subSections)) return section;
    return { ...section, subSections: asSubSections };
  });
}

function mergePatternLists(staticList: PatternListObject[], dbRows: HandoffPatternRow[]): PatternListObject[] {
  const merged = new Map<string, PatternListObject>();
  for (const item of staticList) {
    merged.set(item.id, item);
  }
  for (const r of dbRows) {
    if (r.data && typeof r.data === 'object') {
      merged.set(r.id, patternListFromRow(r));
    } else if (!merged.has(r.id)) {
      merged.set(r.id, patternListFromRow(r));
    }
  }
  return [...merged.values()].sort((a, b) => (a.title || a.id).localeCompare(b.title || b.id));
}

/**
 * DB-backed provider with progressive fallback to filesystem/static APIs.
 * In dynamic mode, component/pattern lists merge DB + built static JSON so disk-only
 * items stay visible after partial DB imports.
 */
export class DynamicDataProvider implements DataProvider {
  private fallback = new StaticDataProvider();

  async getComponents(): Promise<ComponentListObject[]> {
    const [dbRows, staticList] = await Promise.all([getDbComponents(), this.fallback.getComponents()]);
    return mergeComponentLists(staticList, dbRows);
  }

  async getComponent(id: string): Promise<ComponentObject | null> {
    const rows = await getDbComponents();
    const row = rows.find((r) => r.id === id);
    if (row?.data && typeof row.data === 'object') {
      return row.data as ComponentObject;
    }
    const disk = await this.fallback.getComponent(id);
    if (!row) return disk;
    // Row exists but no full `data` payload — prefer built static artifact when present
    if (disk) return disk;
    return componentObjectFromRow(row);
  }

  async getPatterns(): Promise<PatternListObject[]> {
    const [dbRows, staticList] = await Promise.all([getDbPatterns(), this.fallback.getPatterns()]);
    return mergePatternLists(staticList, dbRows);
  }

  async getPattern(id: string): Promise<PatternObject | null> {
    const rows = await getDbPatterns();
    const row = rows.find((r) => r.id === id);
    if (row?.data && typeof row.data === 'object') {
      return row.data as PatternObject;
    }
    const disk = await this.fallback.getPattern(id);
    if (!row) return disk;
    if (disk) return disk;
    return patternObjectFromRow(row);
  }

  async getTokens(): Promise<CoreTypes.IDocumentationObject> {
    const snap = await getDbTokensSnapshot();
    if (snap) {
      return snap as CoreTypes.IDocumentationObject;
    }
    return this.fallback.getTokens();
  }

  async getPageContent(localPath: string, slug: string | string[] | undefined): Promise<DocPageContent> {
    // Future: read from `pages` table; for now same as static markdown resolution
    const { metadata, content, options } = fetchDocPageMetadataAndContent(localPath, slug);
    return {
      metadata: metadata as DocPageContent['metadata'],
      content: content ?? '',
      options: (options ?? {}) as DocPageContent['options'],
    };
  }

  getConfig(): ClientConfig {
    return getClientRuntimeConfig();
  }

  async getMenu(): Promise<SectionLink[]> {
    const base = staticBuildMenu();
    const merged = await this.getComponents();
    return injectMergedComponentMenus(base, merged);
  }
}
