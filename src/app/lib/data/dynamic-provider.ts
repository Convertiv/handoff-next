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
import type { DataProvider, DocPageContent, DtcgManifest, DtcgTokenStrings, DtcgTokenType } from './types';
import { StaticDataProvider } from './static-provider';
import { mergeDbNavIntoSkeleton, shapeComponentCatalogSubSections } from './menu-merge';

type HandoffComponentRow = InferSelectModel<typeof handoffComponents>;
type HandoffPatternRow = InferSelectModel<typeof handoffPatterns>;

/**
 * Rewrite a legacy `/images/components/<id>.png` image path to the new
 * generated-screenshot URL convention served by `/api/component/[...path]`.
 *
 * Why this lives at read time, not just at build time: SSC's already-pushed
 * component rows in production have the legacy path baked in. The builder.ts
 * fix only updates `data.image` on the NEXT build; existing rows would
 * continue 404'ing until every workspace rebuilds and re-pushes. Normalizing
 * at read keeps the registry resilient against historical pushes.
 */
function normalizeLegacyImagePath(image: unknown, componentId: string): string {
  if (typeof image !== 'string' || image.length === 0) return '';
  if (/^\/?images\/components\//.test(image)) {
    const base = process.env.HANDOFF_APP_BASE_PATH ?? '';
    return `${base}/api/component/${componentId}/screenshot.png`;
  }
  return image;
}

