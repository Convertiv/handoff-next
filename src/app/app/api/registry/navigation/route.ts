import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { getRegistryNavigation, upsertRegistryNavigation, type NavigationNode } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/registry/navigation — returns the navigation tree.
 * Public read so the client can fetch nav for renders.
 */
export async function GET(): Promise<Response> {
  try {
    const tree = await getRegistryNavigation();
    return NextResponse.json({ tree: tree ?? [] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg, tree: [] }, { status: 500 });
  }
}

/**
 * POST /api/registry/navigation — replaces the navigation tree.
 * Requires sync:write. Body shape:
 *   { tree: [{ slug, title, type, children: [...] }, ...] }
 *
 * `type` per ADR-001 §7: 'markdown' | 'mdx' | 'html' | 'plugin' | 'category'
 */
export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: { tree?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!Array.isArray(body.tree)) {
    return NextResponse.json({ error: 'Expected { tree: [...] } array body' }, { status: 400 });
  }

  try {
    await upsertRegistryNavigation(body.tree as NavigationNode[], authz.userId);
    return NextResponse.json({ ok: true, nodes: body.tree.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
