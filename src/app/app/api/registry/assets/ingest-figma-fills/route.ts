import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { ingestFigmaFillAsset } from '@/lib/db/queries';

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
 * POST /api/registry/assets/ingest-figma-fills
 *
 * Ingest a single Figma image fill as a library asset. Unlike the component
 * image ingest endpoint, these assets belong to the library file rather than
 * any specific component, so no componentId is required.
 *
 * Body: {
 *   assetId: string       — content-addressed: `img_<sha256[:12]>`
 *   filename: string      — sanitized filename written during `handoff-app fetch`
 *   contentHash: string   — sha256 hex (first 12 chars, matches assetId suffix)
 *   mimeType: string      — image/* MIME type
 *   dataBase64: string    — base64-encoded image bytes
 *   figmaFileKey: string  — Figma file key the image fill came from
 *   figmaImageRef: string — Figma imageRef hash identifying the fill
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
  const figmaFileKey = typeof body.figmaFileKey === 'string' ? body.figmaFileKey.trim() : '';
  const figmaImageRef = typeof body.figmaImageRef === 'string' ? body.figmaImageRef.trim() : '';

  if (!assetId || !filename || !contentHash || !mimeType || !dataBase64 || !figmaFileKey || !figmaImageRef) {
    return NextResponse.json(
      { error: 'Missing required fields: assetId, filename, contentHash, mimeType, dataBase64, figmaFileKey, figmaImageRef' },
      { status: 400 },
    );
  }
  if (!ALLOWED_MIME.has(mimeType)) {
    return NextResponse.json({ error: `Unsupported image type: ${mimeType}` }, { status: 400 });
  }

  try {
    await ingestFigmaFillAsset({
      assetId,
      filename,
      mimeType,
      contentHash,
      dataBase64,
      figmaFileKey,
      figmaImageRef,
      userId: authz.userId,
    });
    return NextResponse.json({ ok: true, assetId });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Ingest failed' },
      { status: 500 },
    );
  }
}
