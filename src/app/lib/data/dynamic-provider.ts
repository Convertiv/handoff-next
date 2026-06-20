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
import { injectSystemUtilityLinks, mergeDbNavIntoSkeleton, shapeComponentCatalogSubSections } from './menu-merge';

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
/**
 * Recursively walk a DTCG JSON tree and collect all leaf tokens where $type
 * matches the requested type. Returns the filtered subtree and the set of
 * CSS custom-property names that correspond to those tokens.
 *
 * Why: DTCG trees group tokens by semantic role (e.g. "hagyard-navy",
 * "semantic", "resolvet-blue") rather than by DTCG type ("color"). Filtering
 * by CSS variable prefix alone (--color-*) therefore misses every color token
 * whose variable name doesn't start with "--color". Walking by $type finds them
 * regardless of where they sit in the tree.
 */
/**
 * Collect all leaf tokens from a DTCG group regardless of $type.
 * Used when the top-level group key already identifies the token category.
 */
function collectAllDtcgLeaves(
  obj: Record<string, unknown>,
  cssPrefix: string,
): { filteredDtcg: Record<string, unknown>; cssNames: Set<string> } {
  const filteredDtcg: Record<string, unknown> = {};
  const cssNames = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'object' || value === null) continue;
    const item = value as Record<string, unknown>;
    if ('$value' in item) {
      filteredDtcg[key] = item;
      cssNames.add(`${cssPrefix}${key}`);
    } else {
      const nested = collectAllDtcgLeaves(item, `${cssPrefix}${key}-`);
      if (Object.keys(nested.filteredDtcg).length > 0) {
        filteredDtcg[key] = nested.filteredDtcg;
        for (const name of nested.cssNames) cssNames.add(name);
      }
    }
  }
  return { filteredDtcg, cssNames };
}

function collectDtcgByType(
  obj: Record<string, unknown>,
  type: string,
  cssPrefix = '--',
): { filteredDtcg: Record<string, unknown>; cssNames: Set<string> } {
  const filteredDtcg: Record<string, unknown> = {};
  const cssNames = new Set<string>();

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== 'object' || value === null) continue;
    const item = value as Record<string, unknown>;
    if ('$value' in item) {
      // Leaf: match by $type
      if (item['$type'] === type) {
        filteredDtcg[key] = item;
        cssNames.add(`${cssPrefix}${key}`);
      }
    } else {
      // Non-leaf group: when the group key matches the requested type (e.g. the
      // "spacing" group for type='spacing'), collect ALL its leaves regardless of
      // $type. Style Dictionary resolved DTCG uses group names as type identifiers
      // and stores spacing as $type:'dimension', so $type matching alone misses them.
      if (key === type) {
        const nested = collectAllDtcgLeaves(item, `${cssPrefix}${key}-`);
        if (Object.keys(nested.filteredDtcg).length > 0) {
          filteredDtcg[key] = nested.filteredDtcg;
          for (const name of nested.cssNames) cssNames.add(name);
        }
      } else {
        const nested = collectDtcgByType(item, type, `${cssPrefix}${key}-`);
        if (Object.keys(nested.filteredDtcg).length > 0) {
          filteredDtcg[key] = nested.filteredDtcg;
          for (const name of nested.cssNames) cssNames.add(name);
        }
      }
    }
  }
  return { filteredDtcg, cssNames };
}

function filterCssLinesByNames(content: string, names: Set<string>): string {
  const lines = content.split('\n').filter((l) => {
    const t = l.trim();
    return Array.from(names).some((n) => t.startsWith(n + ':') || t.startsWith(n + ' '));
  });
  return `:root {\n${lines.join('\n')}\n}`;
}

function filterScssLinesByNames(content: string, names: Set<string>): string {
  return content
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return Array.from(names).some((n) => {
        const scssName = `$${n.slice(2)}`; // --foo → $foo
        return t.startsWith(scssName + ':') || t.startsWith(scssName + ' ');
      });
    })
    .join('\n');
}

