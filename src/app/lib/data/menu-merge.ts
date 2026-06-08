/**
 * Pure helpers that shape navigation data for the runtime.
 *
 * Extracted from `dynamic-provider.ts` so they can be unit-tested without
 * pulling the full Next graph. The provider re-exports the same functions
 * — there's no behavior change, just isolation.
 *
 * Invariants the renderer assumes (and these helpers must guarantee):
 *  - Every rendered `path` is a string. Never undefined, never null.
 *  - Component-catalog nav has shape Type → Group → Leaf, not flattened.
 *  - DB-derived sections never clobber a populated skeleton subSections list.
 *  - Slugs are normalized (leading slash, no trailing slash, lowercased)
 *    before any equality check.
 */

import type { SectionLink } from '../../components/util';

export type DbNavNode = {
  slug: string;
  title: string;
  type: string;
  children?: unknown[];
  /**
   * Optional explicit sidebar definition, pushed from the page's frontmatter
   * `menu:` key. When present, the runtime uses it verbatim as subSections
   * (preserves group labels, icons, nested children). When absent, falls back
   * to `children`.
   */
  definition?: unknown;
  icon?: string;
  weight?: number;
};

/** Normalize a slug or path to a canonical comparable form. */
export function normalizeNavPath(s: string | null | undefined): string {
  if (typeof s !== 'string' || s.trim().length === 0) return '/';
  const trimmed = s.trim().toLowerCase();
  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeading.length > 1 ? withLeading.replace(/\/+$/, '') : withLeading;
}

/**
 * Collapse duplicate slugs in a DB nav tree at every depth. Category nodes
 * (with children) win over markdown nodes (without). Children from later
 * duplicates are unioned and recursively deduped.
 */
export function dedupeDbNavBySlug(nodes: DbNavNode[]): DbNavNode[] {
  const order: string[] = [];
  const bySlug = new Map<string, DbNavNode>();
  for (const raw of nodes) {
    const slug = normalizeNavPath(raw.slug);
    const childrenIn = Array.isArray(raw.children) ? (raw.children as DbNavNode[]) : undefined;
    const existing = bySlug.get(slug);
    if (!existing) {
      order.push(slug);
      bySlug.set(slug, {
        ...raw,
        slug,
        children: childrenIn ? dedupeDbNavBySlug(childrenIn) : undefined,
      });
      continue;
    }
    const existingChildren = Array.isArray(existing.children) ? (existing.children as DbNavNode[]) : [];
    const mergedChildren = dedupeDbNavBySlug([...existingChildren, ...(childrenIn ?? [])]);
    bySlug.set(slug, {
      ...existing,
      title: existing.title || raw.title,
      type:
        existingChildren.length > 0 || (childrenIn?.length ?? 0) > 0 ? 'category' : existing.type,
      children: mergedChildren.length > 0 ? mergedChildren : undefined,
    });
  }
  return order.map((s) => bySlug.get(s)!);
}

/**
 * Resolver for dynamic markers in a pushed frontmatter `menu:`. The workspace's
 * `staticBuildMenu` substitutes these on the fly by reading the filesystem;
 * the registry has to substitute them from the live DB-backed component /
 * token / pattern data instead.
 *
 * Each method returns an array of subSection-shaped objects (with `menu`
 * inside as needed). The merge inlines those at the marker's position,
 * dropping the marker container — matching how the workspace resolves them.
 *
 * Returning `null`/`undefined` (or omitting the method) means "I don't have
 * data for this marker"; the marker is then dropped to avoid empty groups.
 */
export interface DynamicMenuResolver {
  /**
   * @param type  Filter from the frontmatter — `true` for "all components
   *              grouped by type", or a specific type string like 'element',
   *              'block', 'data', 'template'.
   */
  components?: (type: boolean | string) => Array<{ title: string; menu: Array<{ path: string; title: string }> }> | null | undefined;
  tokens?: () => Array<{ title: string; path?: string; menu?: Array<{ path: string; title: string }> }> | null | undefined;
  patterns?: () => Array<{ title: string; menu: Array<{ path: string; title: string }> }> | null | undefined;
}

/**
 * Coerce a value into the SectionLink subSections shape. Used to turn a
 * pushed frontmatter `menu:` payload (raw user-authored YAML) into a tree the
 * registry SideNav can render. Filters anything that would crash the renderer
 * (non-string paths, missing titles).
 *
 * Dynamic markers (`tokens: true`, `components: 'element'`, `patterns: true`)
 * are resolved via `opts.resolver` when present — same substitution the
 * workspace performs via staticBuildComponentMenu / staticBuildTokensMenu /
 * staticBuildPatternMenu. Markers without a resolver are dropped.
 */
