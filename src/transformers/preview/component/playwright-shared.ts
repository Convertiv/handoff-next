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

  const candidates: string[] = [];

  if (pathname.startsWith('/api/component/')) {
    const rest = pathname.slice('/api/component/'.length);
    const parts = rest.split('/');
    candidates.push(path.join(workingPath, 'public', 'api', 'component', rest));
    if (parts.length >= 2) {
      const [id, ...rest2] = parts;
      candidates.push(path.join(workingPath, 'components', id, 'dist', rest2.join('/')));
    }
  } else if (pathname.startsWith('/api/')) {
    candidates.push(path.join(workingPath, 'public', pathname.slice(1)));
  } else if (pathname.startsWith('/assets/')) {
    candidates.push(path.join(workingPath, 'public', pathname.slice(1)));
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

  await route.fulfill({ status: 404, body: '' });
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