function filterTailwindLinesByNames(content: string, names: Set<string>): string {
  const lines = content.split('\n').filter((l) => {
    const t = l.trim();
    return Array.from(names).some((n) => t.startsWith(n + ':') || t.startsWith(n + ' '));
  });
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
  const code = (err as { cause?: { code?: string } })?.cause?.code;
  // 42P01 = undefined_table, 42703 = undefined_column (pending migration)
  return code === '42P01' || code === '42703';
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
      const dtcgObj = (row.dtcg ?? {}) as Record<string, unknown>;
      const { filteredDtcg, cssNames } = collectDtcgByType(dtcgObj, type);
      return {
        css:      filterCssLinesByNames(row.css ?? '', cssNames),
        scss:     filterScssLinesByNames(row.scss ?? '', cssNames),
        tailwind: filterTailwindLinesByNames(row.tailwind ?? '', cssNames),
        dtcg:     JSON.stringify(filteredDtcg, null, 2),
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

  async getDtcgBrands(): Promise<import('./types').DtcgBrandTokens | null> {
    let row: import('../db/registry-queries').RegistryDtcgPayload | null = null;
    try {
      const { getRegistryDtcg } = await import('../db/registry-queries');
      row = await getRegistryDtcg();
    } catch (err) {
      if (!isBuildPhase() && !isUndefinedTableError(err)) throw err;
      logDbFallback('handoff_registry_dtcg', err);
    }
    if (row?.brands && Object.keys(row.brands).length > 0) {
      return row.brands as import('./types').DtcgBrandTokens;
    }
    return this.fallback.getDtcgBrands();
  }

  async getPageContent(localPath: string, slug: string | string[] | undefined): Promise<DocPageContent> {
    // Derive the DB slug from the docs-relative path, e.g.
    //   localPath='docs/foundations/', slug='colors' → 'foundations/colors'
    //   localPath='docs/',             slug='foundations' → 'foundations'
    const docPath = localPath.startsWith('docs/') ? localPath.slice('docs/'.length) : localPath;
    const slugStr = typeof slug === 'string' ? slug : (Array.isArray(slug) ? slug.join('/') : '');
    const dbSlug = `${docPath}${slugStr}`.replace(/\/+$/, '');

    // Check the DB for user-saved overrides (inline edits / workspace pushes).
    if (dbSlug && !isBuildPhase()) {
      try {
        const { getHandoffPageBySlug } = await import('../server/doc-pages');
        const row = await getHandoffPageBySlug(dbSlug);
        if (row) {
          return {
            metadata: row.frontmatter as DocPageContent['metadata'],
            content: row.markdown,
            options: {} as DocPageContent['options'],
          };
        }
      } catch {
        // DB unavailable — fall through to filesystem
      }
    }

    // Fall back to bundled markdown on disk.
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
    let base = staticBuildMenu();

    // staticBuildMenu() returns [] when config/docs/ can't be found on the
    // filesystem (e.g. Vercel standalone where the traced paths haven't been
    // resolved yet). In registry mode the structural sections — Foundations,
    // System — must always be present so the sidebar renders. Fall back to a
    // hard-coded skeleton that mirrors config/docs/foundations.md.
    if (base.length === 0) {
      const bp = process.env.HANDOFF_APP_BASE_PATH ?? '';
      base = [
        {
          title: 'Foundations',
          weight: 0,
          path: `${bp}/foundations`,
          subSections: [
            { title: 'Colors',        path: `${bp}/foundations/colors`,        image: '', icon: 'palette' },
            { title: 'Typography',    path: `${bp}/foundations/typography`,    image: '', icon: 'type' },
            { title: 'Spacing',       path: `${bp}/foundations/spacing`,       image: '', icon: 'rulers' },
            { title: 'Grid',          path: `${bp}/foundations/grid`,          image: '', icon: 'grid' },
            { title: 'Effects',       path: `${bp}/foundations/effects`,       image: '', icon: 'sparkles' },
            { title: 'Icons',         path: `${bp}/foundations/icons`,         image: '', icon: 'shapes' },
            { title: 'Logo',          path: `${bp}/foundations/logo`,          image: '', icon: 'image' },
            { title: 'Border Radius', path: `${bp}/foundations/border-radius`, image: '', icon: 'square' },
            { title: 'Motion',        path: `${bp}/foundations/motion`,        image: '', icon: 'zap' },
            { title: 'Focus States',  path: `${bp}/foundations/focus`,         image: '', icon: 'focus' },
            { title: 'Elevation',     path: `${bp}/foundations/elevation`,     image: '', icon: 'layers' },
            { title: 'Assets',        path: `${bp}/foundations/assets`,        image: '', icon: 'library' },
          ],
        },
        {
          title: 'System',
          weight: 5,
          path: `${bp}/system`,
          subSections: [],
        },
      ];
    }

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

  async getIconCatalog(): Promise<import('./types').IconCatalog> {
    try {
      const { getDb } = await import('../db');
      const db = getDb();
      const { handoffRegistryIcons } = await import('../db/schema');
      const { eq } = await import('drizzle-orm');
      const [row] = await db.select().from(handoffRegistryIcons).where(eq(handoffRegistryIcons.id, 'default')).limit(1);
      return (row?.catalog ?? []) as import('./types').IconCatalog;
    } catch {
      return [];
    }
  }

  async getLogoSet(): Promise<import('./types').LogoSet | null> {
    try {
      const { getDb } = await import('../db');
      const db = getDb();
      const { handoffRegistryLogos } = await import('../db/schema');
      const { eq } = await import('drizzle-orm');
      const [row] = await db.select().from(handoffRegistryLogos).where(eq(handoffRegistryLogos.id, 'default')).limit(1);
      if (!row?.logoSet || typeof row.logoSet !== 'object' || Array.isArray(row.logoSet)) return null;
      return row.logoSet as import('./types').LogoSet;
    } catch {
      return null;
    }
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
