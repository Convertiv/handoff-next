import { NextResponse, type NextRequest } from 'next/server';
import { getAssetBlob } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/handoff/assets/<id>/raw — serve a DB-backed asset's bytes.
 *
 * Public (no auth): asset storageUrl points here when S3 is not configured, so
 * component previews and the asset library can render the image directly.
 */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  const safe = (id || '').trim();
  if (!safe) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const blob = await getAssetBlob(safe);
    if (!blob) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new Response(new Uint8Array(blob.data), {
      headers: {
        'Content-Type': blob.contentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error' }, { status: 500 });
  }
}
