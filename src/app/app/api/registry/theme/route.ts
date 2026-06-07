import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { getRegistryTheme, upsertRegistryTheme } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/registry/theme — returns metadata about the current theme (length + updatedAt).
 * Does NOT return the CSS body — use /api/registry/theme.css for that.
 */
export async function GET(): Promise<Response> {
  try {
    const row = await getRegistryTheme();
    return NextResponse.json({
      length: row?.css.length ?? 0,
      updatedAt: row?.updatedAt?.toISOString() ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * POST /api/registry/theme — replaces the singleton theme CSS.
 * Requires sync:write. Body shape:
 *   { css: "..." } — raw compiled CSS bytes
 */
export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: { css?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.css !== 'string') {
    return NextResponse.json({ error: 'Expected { css: "..." } string body' }, { status: 400 });
  }

  try {
    await upsertRegistryTheme(body.css, authz.userId);
    return NextResponse.json({ ok: true, length: body.css.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
