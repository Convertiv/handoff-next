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
 * Registry mode provider — reads from Postgres.
 * The StaticDataProvider fallback is a migration safety net only: in steady-state registry
 * mode every component row should carry a full `data` payload populated by CLI push.
 * Do not add new filesystem reads here; workspace-only logic belongs in StaticDataProvider.
 */
/**
 * Detect whether we're inside a Next.js production build (`next build`) rather
 * than serving a request. During build, DB queries should never block the
 * deploy — schema may not be migrated yet, DATABASE_URL may not be parseable
 * by postgres-js, or the DB may simply be unreachable from the Vercel build
 * environment. In all cases, fall back to filesystem so page collection succeeds.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build' || process.env.NEXT_PHASE === 'phase-export';
}

/**
 * Log a DB fallback warning with enough detail to diagnose later.
 * Prefers our augmented error message (contains URL diagnostic from getDb()) when
 * present, falling back to the bare Postgres error code (e.g. ERR_INVALID_URL).
 * During build we always swallow the error; at runtime we only swallow 42P01
 * (missing tables, pre-migration) so other failures surface clearly.
 */
let dbFallbackDiagnosticLogged = false;
function logDbFallback(table: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  // Log the full diagnostic message once per process. Suppress per-query
  // repeats so logs don't drown in identical traces. Next.js spawns multiple
  // workers during build, so this may appear once per worker (1-3 lines).
  if (dbFallbackDiagnosticLogged) return;
  dbFallbackDiagnosticLogged = true;
  console.warn(`[handoff] DB unavailable — falling back to filesystem (first error in ${table}): ${message}`);
}

function isUndefinedTableError(err: unknown): boolean {
  return (err as { cause?: { code?: string } })?.cause?.code === '42P01';
}

async function safeDbComponents(): Promise<HandoffComponentRow[]> {
  try {
    return await getDbComponents();
  } catch (err) {
    if (isBuildPhase() || isUndefinedTableError(err)) {
      logDbFallback('handoff_component', err);
      return [];
    }
    throw err;
  }
}

async function safeDbPatterns(): Promise<HandoffPatternRow[]> {
  try {
    return await getDbPatterns();
  } catch (err) {
    if (isBuildPhase() || isUndefinedTableError(err)) {
      logDbFallback('handoff_pattern', err);
      return [];
    }
    throw err;
  }
}

export class DynamicDataProvider implements DataProvider {
  private fallback = new StaticDataProvider();

  async getComponents(): Promise<ComponentListObject[]> {
    const [dbRows, staticList] = await Promise.all([safeDbComponents(), this.fallback.getComponents()]);
    return mergeComponentLists(staticList, dbRows);
  }

  async getComponent(id: string): Promise<ComponentObject | null> {
    const rows = await safeDbComponents();
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
    const [dbRows, staticList] = await Promise.all([safeDbPatterns(), this.fallback.getPatterns()]);
    return mergePatternLists(staticList, dbRows);
  }

  async getPattern(id: string): Promise<PatternObject | null> {
    const rows = await safeDbPatterns();
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
    let snap: unknown = null;
    try {
      snap = await getDbTokensSnapshot();
    } catch (err) {
      if (!isBuildPhase() && !isUndefinedTableError(err)) throw err;
      logDbFallback('handoff_tokens_snapshot', err);
    }
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
    // Prefer the DB-pushed navigation tree (ADR-001 §1+§3). Fall back to the
    // static filesystem menu if no nav is stored yet (e.g. fresh registry
    // pre-push, or build-phase prerender before migrations).
    try {
      const { getRegistryNavigation } = await import('../db/registry-queries');
      const tree = await getRegistryNavigation();
      if (tree && tree.length > 0) {
        const merged = await this.getComponents();
        return navigationTreeToSectionLinks(tree, merged);
      }
    } catch (err) {
      if (!isBuildPhase() && !isUndefinedTableError(err)) throw err;
      logDbFallback('handoff_registry_navigation', err);
    }
    // Fallback path — same as today
    const base = staticBuildMenu();
    const merged = await this.getComponents();
    return injectMergedComponentMenus(base, merged);
  }
}

/**
 * Convert the DB navigation tree (typed { slug, title, type, children }) to
 * the SectionLink[] shape the rest of the app uses. Component menus get
 * injected for nodes flagged as the component catalog (today: nodes with
 * slug 'system' or 'system/component'); other nodes pass through as-is.
 */
function navigationTreeToSectionLinks(
  tree: { slug: string; title: string; type: string; children?: unknown[] }[],
  components: ComponentListObject[]
): SectionLink[] {
  const toSection = (node: { slug: string; title: string; type: string; children?: unknown[] }): SectionLink => ({
    title: node.title,
    weight: 0,
    path: node.slug.startsWith('/') ? node.slug : `/${node.slug}`,
    subSections: Array.isArray(node.children)
      ? (node.children as typeof tree).map((child) => ({
          title: child.title,
          path: child.slug.startsWith('/') ? child.slug : `/${child.slug}`,
          image: '',
          menu: [],
        }))
      : [],
  });
  const sections = tree.map(toSection);
  // Inject the live component catalog into any /system section the same way
  // staticBuildMenu+injectMergedComponentMenus does for the filesystem nav.
  return injectMergedComponentMenus(sections, components);
}
