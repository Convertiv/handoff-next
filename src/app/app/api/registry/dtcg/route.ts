import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { getRegistryDtcg, insertTokensSnapshot, upsertRegistryDtcg } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/registry/dtcg — returns the latest DTCG dist payload.
 * Shape: { payload: { manifest, css, scss, tailwind, dtcg } | null }
 */
export async function GET(): Promise<Response> {
  try {
    const payload = await getRegistryDtcg();
    return NextResponse.json({ payload: payload ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg, payload: null }, { status: 500 });
  }
}

/**
 * POST /api/registry/dtcg — upsert the DTCG singleton row.
 * Requires sync:write. Accepts the compiled output of tokens:build.
 *
 * Body shape:
 *   {
 *     manifest: { project, generatedAt, sources, counts },
 *     css:      string  — full tokens.css content
 *     scss:     string  — full _tokens.scss content
 *     tailwind: string  — full tailwind/theme.css content
 *     dtcg:     object  — tokens.resolved.json parsed object
 *   }
 */
export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: {
    manifest?: unknown;
    css?: unknown;
    scss?: unknown;
    tailwind?: unknown;
    dtcg?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.manifest || typeof body.manifest !== 'object') {
    return NextResponse.json({ error: 'Expected { manifest: { ... } } in body' }, { status: 400 });
  }
  if (typeof body.css !== 'string' || typeof body.scss !== 'string' || typeof body.tailwind !== 'string') {
    return NextResponse.json({ error: 'Expected css, scss, tailwind as strings in body' }, { status: 400 });
  }
  if (!body.dtcg || typeof body.dtcg !== 'object') {
    return NextResponse.json({ error: 'Expected dtcg as object in body' }, { status: 400 });
  }

  try {
    await upsertRegistryDtcg({
      manifest: body.manifest as Record<string, unknown>,
      css: body.css,
      scss: body.scss,
      tailwind: body.tailwind,
      dtcg: body.dtcg as Record<string, unknown>,
    });
    await insertTokensSnapshot(body.dtcg, 'push');
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