function componentListFromRow(r: HandoffComponentRow): ComponentListObject {
  if (r.data && typeof r.data === 'object') {
    const data = r.data as ComponentListObject;
    return { ...data, image: normalizeLegacyImagePath(data.image, r.id) };
  }
  return {
    id: r.id,
    path: r.path ?? `/${r.id}`,
    title: r.title,
    description: r.description ?? '',
    group: r.group ?? '',
    image: normalizeLegacyImagePath(r.image, r.id),
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
  const rebuilt = buildComponentSubmenusFromSummaries(summaries, true);
  // Shape is enforced + tested in `./menu-merge.ts` so the bad-paths bug that
  // brought down the registry (Next/Link splitting undefined hrefs) can't
  // come back without a failing test.
  const asSubSections = shapeComponentCatalogSubSections(rebuilt);

  const hasComponents = asSubSections.some((s) => s.menu && s.menu.length > 0);
  let foundSystem = false;
  const next = menu.map((section) => {
    const isSystemSection = section.path === '/system' || section.path?.endsWith('/system');
    if (!isSystemSection) return section;
    foundSystem = true;
    // Replace the catalog when present, OR materialize it on a section that
    // existed via title/path but never received subSections (registry mode
    // with no bundled docs).
    if (!hasComponents) return section;
    if (!section.subSections?.length || looksLikeComponentCatalogSubSections(section.subSections)) {
      return { ...section, subSections: asSubSections };
    }
    return section;
  });

  // Registry-mode safety net: when staticBuildMenu found no `/system` docs at
  // all (which happens on a stock deploy without bundled config/docs), inject
  // a synthetic System section so the component catalog is always reachable
  // and its sidebar always populated. Without this the /system page renders
  // an empty sidebar — see "registry sidebar empty" in the nav fix commit.
  if (!foundSystem && hasComponents) {
    next.push({
      title: 'System',
      weight: 0,
      path: '/system',
      subSections: asSubSections,
    });
  }
  return next;
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
function filterCssLines(content: string, prefix: string): string {
  const lines = content.split('\n').filter((l) => l.trim().startsWith(`--${prefix}`));
  return `:root {\n${lines.join('\n')}\n}`;
}

function filterScssLines(content: string, prefix: string): string {
  return content.split('\n').filter((l) => l.trim().startsWith(`$${prefix}`)).join('\n');
}

function filterTailwindLines(content: string, prefix: string): string {
  const lines = content.split('\n').filter((l) => l.trim().startsWith(`--${prefix}`));
  return `@theme {\n${lines.join('\n')}\n}`;
}

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

  async getDtcgTokenStrings(type: DtcgTokenType): Promise<DtcgTokenStrings | null> {
    let row: import('../db/registry-queries').RegistryDtcgPayload | null = null;
    try {
      const { getRegistryDtcg } = await import('../db/registry-queries');
      row = await getRegistryDtcg();
    } catch (err) {
      if (!isBuildPhase() && !isUndefinedTableError(err)) throw err;
      logDbFallback('handoff_registry_dtcg', err);
    }
    if (row) {
      const dtcgObj = row.dtcg ?? {};
      return {
        css:      filterCssLines(row.css, type),
        scss:     filterScssLines(row.scss, type),
        tailwind: filterTailwindLines(row.tailwind, type),
        dtcg:     JSON.stringify(dtcgObj[type] ?? {}, null, 2),
      };
    }
    return this.fallback.getDtcgTokenStrings(type);
  }

  async getDtcgManifest(): Promise<DtcgManifest | null> {
    let row: import('../db/registry-queries').RegistryDtcgPayload | null = null;
    try {
      const { getRegistryDtcg } = await import('../db/registry-queries');
      row = await getRegistryDtcg();
    } catch (err) {
      if (!isBuildPhase() && !isUndefinedTableError(err)) throw err;
      logDbFallback('handoff_registry_dtcg', err);
    }
    if (row) {
      return row.manifest as DtcgManifest;
    }
    return this.fallback.getDtcgManifest();
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
    // Menu has two layers:
    //   1. Structural: System (component catalog), Foundations (tokens), etc.
    //      These come from handoff-app's bundled config/docs and are ALWAYS
    //      present — they're how users navigate the registry UI.
    //   2. Project content: workspace's pages/ (guidelines, getting started, etc.)
    //      In registry mode these are pushed to handoff_registry_navigation
    //      and merged on top of the structural skeleton.
    //
    // The bug we hit (#47): treating DB nav as a complete replacement made
    // System+Foundations disappear in registry mode when push:all included
    // a DB nav. Fix: always start with staticBuildMenu() as the skeleton,
    // then merge in DB project pages by slug.
    const base = staticBuildMenu();
    const merged = await this.getComponents();
    const skeleton = injectMergedComponentMenus(base, merged);

    let dbTree: import('./menu-merge').DbNavNode[] | null = null;
    try {
      const { getRegistryNavigation } = await import('../db/registry-queries');
      dbTree = await getRegistryNavigation();
    } catch (err) {
      if (!isBuildPhase() && !isUndefinedTableError(err)) throw err;
      logDbFallback('handoff_registry_navigation', err);
    }

    // Build the resolver up front — projects' frontmatter may carry dynamic
    // markers like `{tokens: true}` or `{components: 'element'}` that the
    // workspace's staticBuildMenu substitutes at render time. The registry
    // has to substitute them from live data (DB component list, tokens, etc.)
    // or the system sidebar shows nothing but a top-level "Overview" link.
    const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
    const resolver: import('./menu-merge').DynamicMenuResolver = {
      components: (filter) => {
        const summaries = mergedComponentsToMenuSummaries(merged);
        const groups = buildComponentSubmenusFromSummaries(summaries, filter) as Array<{
          title: string;
          menu: Array<{ path: string; title: string }>;
        }>;
        return groups.filter((g) => Array.isArray(g.menu) && g.menu.length > 0);
      },
      tokens: () => {
        // The token sidebar layout is static (Foundations/Components groupings) —
        // staticBuildTokensMenu reads the filesystem to enumerate component
        // sub-menus, which we can't do in registry mode without the same source.
        // Mirror its top-level shape from the live component list.
        const componentItems = merged.map((c) => ({
          title: c.title || c.id,
          path: `${basePath}/system/tokens/components/${c.id}`,
        }));
        const items: Array<{ title: string; path?: string; menu?: Array<{ path: string; title: string }> }> = [
          {
            title: 'Foundations',
            path: `${basePath}/system/tokens/foundations`,
            menu: [
              { title: 'Colors', path: `${basePath}/system/tokens/foundations/colors` },
              { title: 'Effects', path: `${basePath}/system/tokens/foundations/effects` },
              { title: 'Typography', path: `${basePath}/system/tokens/foundations/typography` },
            ],
          },
        ];
        if (componentItems.length > 0) {
          items.push({
            title: 'Components',
            path: `${basePath}/system/tokens/components`,
            menu: componentItems.sort((a, b) => a.title.localeCompare(b.title)),
          });
        }
        return items;
      },
      // Patterns left undefined — DynamicDataProvider can fetch them via
      // getPatterns() if a project needs it. Kept off by default until we
      // see a workspace that uses `patterns: true` in registry mode.
    };

    const builtMenu: SectionLink[] = !dbTree || dbTree.length === 0
      ? skeleton
      : mergeDbNavIntoSkeleton(skeleton, dbTree, { resolver, basePath });

    // Inject built-in registry utility pages into the System section.
    // These are registry-level features (Health dashboard, Changelog) — they
    // should always appear regardless of what the workspace's system.md defines.
    return injectSystemUtilityLinks(builtMenu, basePath);
  }

  /** Read the validationManifest stored in registry config (pushed by workspace on push:all). */
  async getValidationManifest(): Promise<import('../health-types').ValidationManifest | null> {
    try {
      const { getRegistryConfig } = await import('../db/registry-queries');
      const cfg = await getRegistryConfig();
      if (cfg && typeof cfg === 'object' && 'validationManifest' in cfg) {
        const m = (cfg as Record<string, unknown>).validationManifest;
        if (m && typeof m === 'object' && (m as any).configured === true) {
          return m as import('../../app/system/health/health-types').ValidationManifest;
        }
      }
    } catch {
      // Not fatal — health page shows empty state
    }
    return null;
  }

  /** Read the last N validation run snapshots for the trend chart. */
  async getValidationRunHistory(limit = 30): Promise<import('../db/validation-queries').ValidationRunRecord[]> {
    try {
      const { getValidationRunHistory } = await import('../db/validation-queries');
      return await getValidationRunHistory(limit);
    } catch {
      return [];
    }
  }
}

/**
 * Inject the registry's built-in utility pages (Health, Changelog) into the
 * System section's subSections. These are registry features — they should
 * always be reachable regardless of what a workspace's system.md menu defines.
 *
 * Strategy: find the System section's first subSection that already has a menu
 * (i.e. the "Design System" group with Overview/Figma Sync), and append the
 * utility links there if they're not already present. This keeps them grouped
 * with the top-level system navigation rather than the component catalog.
 */
function injectSystemUtilityLinks(menu: SectionLink[], basePath: string): SectionLink[] {
  const utilLinks = [
    { title: 'Health', path: `${basePath}/system/health` },
    { title: 'Changelog', path: `${basePath}/system/changelog` },
  ];

  return menu.map((section) => {
    const isSystem = section.path === '/system' || section.path === `${basePath}/system` || section.path?.endsWith('/system');
    if (!isSystem) return section;

    // Find the first subSection that has a menu (the "Design System" group)
    const subSections = section.subSections ?? [];
    const firstWithMenu = subSections.findIndex((s) => Array.isArray(s.menu) && s.menu.length > 0);

    if (firstWithMenu === -1) {
      // No existing submenu group — append as a standalone "System" group
      return {
        ...section,
        subSections: [
          ...subSections,
          {
            title: 'System',
            path: `${basePath}/system`,
            image: '',
            menu: utilLinks.map((l) => ({ ...l, image: '' })),
          },
        ],
      };
    }

    // Merge into the first submenu group, skipping any already present
    const existingPaths = new Set(
      (subSections[firstWithMenu].menu ?? []).map((m) => m.path)
    );
    const toAdd = utilLinks
      .filter((l) => !existingPaths.has(l.path))
      .map((l) => ({ ...l, image: '' }));

    if (toAdd.length === 0) return section;

    const updatedSubSections = subSections.map((s, i) =>
      i === firstWithMenu
        ? { ...s, menu: [...(s.menu ?? []), ...toAdd] }
        : s
    );

    return { ...section, subSections: updatedSubSections };
  });
}

/**
 * Implementation moved to `./menu-merge.ts` so its pure shape is unit-tested
 * (test/menu-merge.test.ts). The notes below describe the contract the
 * runtime relies on.
 *
 * Merge DB-pushed navigation nodes into a structural skeleton.
 *
 * Defensive rules — these matter because pushed nav from older clients or
 * filesystems with `pages/foo.md` + `pages/foo/` siblings can carry duplicate
 * slugs. The merge must NOT pass those duplicates through to render.
 *
 *  1. Slugs are normalized (leading slash, no trailing slash, lowercase) on
 *     both sides before comparison.
 *  2. DB tree is collapsed by slug at every depth — if two nodes share a
 *     slug, the category (with children) wins over the leaf, and children
 *     of the leaf are dropped.
 *  3. Skeleton sections without a DB counterpart (System, Foundations, etc.)
 *     are preserved unchanged. Critically, /system always keeps its
 *     skeleton subSections — the component catalog — because the DB nav
 *     has no concept of component groups.
 *  4. When DB provides children for an existing skeleton section, those
 *     children are MERGED into the skeleton's subSections by path, not
 *     overwritten. An empty DB children array preserves skeleton subSections
 *     entirely.
 *  5. DB sections with slugs not in skeleton are appended.
 */