export function coerceDefinitionToSubSections(
  def: unknown,
  opts: { resolver?: DynamicMenuResolver; basePath?: string } = {}
): SectionLink['subSections'] {
  if (!Array.isArray(def)) return [];
  const resolver = opts.resolver;

  // Returns `null` to drop, an array to inline (replacing the marker), or a
  // single object to keep as a normal entry.
  const visit = (node: unknown): unknown[] | unknown | null => {
    if (!node || typeof node !== 'object') return null;
    const n = node as {
      title?: unknown;
      path?: unknown;
      icon?: unknown;
      menu?: unknown;
      external?: unknown;
      components?: unknown;
      tokens?: unknown;
      patterns?: unknown;
      enabled?: unknown;
    };
    if (n.enabled === false) return null;

    // Dynamic marker check — if any of these keys are present, the entry is
    // ONLY meaningful via the resolver. Skip entirely when no resolver was
    // provided rather than rendering an empty group with just the title.
    const isDynamic = n.components !== undefined || n.tokens !== undefined || n.patterns !== undefined;
    if (isDynamic && !resolver) return null;

    // Dynamic markers — resolved via the provider's live data.
    if (n.components !== undefined && resolver?.components) {
      const filter = typeof n.components === 'string' || n.components === true ? n.components : true;
      const groups = resolver.components(filter as boolean | string) ?? [];
      if (groups.length === 0) return null;
      // `components: true` → inline all type-groups at this level
      // (matches staticBuildMenu's behavior for the boolean form).
      if (n.components === true) {
        return groups.map((g) => ({ title: g.title, path: '', image: '', menu: g.menu.map((m) => ({ ...m, image: '' })) }));
      }
      // `components: '<type>'` → one wrapping group titled by the YAML `title:`.
      // Preserve the inner group structure (Inputs / Forms / etc.) so the
      // sidebar renders Atoms → Inputs → Button rather than flattening to
      // Atoms → Button. CollapsibleMenuItem handles the nested menu.
      return [{
        title: typeof n.title === 'string' ? n.title : '',
        path: '',
        image: '',
        menu: groups.map((g) => ({
          title: g.title,
          path: '',
          image: '',
          menu: g.menu.map((m) => ({ ...m, image: '' })),
        })),
      }];
    }
    if (n.tokens !== undefined && resolver?.tokens) {
      const tokensMenu = resolver.tokens() ?? [];
      if (tokensMenu.length === 0) return null;
      return [{
        title: typeof n.title === 'string' && n.title.length > 0 ? n.title : 'Tokens',
        path: '',
        image: '',
        menu: tokensMenu.map((entry) => ({
          title: entry.title,
          path: entry.path ?? '',
          image: '',
          ...(Array.isArray(entry.menu) ? { menu: entry.menu.map((m) => ({ ...m, image: '' })) } : {}),
        })),
      }];
    }
    if (n.patterns !== undefined && resolver?.patterns) {
      const groups = resolver.patterns() ?? [];
      if (groups.length === 0) return null;
      return [{
        title: typeof n.title === 'string' && n.title.length > 0 ? n.title : 'Patterns',
        path: '',
        image: '',
        menu: groups.flatMap((g) => g.menu).map((m) => ({ ...m, image: '' })),
      }];
    }

    // Plain entry — recursively process its menu.
    const title = typeof n.title === 'string' ? n.title : '';
    const rawPath = typeof n.path === 'string' ? n.path : '';
    const path = rawPath === '' ? '' : rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
    const out: Record<string, unknown> = { title, path, image: '' };
    if (typeof n.icon === 'string') out.icon = n.icon;
    if (typeof n.external === 'string' || typeof n.external === 'boolean') out.external = n.external;
    if (Array.isArray(n.menu)) {
      const nested: unknown[] = [];
      for (const child of n.menu) {
        const r = visit(child);
        if (r === null) continue;
        if (Array.isArray(r)) nested.push(...r);
        else nested.push(r);
      }
      if (nested.length > 0) out.menu = nested;
    }
    return out;
  };

  const out: unknown[] = [];
  for (const item of def) {
    const r = visit(item);
    if (r === null) continue;
    if (Array.isArray(r)) out.push(...r);
    else out.push(r);
  }
  return out as unknown as SectionLink['subSections'];
}

/**
 * Merge DB-pushed navigation nodes into a structural skeleton.
 *  - Skeleton sections without a DB counterpart are preserved.
 *  - DB children for an existing section are MERGED into its subSections by
 *    path (not overwritten). Empty DB children preserves skeleton entirely.
 *  - DB sections without a skeleton counterpart are appended.
 */
