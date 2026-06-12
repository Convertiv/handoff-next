import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { bulkUpsertHandoffPages, listHandoffPages } from '@/lib/server/doc-pages';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/registry/pages — returns all pages as a summary list.
 * Public read so workspace pull can enumerate pages to sync locally.
 */
export async function GET(): Promise<Response> {
  try {
    const pages = await listHandoffPages();
    return NextResponse.json({ pages });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg, pages: [] }, { status: 500 });
  }
}

/**
 * POST /api/registry/pages — bulk upsert pages from a workspace push.
 * Requires sync:write.
 *
 * Body shape:
 *   { pages: [{ slug, frontmatter, markdown }, ...] }
 *
 * Nav is NOT synced here — the workspace manages `handoff_registry_navigation`
 * separately via its own navigation push step which includes the correct tree shape.
 */
export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: { pages?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!Array.isArray(body.pages)) {
    return NextResponse.json({ error: 'Expected { pages: [...] } array body' }, { status: 400 });
  }

  const pages = (body.pages as Array<{ slug?: unknown; frontmatter?: unknown; markdown?: unknown }>)
    .filter((p) => typeof p.slug === 'string' && p.slug.trim())
    .map((p) => ({
      slug: String(p.slug).trim(),
      frontmatter: (p.frontmatter && typeof p.frontmatter === 'object' ? p.frontmatter : {}) as Record<string, unknown>,
      markdown: String(p.markdown ?? ''),
    }));

  try {
    const count = await bulkUpsertHandoffPages(pages);
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
