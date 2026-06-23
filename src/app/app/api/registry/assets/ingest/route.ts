import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { ingestReferencedImageAsset } from '@/lib/db/queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/avif',
]);

/**
 * POST /api/registry/assets/ingest
 *
 * Ingest a single component-referenced image as a library asset. Sent one image
 * per request (rather than bundled with the component payload) so each request
 * stays well under Vercel's 4.5MB body limit regardless of image size.
 *
 * Body: {
 *   assetId: string       — content-addressed: `img_<sha256[:12]>`
 *   filename: string      — original basename (used as asset title)
 *   contentHash: string   — sha256 hex (first 12 chars, matches assetId suffix)
 *   mimeType: string      — image/* MIME type
 *   dataBase64: string    — base64-encoded image bytes
 *   componentId: string   — which component references this image
 *   refs: string[]        — original reference strings (usage notes)
 * }
 */
export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const assetId = typeof body.assetId === 'string' ? body.assetId.trim() : '';
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const contentHash = typeof body.contentHash === 'string' ? body.contentHash.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim() : '';
  const dataBase64 = typeof body.dataBase64 === 'string' ? body.dataBase64 : '';
  const componentId = typeof body.componentId === 'string' ? body.componentId.trim() : '';
  const refs = Array.isArray(body.refs) ? (body.refs as string[]).filter((r) => typeof r === 'string') : [];

  if (!assetId || !filename || !contentHash || !mimeType || !dataBase64 || !componentId) {
    return NextResponse.json(
      { error: 'Missing required fields: assetId, filename, contentHash, mimeType, dataBase64, componentId' },
      { status: 400 }
    );
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ error: `Unsupported image type: ${mimeType}` }, { status: 400 });
  }

  try {
    await ingestReferencedImageAsset({
      assetId,
      filename,
      mimeType,
      contentHash,
      dataBase64,
      componentId,
      refs,
      userId: authz.userId,
    });
    return NextResponse.json({ ok: true, assetId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Ingest failed' },
      { status: 500 }
    );
  }
}