export function mergeDbNavIntoSkeleton(
  skeleton: SectionLink[],
  dbTree: DbNavNode[],
  opts: { resolver?: DynamicMenuResolver; basePath?: string } = {}
): SectionLink[] {
  const cleanTree = dedupeDbNavBySlug(dbTree);
  const dbBySlug = new Map(cleanTree.map((n) => [normalizeNavPath(n.slug), n]));
  const skeletonBySlug = new Set(skeleton.map((s) => normalizeNavPath(s.path)));

  const childToSubSection = (child: DbNavNode) => ({
    title: child.title,
    path: normalizeNavPath(child.slug),
    image: '',
    menu: [],
  });

  const subSectionsForNode = (node: DbNavNode): SectionLink['subSections'] => {
    // Explicit frontmatter definition wins — it's authored by the project and
    // carries group labels + icons the auto-walked tree can't infer.
    if (node.definition !== undefined && node.definition !== null) {
      const coerced = coerceDefinitionToSubSections(node.definition, opts);
      if (coerced.length > 0) return coerced;
    }
    if (Array.isArray(node.children)) {
      return (node.children as DbNavNode[]).map(childToSubSection);
    }
    return [];
  };

  const merged: SectionLink[] = skeleton.map((section) => {
    const dbNode = dbBySlug.get(normalizeNavPath(section.path));
    if (!dbNode) return section;
    // If the project pushed an explicit definition for this section, it wins
    // over the skeleton's auto-derived subSections.
    if (dbNode.definition !== undefined && dbNode.definition !== null) {
      const coerced = coerceDefinitionToSubSections(dbNode.definition, opts);
      if (coerced.length > 0) {
        return { ...section, title: dbNode.title || section.title, subSections: coerced };
      }
    }
    const dbChildren = Array.isArray(dbNode.children) ? (dbNode.children as DbNavNode[]) : [];
    if (dbChildren.length === 0) return section;
    const existing = section.subSections ?? [];
    const seen = new Set(existing.map((s) => normalizeNavPath(s.path ?? '')));
    const additions = dbChildren
      .filter((c) => !seen.has(normalizeNavPath(c.slug)))
      .map(childToSubSection);
    return {
      ...section,
      title: dbNode.title || section.title,
      subSections: [...existing, ...additions],
    };
  });

  for (const node of cleanTree) {
    const slug = normalizeNavPath(node.slug);
    if (skeletonBySlug.has(slug)) continue;
    merged.push({
      title: node.title,
      weight: node.weight ?? 0,
      path: slug,
      subSections: subSectionsForNode(node),
    });
  }

  return merged;
}

/**
 * Convert the (lying-cast) output of `buildComponentSubmenusFromSummaries(..., true)`
 * into SectionLink subSections. The function returns a 3-level tree
 * (Type → Group → Leaf); the runtime SideNav walks `.menu` recursively, so
 * the nesting must be preserved. Filters at each level guarantee no rendered
 * `path` is undefined.
 */
export function shapeComponentCatalogSubSections(
  rebuilt: unknown
): SectionLink['subSections'] {
  type Leaf = { path: string; title: string };
  type Group = { title: string; menu: Leaf[] };
  type Block = { title: string; menu: Group[] };

  const blocks = Array.isArray(rebuilt) ? (rebuilt as Block[]) : [];
  return blocks.map((block) => ({
    title: block?.title ?? 'Components',
    path: '',
    image: '',
    menu: (Array.isArray(block?.menu) ? block.menu : [])
      .filter((group): group is Group => Boolean(group) && Array.isArray(group?.menu))
      .map((group) => ({
        title: group.title ?? '',
        path: '',
        image: '',
        menu: group.menu
          .filter(
            (leaf): leaf is Leaf =>
              Boolean(leaf) && typeof leaf?.path === 'string' && leaf.path.length > 0
          )
          .map((leaf) => ({ title: leaf.title ?? '', path: leaf.path, image: '' })),
      })),
  })) as unknown as SectionLink['subSections'];
}

/**
 * Walk a rendered nav structure and collect every `path` that the renderer
 * would feed to Next/Link. Used in tests to assert nothing reaches the
 * renderer as `undefined` (which crashes Next's URL parser with a `.split`
 * TypeError on prefetch).
 */
export function collectRenderedPaths(menu: SectionLink[]): unknown[] {
  const paths: unknown[] = [];
  const walk = (items: unknown[]): void => {
    for (const raw of items) {
      const item = raw as { path?: unknown; menu?: unknown[]; subSections?: unknown[] };
      paths.push(item.path);
      if (Array.isArray(item.menu)) walk(item.menu);
      if (Array.isArray(item.subSections)) walk(item.subSections);
    }
  };
  walk(menu);
  return paths;
}
