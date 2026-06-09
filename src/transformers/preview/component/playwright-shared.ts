/**
 * Shared headless-Chromium plumbing used by the screenshot generator and the
 * browser-based validators (axe, contrast). Centralized so all preview-rendering
 * work shares ONE chromium process per build pass — launches are ~500ms each
 * and we'd otherwise pay that cost per validator.
 *
 * The route interceptor mirrors the runtime /api/component/[...path] route so a
 * preview HTML loaded via file:// resolves its assets the same way it would
 * served by the dev server.
 */

import fs from 'fs-extra';
import path from 'path';
import { chromium, type Browser, type Route, type BrowserContext, type Page } from 'playwright-core';

const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;
const DEVICE_SCALE_FACTOR = 2;
const NAV_TIMEOUT_MS = 30_000;
const SETTLE_MS = 400;

let cachedBrowser: Browser | null = null;

/** Lazy-init the shared chromium process. Returns the same instance across
 *  all callers in this build pass. */
export async function getSharedBrowser(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.isConnected()) return cachedBrowser;
  cachedBrowser = await chromium.launch({
    headless: true,
    timeout: 30_000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return cachedBrowser;
}

/** Close the shared chromium. Call once at end of build pass. Idempotent. */
export async function closeSharedBrowser(): Promise<void> {
  if (cachedBrowser && cachedBrowser.isConnected()) {
    await cachedBrowser.close().catch(() => {});
    cachedBrowser = null;
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function mimeForExt(ext: string): string {
  return MIME_TYPES[ext.toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Resolve a browser request URL against the workspace filesystem. Mirrors the
 * runtime /api/component/[...path] route resolution so preview rendering is
 * identical between dev server and headless build.
 *
 *   /api/component/main.css         → public/api/component/main.css
 *   /api/component/button/foo.html  → components/button/dist/foo.html
 *   /assets/...                     → public/assets/...
 */
export async function handleInterceptedRoute(route: Route, workingPath: string): Promise<void> {
  const url = new URL(route.request().url());
  const pathname = url.pathname;

  // file:// requests pointing at an actual disk file (typically the initial
  // navigation to the preview HTML) must be allowed to load — `route.continue()`
  // hands the request back to Playwright which fetches from disk. Without
  // this we 404 the navigation itself, the page never loads, and the
  // resulting screenshot is a blank white frame.
  if (url.protocol === 'file:') {
    try {
      if (await fs.pathExists(pathname)) {
        const stat = await fs.stat(pathname);
        if (stat.isFile()) {
          await route.continue();
          return;
        }
      }
    } catch {
      // fall through to the interception logic below
    }
  }

  const candidates: string[] = [];
  // When the obvious paths miss for a CSS or JS file inside a known
  // `components/<id>/dist/` directory, fall back to the first matching-ext
  // file there. Reason: handoff templates emit `<link href="/api/component/
  // <id>.css">` but project vite configs often output the bundle under a
  // project-wide name (e.g. ssc-handoff.css). Without this fallback the
  // route 404s and the screenshot lands as a blank white image.
  const distDirsToScan: string[] = [];

  if (pathname.startsWith('/api/component/')) {
    const rest = pathname.slice('/api/component/'.length);
    const parts = rest.split('/');
    candidates.push(path.join(workingPath, 'public', 'api', 'component', rest));
    if (parts.length >= 2) {
      const [id, ...rest2] = parts;
      candidates.push(path.join(workingPath, 'components', id, 'dist', rest2.join('/')));
      distDirsToScan.push(path.join(workingPath, 'components', id, 'dist'));
    } else if (parts.length === 1) {
      // Single segment like `video.css` — derive the id from the basename
      // stem and search components/<stem>/dist/.
      const stem = parts[0].split('.')[0];
      candidates.push(path.join(workingPath, 'components', stem, 'dist', parts[0]));
      distDirsToScan.push(path.join(workingPath, 'components', stem, 'dist'));
    }
  } else if (pathname.startsWith('/api/')) {
    candidates.push(path.join(workingPath, 'public', pathname.slice(1)));
  } else if (pathname.startsWith('/assets/')) {
    candidates.push(path.join(workingPath, 'public', pathname.slice(1)));
    // Handoff ships a default preview.css under the module's src/app/public/.
    // We can't `require.resolve` from a transform-time module reliably here
    // because the build output path differs from source path. Resolve from
    // this file's own location instead. See screenshot pipeline doc for why.
    const moduleAssetCandidate = resolveModulePublicAsset(pathname);
    if (moduleAssetCandidate) candidates.push(moduleAssetCandidate);
  } else if (pathname.startsWith('/')) {
    candidates.push(path.join(workingPath, 'public', pathname.slice(1)));
  }

  for (const c of candidates) {
    try {
      if (await fs.pathExists(c)) {
        const stat = await fs.stat(c);
        if (stat.isFile()) {
          const body = await fs.readFile(c);
          await route.fulfill({
            status: 200,
            contentType: mimeForExt(path.extname(c)),
            body,
          });
          return;
        }
      }
    } catch {
      // continue
    }
  }

  // Last-resort fallback for CSS/JS: pick any matching-extension file in the
  // component's dist directory. Projects whose vite config renames the
  // per-component bundle (project-wide name like ssc-handoff.css) would
  // otherwise render unstyled previews.
  const ext = path.extname(pathname).toLowerCase();
  if ((ext === '.css' || ext === '.js') && distDirsToScan.length > 0) {
    for (const dir of distDirsToScan) {
      try {
        if (!(await fs.pathExists(dir))) continue;
        const entries = await fs.readdir(dir);
        const match = entries.find((e) => path.extname(e).toLowerCase() === ext);
        if (match) {
          const body = await fs.readFile(path.join(dir, match));
          await route.fulfill({ status: 200, contentType: mimeForExt(ext), body });
          return;
        }
      } catch {
        // continue
      }
    }
  }

  await route.fulfill({ status: 404, body: '' });
}

/**
 * Resolve `/assets/...` to the handoff-app module's bundled public/ tree.
 * Returns null if nothing matches. Uses import.meta to find the module root
 * regardless of whether we're running from source or dist.
 */
function resolveModulePublicAsset(pathname: string): string | null {
  try {
    // playwright-shared lives at <root>/(src|dist)/transformers/preview/component/
    // → 4 levels up brings us to the module root either way.
    const here = path.dirname(new URL(import.meta.url).pathname);
    const moduleRoot = path.resolve(here, '..', '..', '..', '..');
    return path.join(moduleRoot, 'src', 'app', 'public', pathname.replace(/^\/+/, ''));
  } catch {
    return null;
  }
}

export interface OpenPreviewOptions {
  workingPath: string;
  previewPath: string;
  viewport?: { width: number; height: number };
}

/**
 * Open a preview HTML in a fresh BrowserContext + Page, with route interception
 * wired and the page settled (load + small font-settle delay). Caller MUST close
 * the returned context when done.
 *
 * Returns null when chromium fails to launch — caller decides whether that's
 * fatal or a soft-skip.
 */
export async function openPreviewPage(opts: OpenPreviewOptions): Promise<
  | { page: Page; context: BrowserContext; close: () => Promise<void> }
  | { error: string }
> {
  let browser: Browser;
  try {
    browser = await getSharedBrowser();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `chromium launch failed (${msg}). Run \`npx playwright install chromium\` once if you haven't.` };
  }

  const context = await browser.newContext({
    viewport: opts.viewport ?? { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });
  await context.route('**/*', (route) => handleInterceptedRoute(route, opts.workingPath));

  const page = await context.newPage();
  try {
    await page.goto(`file://${opts.previewPath}`, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  } catch (err) {
    await context.close().catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `failed to load preview: ${msg}` };
  }

  return {
    page,
    context,
    close: async () => {
      await context.close().catch(() => {});
    },
  };
}
