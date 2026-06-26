import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import {
  getComponentArtifactByComponentAndFilename,
  getComponentArtifactByFilename,
  isBinaryContentType,
} from '@/lib/db/component-artifact-queries';
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

// Iframe-content hardening (roadmap §14). The preview iframe runs in an opaque
// origin (`sandbox="allow-scripts"`, no `allow-same-origin`) so it can't reach
// the registry's cookies/auth. Two consequences handled here, at the single
// serving choke point (so existing components need no rebuild):
//  - module `import()` + cross-origin script/style loads from an opaque origin
//    require CORS — these artifacts are public, non-credentialed, so ACAO:* is safe.
//  - the parent can no longer read the frame's document for auto-height, so we
//    inject a ResizeObserver→postMessage height reporter into served HTML, and a
//    CSP that blocks network exfiltration (connect-src 'none') + foreign framing.
const HEIGHT_REPORTER =
  `<script>(function(){function h(){var b=document.body,e=document.documentElement;` +
  `var v=Math.max(b?b.scrollHeight:0,b?b.offsetHeight:0,e?e.scrollHeight:0,e?e.offsetHeight:0);` +
  `try{parent.postMessage({type:'handoff-preview-height',height:v},'*');}catch(_){}}` +
  `try{if(window.ResizeObserver&&document.body){new ResizeObserver(h).observe(document.body);}}catch(_){}` +
  `window.addEventListener('load',h);window.addEventListener('resize',h);` +
  `setTimeout(h,100);setTimeout(h,500);})();</script>`;

const PREVIEW_CSP = "connect-src 'none'; frame-ancestors 'self'";

function injectHeightReporter(html: string): string {
  return html.includes('</body>') ? html.replace('</body>', `${HEIGHT_REPORTER}</body>`) : html + HEIGHT_REPORTER;
}

function headersFor(filename: string, contentType: string): Record<string, string> {
  const ext = path.extname(filename).toLowerCase();
  const headers: Record<string, string> = { 'Content-Type': contentType, 'Cache-Control': CACHE };
  if (ext === '.js' || ext === '.mjs' || ext === '.css') headers['Access-Control-Allow-Origin'] = '*';
  if (ext === '.html') headers['Content-Security-Policy'] = PREVIEW_CSP;
  return headers;
}

function isHtml(filename: string): boolean {
  return path.extname(filename).toLowerCase() === '.html';
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

  // Registry mode: serve from Postgres.
  // Lookup strategy mirrors the workspace-mode disk lookup below:
  //   - 1 segment  → shared global file, query by basename
  //   - 2+ segs   → first is component id, rest is the basename — query by
  //                 (componentId, basename). Falls back to a flat-filename
  //                 query so URLs like /api/component/video-generic.html
  //                 keep working unchanged.
  // Without the (componentId, basename) path, files pushed under a generic
  // basename (e.g. `screenshot.png` for many components) are unreachable.
  if (process.env.DATABASE_URL?.trim()) {
    let row: { content: string; contentType: string } | null = null;
    if (segments.length >= 2) {
      const [componentId, ...rest] = segments;
      const basename = rest.join('/');
      row = await getComponentArtifactByComponentAndFilename(componentId, basename);
    }
    if (!row) {
      row = await getComponentArtifactByFilename(filename);
    }
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (isBinaryContentType(row.contentType)) {
      const buf = Buffer.from(row.content, 'base64');
      return new NextResponse(buf, { headers: headersFor(filename, row.contentType) });
    }
    const body = isHtml(filename) ? injectHeightReporter(row.content) : row.content;
    return new NextResponse(body, { headers: headersFor(filename, row.contentType) });
  }

  // Workspace mode: serve from disk.
  // getPublicApiComponentDir() and getComponentDistDir() both fall back to HANDOFF_WORKING_PATH
  // when the primary cwd-based path doesn't exist, so no per-call fallback logic is needed here.
  let diskPath: string;
  if (segments.length === 1) {
    diskPath = path.join(getPublicApiComponentDir(), segments[0]);
  } else {
    const [componentId, ...rest] = segments;
    diskPath = path.join(getComponentDistDir(componentId), rest.join('/'));
  }

  try {
    const buf = await fs.readFile(diskPath);
    const contentType = contentTypeForFile(filename);
    if (isHtml(filename)) {
      return new NextResponse(injectHeightReporter(buf.toString('utf-8')), { headers: headersFor(filename, contentType) });
    }
    return new NextResponse(buf, { headers: headersFor(filename, contentType) });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
