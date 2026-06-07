import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { getRegistryConfig, upsertRegistryConfig } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/registry/config — returns the current registry config (Config['app'] shape).
 * Public read (no auth) so the client bundle can fetch it for runtime branding.
 */
export async function GET(): Promise<Response> {
  try {
    const data = await getRegistryConfig();
    return NextResponse.json({ data: data ?? {} });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg, data: {} }, { status: 500 });
  }
}

/**
 * POST /api/registry/config — replaces the singleton config row.
 * Requires sync:write (CLI JWT or HANDOFF_SYNC_SECRET). Body shape:
 *   { data: { title: string, client: string, breakpoints: {...}, ... } }
 */
export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: { data?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    return NextResponse.json({ error: 'Expected { data: { ... } }' }, { status: 400 });
  }

  try {
    await upsertRegistryConfig(body.data as Record<string, unknown>, authz.userId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
