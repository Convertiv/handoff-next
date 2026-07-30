import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { listHandoffPages } from '@/lib/server/doc-pages';
import { getRegistryNavigation, upsertRegistryNavigation, type NavigationNode } from '@/lib/db/registry-queries';

/**
 * Remove navigation entries that point at pages which no longer exist.
 *
 * The nav tree is stored separately from pages, and only two things write to it: `syncPageToNav` on
 * save/push, and `removePageFromNav` on delete/move **through the app**. A page that simply stops
 * appearing in a workspace push therefore leaves its node behind forever, and nothing reconciles the
 * tree against the pages that actually exist. 8x8 carried a stray "Handoff Design System" → `/index`
 * entry from the default template's landing page for exactly this reason: a menu item that 404s, with
 * nothing in the page list to explain it.
 *
 * Session-authenticated on purpose. The existing `POST /api/registry/navigation` takes a CLI Bearer
 * token only — no cookie fallback — so it cannot be driven from a logged-in browser, which is where
 * someone actually notices a broken menu item.
 *
 * **Dry run by default.** This rewrites the whole tree, so it reports what it would remove and changes
 * nothing until asked. Pass `{ "apply": true }` to commit.
 */

/** Node types that must correspond to a real page. Categories are structure and are judged by children. */
const PAGE_TYPES = new Set(['markdown', 'mdx', 'html']);

type Node = NavigationNode & { slug?: string; title?: string; type?: string; children?: Node[] };

function prune(
  nodes: Node[],
  hasPage: (slug: string) => boolean,
  removed: { slug: string; title: string; reason: string }[]
): Node[] {
  const out: Node[] = [];
  for (const node of nodes) {
    const slug = typeof node.slug === 'string' ? node.slug : '';
    const title = typeof node.title === 'string' ? node.title.trim() : '';
    const type = typeof node.type === 'string' ? node.type : '';
    const children = Array.isArray(node.children) ? prune(node.children as Node[], hasPage, removed) : undefined;

    if (type === 'category') {
      // A category whose children have all gone is an empty heading. Keep one that never had children:
      // an intentionally empty section is a choice, an emptied one is debris.
      const hadChildren = Array.isArray(node.children) && node.children.length > 0;
      if (hadChildren && (!children || children.length === 0)) {
        removed.push({ slug, title, reason: 'category left empty after pruning' });
        continue;
      }
      out.push({ ...node, ...(children ? { children } : {}) } as Node);
      continue;
    }

    if (PAGE_TYPES.has(type) && slug && !hasPage(slug)) {
      removed.push({ slug, title, reason: 'no page exists at this slug' });
      continue;
    }

    // Anything else — plugin nodes, unknown types — is left alone. This prunes what it can prove is
    // orphaned, not everything it does not recognise.
    out.push({ ...node, ...(children ? { children } : {}) } as Node);
  }
  return out;
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Rewrites navigation for everyone who visits, so it is an admin action.
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let apply = false;
  try {
    const body = (await request.json()) as { apply?: boolean };
    apply = body?.apply === true;
  } catch {
    /* no body means dry run, which is the safe default */
  }

  const [tree, pages] = await Promise.all([getRegistryNavigation(), listHandoffPages()]);
  if (!tree) return NextResponse.json({ error: 'No navigation tree stored.' }, { status: 404 });

  const slugs = new Set(pages.map((p) => String(p.slug).replace(/^\/+|\/+$/g, '')));
  const hasPage = (slug: string) => slugs.has(slug.replace(/^\/+|\/+$/g, ''));

  const removed: { slug: string; title: string; reason: string }[] = [];
  const pruned = prune(tree as Node[], hasPage, removed);

  if (!removed.length) {
    return NextResponse.json({ ok: true, applied: false, removed: [], message: 'Nothing orphaned — navigation matches the pages that exist.' });
  }

  if (!apply) {
    return NextResponse.json({
      ok: true,
      applied: false,
      removed,
      message: `Would remove ${removed.length} entr${removed.length === 1 ? 'y' : 'ies'}. Re-send with {"apply":true} to commit.`,
    });
  }

  await upsertRegistryNavigation(pruned as NavigationNode[], session.user.id);
  const { revalidateRegistryNavigation } = await import('@/lib/server/registry-cache');
  revalidateRegistryNavigation();

  return NextResponse.json({ ok: true, applied: true, removed, remainingTopLevel: pruned.length });
}
