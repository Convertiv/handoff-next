import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { insertTokensSnapshot } from '@/lib/db/registry-queries';
import { getDbTokensSnapshot } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/registry/tokens — returns the latest tokens snapshot
 * (IDocumentationObject shape from handoff-core).
 */
export async function GET(): Promise<Response> {
  try {
    const snap = await getDbTokensSnapshot();
    return NextResponse.json({ payload: snap ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg, payload: null }, { status: 500 });
  }
}

/**
 * POST /api/registry/tokens — append a new tokens snapshot.
 * Requires sync:write. The handoff_tokens_snapshot table is append-only
 * (each push inserts a new row); reads return the latest by id.
 *
 * Body shape:
 *   { payload: <IDocumentationObject — colors, typography, effects, components, etc.> }
 */
export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: { payload?: unknown; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.payload || typeof body.payload !== 'object') {
    return NextResponse.json({ error: 'Expected { payload: { ... } } object body' }, { status: 400 });
  }

  try {
    await insertTokensSnapshot(body.payload, {
      userId: authz.userId,
      message: typeof body.message === 'string' ? body.message : null,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
