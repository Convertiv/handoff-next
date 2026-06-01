import { NextResponse, type NextRequest } from 'next/server';
import { getComponentArtifactByFilename, isBinaryContentType } from '@/lib/db/component-artifact-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE = 'public, max-age=60';

/** Serve synced component artifacts from Postgres. Disk artifacts use `public/api/component` static files. */
export async function GET(_request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const segments = (await context.params).path ?? [];
  const filename = segments.map((s) => s.replace(/\\/g, '/')).join('/');
  if (!filename || filename.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const row = await getComponentArtifactByFilename(filename);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (isBinaryContentType(row.contentType)) {
    const buf = Buffer.from(row.content, 'base64');
    return new NextResponse(buf, {
      headers: { 'Content-Type': row.contentType, 'Cache-Control': CACHE },
    });
  }

  return new NextResponse(row.content, {
    headers: { 'Content-Type': row.contentType, 'Cache-Control': CACHE },
  });
}
