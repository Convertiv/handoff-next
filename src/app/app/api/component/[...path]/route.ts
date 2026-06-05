import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { getComponentArtifactByFilename, isBinaryContentType } from '@/lib/db/component-artifact-queries';
import { getComponentDistDir, getPublicApiComponentDir } from '@/lib/server/public-api-paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE = 'public, max-age=60';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function contentTypeForFile(filename: string): string {
  return CONTENT_TYPES[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Serve component artifacts.
 * - Workspace mode (no DATABASE_URL): read from components/[id]/dist/ on disk.
 * - Registry mode (DATABASE_URL present): read from Postgres component_artifact table.
 *
 * URL shape: /api/component/[id]/[file]
 *   e.g. /api/component/button/button-default.html
 *        /api/component/button/button.css
 *        /api/component/main.css  (shared global, served from public/api/component/)
 */
export async function GET(_request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const segments = (await context.params).path ?? [];
  const filename = segments.map((s) => s.replace(/\\/g, '/')).join('/');
  if (!filename || filename.includes('..')) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // Registry mode: serve from Postgres
  if (process.env.DATABASE_URL?.trim()) {
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

  // Workspace mode: serve from disk
  // segments[0] is the component id, segments[1] is the filename
  // e.g. ['button', 'button-default.html'] or ['main.css'] (shared)
  let diskPath: string;
  if (segments.length === 1) {
    // Shared global file (main.css, main.js, shared.css)
    diskPath = path.join(getPublicApiComponentDir(), segments[0]);
  } else {
    const [componentId, ...rest] = segments;
    diskPath = path.join(getComponentDistDir(componentId), rest.join('/'));
  }

  try {
    const buf = await fs.readFile(diskPath);
    return new NextResponse(buf, {
      headers: { 'Content-Type': contentTypeForFile(filename), 'Cache-Control': CACHE },
    });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
