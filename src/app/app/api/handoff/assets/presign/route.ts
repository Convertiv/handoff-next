import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { buildAssetKey, generatePresignedUploadUrl, isS3Configured } from '@/lib/server/s3-assets';
import { randomUUID } from 'crypto';
import path from 'path';

type Body = {
  filename?: string;
  mimeType?: string;
  ttlSecs?: number;
};

const ALLOWED_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'image/svg+xml', 'image/avif',
  'video/mp4', 'video/webm',
]);

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isS3Configured()) {
    return NextResponse.json({ error: 'S3 is not configured' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const filename = String(body.filename ?? '').trim();
  const mimeType = String(body.mimeType ?? '').trim();

  if (!filename || !mimeType) {
    return NextResponse.json({ error: 'filename and mimeType are required' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ error: 'mimeType not allowed' }, { status: 400 });
  }

  const assetId = randomUUID();
  const ext = path.extname(filename).toLowerCase() || '';
  const key = buildAssetKey(assetId, ext ? `file${ext}` : filename);

  const result = await generatePresignedUploadUrl(key, mimeType, body.ttlSecs ?? 300);
  return NextResponse.json({ assetId, ...result });
}
