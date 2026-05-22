import fs from 'fs-extra';
import path from 'path';
import { NextResponse, type NextRequest } from 'next/server';
import { getComponentArtifactByFilename, isBinaryContentType } from '@/lib/db/component-artifact-queries';
import { getPublicApiDir } from '@/lib/data/static-provider';

export const runtime = 'nodejs';

function resolveComponentFilePath(filename: string): string {
  return path.join(getPublicApiDir(), 'component', filename);
}

function contentTypeFromExt(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.html') return 'text/html; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.js') return 'application/javascript; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

/** Serve built component artifacts from disk (local dev) or Postgres (synced push). */
export async function GET(_request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const segments = (await context.params).path ?? [];
  const filename = segments.map((s) => s.replace(/\\/g, '/')).join('/');
  if (!filename || filename.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  const diskPath = resolveComponentFilePath(filename);
  if (await fs.pathExists(diskPath)) {
    const ext = path.extname(filename).toLowerCase();
    const isBinary = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
    if (isBinary) {
      const buf = await fs.readFile(diskPath);
      return new NextResponse(buf, {
        headers: { 'Content-Type': contentTypeFromExt(filename), 'Cache-Control': 'public, max-age=60' },
      });
    }
    const text = await fs.readFile(diskPath, 'utf8');
    return new NextResponse(text, {
      headers: { 'Content-Type': contentTypeFromExt(filename), 'Cache-Control': 'public, max-age=60' },
    });
  }

  const row = await getComponentArtifactByFilename(filename);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (isBinaryContentType(row.contentType)) {
    const buf = Buffer.from(row.content, 'base64');
    return new NextResponse(buf, {
      headers: { 'Content-Type': row.contentType, 'Cache-Control': 'public, max-age=60' },
    });
  }

  return new NextResponse(row.content, {
    headers: { 'Content-Type': row.contentType, 'Cache-Control': 'public, max-age=60' },
  });
}
