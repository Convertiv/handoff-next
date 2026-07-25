import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { backfillArtifactBlobsBatch } from '@/lib/db/queries';
import { blobEnabled } from '@/lib/storage/artifact-images';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

/**
 * Admin-only, resumable backfill: moves inline base64 images on existing design
 * artifacts out of Postgres and into Vercel Blob, one batch per call. Call
 * repeatedly, passing back the returned `nextCursor`, until `done` is true.
 * Direct writes preserve `updatedAt` (see backfillArtifactBlobsBatch).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!blobEnabled()) {
    return NextResponse.json(
      { error: 'Vercel Blob is not configured (BLOB_READ_WRITE_TOKEN unset); backfill would be a no-op.' },
      { status: 400 }
    );
  }

  let body: { limit?: unknown; cursor?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Empty/invalid body is fine — use defaults.
  }

  const rawLimit = typeof body.limit === 'number' ? Math.floor(body.limit) : DEFAULT_LIMIT;
  const limit = Math.min(Math.max(rawLimit, 1), MAX_LIMIT);
  const cursor = typeof body.cursor === 'string' && body.cursor.trim() ? body.cursor.trim() : undefined;

  try {
    const result = await backfillArtifactBlobsBatch(cursor, limit);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Backfill failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
