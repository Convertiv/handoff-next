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
 * Merge DB-pushed navigation nodes into a structural skeleton.
 *  - Skeleton sections without a DB counterpart are preserved.
 *  - DB children for an existing section are MERGED into its subSections by
 *    path (not overwritten). Empty DB children preserves skeleton entirely.
 *  - DB sections without a skeleton counterpart are appended.
 */
export function mergeDbNavIntoSkeleton(
  skeleton: SectionLink[],
  dbTree: DbNavNode[]
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

  const merged: SectionLink[] = skeleton.map((section) => {
    const dbNode = dbBySlug.get(normalizeNavPath(section.path));
    const dbChildren = Array.isArray(dbNode?.children) ? (dbNode!.children as DbNavNode[]) : [];
    if (dbChildren.length === 0) return section;
    const existing = section.subSections ?? [];
    const seen = new Set(existing.map((s) => normalizeNavPath(s.path ?? '')));
    const additions = dbChildren
      .filter((c) => !seen.has(normalizeNavPath(c.slug)))
      .map(childToSubSection);
    return {
      ...section,
      title: dbNode?.title || section.title,
      subSections: [...existing, ...additions],
    };
  });

  for (const node of cleanTree) {
    const slug = normalizeNavPath(node.slug);
    if (skeletonBySlug.has(slug)) continue;
    merged.push({
      title: node.title,
      weight: 0,
      path: slug,
      subSections: Array.isArray(node.children)
        ? (node.children as DbNavNode[]).map(childToSubSection)
        : [],
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
