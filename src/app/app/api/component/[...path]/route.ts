import { readFile } from 'node:fs/promises';
import { NextResponse, type NextRequest } from 'next/server';
import { getComponentArtifactByFilename, isBinaryContentType } from '@/lib/db/component-artifact-queries';
import {
  contentTypeForComponentArtifact,
  getComponentArtifactDiskDir,
  isBinaryArtifactFilename,
  resolveComponentArtifactDiskPath,
} from '@/lib/server/component-artifact-serve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE = 'public, max-age=60';

async function readDiskArtifact(filename: string): Promise<{ body: Buffer | string; contentType: string } | null> {
  const baseDir = getComponentArtifactDiskDir();
  if (!baseDir) return null;

  const diskPath = resolveComponentArtifactDiskPath(baseDir, filename);
  if (!diskPath) return null;

  try {
    if (isBinaryArtifactFilename(filename)) {
      const buf = await readFile(diskPath);
      return { body: buf, contentType: contentTypeForComponentArtifact(filename) };
    }
    const text = await readFile(diskPath, 'utf8');
    return { body: text, contentType: contentTypeForComponentArtifact(filename) };
  } catch {
    return null;
  }
}

/** Serve built component artifacts from disk (local dev) or Postgres (synced push). */
export async function GET(_request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const segments = (await context.params).path ?? [];
  const filename = segments.map((s) => s.replace(/\\/g, '/')).join('/');
  if (!filename || filename.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  if (process.env.DATABASE_URL?.trim()) {
    const row = await getComponentArtifactByFilename(filename);
    if (row) {
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
  }

  const disk = await readDiskArtifact(filename);
  if (disk) {
    return new NextResponse(disk.body, {
      headers: { 'Content-Type': disk.contentType, 'Cache-Control': CACHE },
    });
  }

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
