import 'server-only';

import { asc, eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { getDb } from '../db';
import { handoffPageChanges, handoffPages } from '../db/schema';

export type HandoffPageRow = {
  slug: string;
  frontmatter: Record<string, unknown>;
  markdown: string;
  createdAt: Date | null;
  updatedAt: Date | null;
};

export type HandoffPageSummary = {
  slug: string;
  title: string;
  description: string;
  updatedAt: Date | null;
};

function requireSession(session: Session | null): Session {
  if (!session?.user?.id) throw new Error('Unauthorized');
  return session;
}

/** Build `handoff_page.slug` from docs catch-all route segments (path under `pages/` without `.md`). */
export function docsRouteToPageSlug(dirParts: string[], file: string): string {
  return dirParts.length > 0 ? `${dirParts.join('/')}/${file}` : file;
}

export async function getHandoffPageBySlug(slug: string): Promise<HandoffPageRow | null> {
  const db = getDb();
  const [row] = await db.select().from(handoffPages).where(eq(handoffPages.slug, slug)).limit(1);
  if (!row) return null;
  return {
    slug: row.slug,
    frontmatter: (row.frontmatter as Record<string, unknown>) ?? {},
    markdown: row.markdown ?? '',
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

export async function listHandoffPages(): Promise<HandoffPageSummary[]> {
  const db = getDb();
  const rows = await db
    .select({ slug: handoffPages.slug, frontmatter: handoffPages.frontmatter, updatedAt: handoffPages.updatedAt })
    .from(handoffPages)
    .orderBy(asc(handoffPages.slug));
  return rows.map((row) => {
    const fm = (row.frontmatter as Record<string, unknown>) ?? {};
    return {
      slug: row.slug,
      title: String(fm.menuTitle ?? fm.title ?? row.slug),
      description: String(fm.description ?? ''),
      updatedAt: row.updatedAt ?? null,
    };
  });
}

/** Normalize DB frontmatter for Layout / metadata (title, description, metaTitle, metaDescription). */
export function normalizePageMetadata(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const fm = frontmatter ?? {};
  const title = (fm.title ?? fm.metaTitle ?? 'Documentation') as string;
  const description = (fm.description ?? fm.metaDescription ?? '') as string;
  return {
    ...fm,
    title,
    description,
    metaTitle: (fm.metaTitle ?? fm.title ?? title) as string,
    metaDescription: (fm.metaDescription ?? fm.description ?? description) as string,
  };
}

/**
 * Upsert a page and reflect the change in the registry navigation tree so the
 * new page immediately appears in the sidebar without requiring a workspace push.
 * Nav-sync failure is non-fatal: the page is already saved.
 */
export async function upsertHandoffPage(
  session: Session | null,
  slug: string,
  frontmatter: Record<string, unknown>,
  markdown: string
): Promise<HandoffPageRow> {
  requireSession(session);
  const saved = await upsertHandoffPageInternal(slug, frontmatter, markdown);
  void syncPageToNav(saved.slug, saved.frontmatter).catch(() => undefined);
  return saved;
}

/**
 * Batch upsert pages from a workspace push. Does NOT sync nav — the workspace
 * push manages `handoff_registry_navigation` separately via its own nav push step.
 */
export async function bulkUpsertHandoffPages(
  pages: Array<{ slug: string; frontmatter: Record<string, unknown>; markdown: string }>
): Promise<number> {
  const db = getDb();
  let count = 0;
  for (const page of pages) {
    const trimmedSlug = page.slug.replace(/^\/+|\/+$/g, '');
    if (!trimmedSlug) continue;

    const existing = await getHandoffPageBySlug(trimmedSlug);
    const action = existing ? 'updated' : 'created';
    const titleBefore = existing ? String(existing.frontmatter?.title ?? '') || null : null;
    const titleAfter = String(page.frontmatter?.title ?? '') || null;

    await upsertHandoffPageInternal(trimmedSlug, page.frontmatter, page.markdown);

    await db.insert(handoffPageChanges).values({
      slug: trimmedSlug,
      action,
      trigger: 'push',
      titleBefore,
      titleAfter,
      markdownLengthBefore: existing ? existing.markdown.length : null,
      markdownLengthAfter: page.markdown.length,
    });

    count++;
  }
  return count;
}

/**
 * Actor-parameterized doc-page upsert for non-session callers (the MCP page
 * tools). Upserts the page, records a `page_change` row (unified changelog +
 * change-why, with an optional "why" message), and syncs the nav tree — the
 * same tracking the UI/push paths do, but authorized by an MCP actor.
 */
export interface DocPageActor {
  userId: string | null;
  userName?: string | null;
  message?: string | null;
  trigger?: string;
}

export async function writeDocPage(
  input: { slug: string; frontmatter: Record<string, unknown>; markdown: string },
  actor: DocPageActor
): Promise<{ page: HandoffPageRow; action: 'created' | 'updated' }> {
  const db = getDb();
  const trimmedSlug = input.slug.replace(/^\/+|\/+$/g, '');
  if (!trimmedSlug) throw new Error('Invalid slug');

  const existing = await getHandoffPageBySlug(trimmedSlug);
  const action: 'created' | 'updated' = existing ? 'updated' : 'created';
  const page = await upsertHandoffPageInternal(trimmedSlug, input.frontmatter, input.markdown);

  await db.insert(handoffPageChanges).values({
    slug: trimmedSlug,
    action,
    pushedByUserId: actor.userId,
    pushedByName: actor.userName ?? null,
    trigger: actor.trigger ?? 'mcp',
    titleBefore: existing ? String(existing.frontmatter?.title ?? '') || null : null,
    titleAfter: String(input.frontmatter?.title ?? '') || null,
    markdownLengthBefore: existing ? existing.markdown.length : null,
    markdownLengthAfter: input.markdown.length,
    message: actor.message ?? null,
  });

  void syncPageToNav(trimmedSlug, page.frontmatter).catch(() => undefined);
  return { page, action };
}

/**
 * Delete a doc page (by slug), record the deletion in the unified changelog,
 * and prune it from the registry nav tree. Actor-parameterized like
 * {@link writeDocPage} — used by both the registry editor and the MCP tools.
 */
export async function deleteDocPage(
  slug: string,
  actor: DocPageActor
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const trimmedSlug = slug.replace(/^\/+|\/+$/g, '');
  if (!trimmedSlug) return { ok: false, error: 'Invalid slug' };

  const existing = await getHandoffPageBySlug(trimmedSlug);
  if (!existing) return { ok: false, error: `Page "${trimmedSlug}" not found.` };

  await db.delete(handoffPages).where(eq(handoffPages.slug, trimmedSlug));

  await db.insert(handoffPageChanges).values({
    slug: trimmedSlug,
    action: 'deleted',
    pushedByUserId: actor.userId,
    pushedByName: actor.userName ?? null,
    trigger: actor.trigger ?? 'mcp',
    titleBefore: String(existing.frontmatter?.title ?? '') || null,
    titleAfter: null,
    markdownLengthBefore: existing.markdown.length,
    markdownLengthAfter: null,
    message: actor.message ?? null,
  });

  void removePageFromNav(trimmedSlug).catch(() => undefined);
  return { ok: true };
}

/**
 * Move (rename) a doc page from one slug to another, preserving its content.
 * Fails if `fromSlug` doesn't exist or `toSlug` is already taken. Recorded as
 * a created+deleted pair in the changelog (the `handoff_page_change.action`
 * column only supports created/updated/deleted; a synthetic "moved" value
 * would silently fall through the changelog UI's action union).
 */
export async function moveDocPage(
  fromSlug: string,
  toSlug: string,
  actor: DocPageActor
): Promise<{ ok: true; page: HandoffPageRow } | { ok: false; error: string }> {
  const db = getDb();
  const trimmedFrom = fromSlug.replace(/^\/+|\/+$/g, '');
  const trimmedTo = toSlug.replace(/^\/+|\/+$/g, '');
  if (!trimmedFrom || !trimmedTo) return { ok: false, error: 'Invalid slug' };
  if (trimmedFrom === trimmedTo) return { ok: false, error: 'fromSlug and toSlug are the same.' };

  const existing = await getHandoffPageBySlug(trimmedFrom);
  if (!existing) return { ok: false, error: `Page "${trimmedFrom}" not found.` };
  if (await getHandoffPageBySlug(trimmedTo)) {
    return { ok: false, error: `Page "${trimmedTo}" already exists — delete it first or pick a different slug.` };
  }

  const moveNote = actor.message ? `Moved from ${trimmedFrom} — ${actor.message}` : `Moved from ${trimmedFrom}`;
  const page = await upsertHandoffPageInternal(trimmedTo, existing.frontmatter, existing.markdown);
  await db.delete(handoffPages).where(eq(handoffPages.slug, trimmedFrom));

  await db.insert(handoffPageChanges).values([
    {
      slug: trimmedTo,
      action: 'created',
      pushedByUserId: actor.userId,
      pushedByName: actor.userName ?? null,
      trigger: actor.trigger ?? 'mcp',
      titleBefore: null,
      titleAfter: String(existing.frontmatter?.title ?? '') || null,
      markdownLengthBefore: null,
      markdownLengthAfter: existing.markdown.length,
      message: moveNote,
    },
    {
      slug: trimmedFrom,
      action: 'deleted',
      pushedByUserId: actor.userId,
      pushedByName: actor.userName ?? null,
      trigger: actor.trigger ?? 'mcp',
      titleBefore: String(existing.frontmatter?.title ?? '') || null,
      titleAfter: null,
      markdownLengthBefore: existing.markdown.length,
      markdownLengthAfter: null,
      message: `Moved to ${trimmedTo}`,
    },
  ]);

  void removePageFromNav(trimmedFrom).catch(() => undefined);
  void syncPageToNav(trimmedTo, page.frontmatter).catch(() => undefined);
  return { ok: true, page };
}

async function upsertHandoffPageInternal(
  slug: string,
  frontmatter: Record<string, unknown>,
  markdown: string
): Promise<HandoffPageRow> {
  const db = getDb();
  const trimmedSlug = slug.replace(/^\/+|\/+$/g, '');
  if (!trimmedSlug) throw new Error('Invalid slug');

  await db
    .insert(handoffPages)
    .values({ slug: trimmedSlug, frontmatter, markdown, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: handoffPages.slug,
      set: { frontmatter, markdown, updatedAt: new Date() },
    });

  const saved = await getHandoffPageBySlug(trimmedSlug);
  if (!saved) throw new Error('Failed to save page');
  return saved;
}

// ─── Nav sync ──────────────────────────────────────────────────────────────────

function titleCase(s: string): string {
  return s
    .split(/[-_]/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

type NavNode = {
  slug: string;
  title: string;
  type: string;
  children?: NavNode[];
  definition?: unknown;
  weight?: number;
};

/**
 * Upsert a single node into the registry nav tree, preserving all other nodes.
 * Called after a page save from the registry editor (not from workspace push).
 */
export async function syncPageToNav(
  slug: string,
  frontmatter: Record<string, unknown>
): Promise<void> {
  const { getRegistryNavigation, upsertRegistryNavigation } = await import('../db/registry-queries');
  const currentTree = (await getRegistryNavigation()) ?? [];

  const title = String(frontmatter.menuTitle ?? frontmatter.title ?? titleCase(slug.split('/').pop() ?? slug));
  const weight = typeof frontmatter.weight === 'number' ? frontmatter.weight : undefined;
  const definition = frontmatter.menu as unknown;

  const newTree = upsertNavNode(currentTree as NavNode[], slug, { title, weight, definition });
  await upsertRegistryNavigation(newTree as Parameters<typeof upsertRegistryNavigation>[0], null);
}

/**
 * Recursively upsert a node for the given full slug into the nav tree.
 * Parent category nodes are created on demand if they don't already exist.
 */
function upsertNavNode(
  nodes: NavNode[],
  fullSlug: string,
  attrs: { title: string; weight?: number; definition?: unknown }
): NavNode[] {
  const parts = fullSlug.split('/').filter(Boolean);

  function recurse(current: NavNode[], depth: number): NavNode[] {
    const nodeSlug = parts.slice(0, depth + 1).join('/');
    const isLeaf = depth === parts.length - 1;
    const existingIdx = current.findIndex((n) => n.slug === nodeSlug);

    if (isLeaf) {
      const node: NavNode = {
        slug: nodeSlug,
        title: attrs.title,
        type: 'markdown',
        ...(attrs.weight !== undefined && { weight: attrs.weight }),
        ...(attrs.definition !== undefined && { definition: attrs.definition }),
      };
      if (existingIdx >= 0) {
        // Preserve any children (e.g. if this slug was previously a category)
        return current.map((n, i) =>
          i === existingIdx ? { ...n, ...node, children: n.children } : n
        );
      }
      return [...current, node];
    }

    // Category level — recurse into children
    if (existingIdx >= 0) {
      const parent = current[existingIdx];
      const updatedChildren = recurse(parent.children ?? [], depth + 1);
      return current.map((n, i) => (i === existingIdx ? { ...n, children: updatedChildren } : n));
    }

    // Create missing parent category
    const newChildren = recurse([], depth + 1);
    return [
      ...current,
      {
        slug: nodeSlug,
        title: titleCase(parts[depth]),
        type: 'category',
        children: newChildren,
      },
    ];
  }

  return recurse(nodes, 0);
}

/** Remove a single node (by full slug) from the registry nav tree, called after a page delete/move. */
async function removePageFromNav(slug: string): Promise<void> {
  const { getRegistryNavigation, upsertRegistryNavigation } = await import('../db/registry-queries');
  const currentTree = (await getRegistryNavigation()) ?? [];
  const newTree = removeNavNode(currentTree as NavNode[], slug);
  await upsertRegistryNavigation(newTree as Parameters<typeof upsertRegistryNavigation>[0], null);
}

/**
 * Recursively remove the node for the given full slug from the nav tree.
 * Category nodes left with no children after the removal are pruned too.
 */
function removeNavNode(nodes: NavNode[], fullSlug: string): NavNode[] {
  const parts = fullSlug.split('/').filter(Boolean);

  function recurse(current: NavNode[], depth: number): NavNode[] {
    const nodeSlug = parts.slice(0, depth + 1).join('/');
    const isTarget = depth === parts.length - 1;

    return current
      .map((n): NavNode | null => {
        if (n.slug !== nodeSlug) return n;
        if (isTarget) return null; // drop this node entirely
        return { ...n, children: recurse(n.children ?? [], depth + 1) };
      })
      .filter((n): n is NavNode => n !== null)
      .filter((n) => !(n.type === 'category' && (!n.children || n.children.length === 0)));
  }

  return recurse(nodes, 0);
}
