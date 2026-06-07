import fs from 'fs-extra';
import path from 'path';
import { chromium, type Browser, type Route } from 'playwright-core';
import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import type { TransformComponentTokensResult } from '@handoff/transformers/preview/types';
import { getAPIPath, getComponentDistPath } from './api';

const SCREENSHOT_FILENAME = 'screenshot.png';
const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;
const DEVICE_SCALE_FACTOR = 2; // retina-quality output
const SETTLE_MS = 400;
const NAV_TIMEOUT_MS = 30_000;

/** Lazy-initialized headless Chromium shared across components in a single build pass. */
let cachedBrowser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (cachedBrowser && cachedBrowser.isConnected()) return cachedBrowser;
  cachedBrowser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  return cachedBrowser;
}

/** Call at the end of a build pass to release the chromium process. */
export async function closeScreenshotBrowser(): Promise<void> {
  if (cachedBrowser && cachedBrowser.isConnected()) {
    await cachedBrowser.close().catch(() => {});
    cachedBrowser = null;
  }
}

/**
 * Find the canonical preview HTML to screenshot. Priority: 'default', 'generic',
 * then the first preview variant in the metadata. Returns null when no preview
 * HTML exists on disk yet (e.g. the component has no entries.template).
 */
function findDefaultPreviewPath(handoff: Handoff, data: TransformComponentTokensResult): string | null {
  const distDir = getComponentDistPath(handoff, data.id);
  const previewKeys = Object.keys(data.previews || {});
  if (previewKeys.length === 0) return null;

  const priorityOrder = Array.from(new Set(['default', 'generic', ...previewKeys]));
  for (const key of priorityOrder) {
    const candidate = path.join(distDir, `${data.id}-${key}.html`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
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
 * Map a request URL to a workspace file path. Mirrors the runtime
 * /api/component/[...path] route resolution so the preview renders identically
 * whether served by the dev server or by Playwright during a build.
 *
 *   /api/component/main.css        → public/api/component/main.css       (shared)
 *   /api/component/button.css      → public/api/component/button.css     (shared, legacy layout)
 *   /api/component/button/foo.html → components/button/dist/foo.html      (per-component)
 *   /assets/...                    → public/assets/...                    (fonts, icons)
 */
async function handleInterceptedRoute(route: Route, workingPath: string): Promise<void> {
  const url = new URL(route.request().url());
  const pathname = url.pathname;

  const candidates: string[] = [];

  if (pathname.startsWith('/api/component/')) {
    const rest = pathname.slice('/api/component/'.length);
    const parts = rest.split('/');
    // Shared bundles or top-level files (legacy and current)
    candidates.push(path.join(workingPath, 'public', 'api', 'component', rest));
    // Per-component dist
    if (parts.length >= 2) {
      const [id, ...rest2] = parts;
      candidates.push(path.join(workingPath, 'components', id, 'dist', rest2.join('/')));
    }
  } else if (pathname.startsWith('/api/')) {
    candidates.push(path.join(workingPath, 'public', pathname.slice(1)));
  } else if (pathname.startsWith('/assets/')) {
    candidates.push(path.join(workingPath, 'public', pathname.slice(1)));
    // Handoff bundles a default preview.css under /assets/css/preview.css —
    // ship from the handoff-app module path if not in the workspace
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

  // Not found — fulfill with 404 so the page doesn't hang on a missing asset.
  await route.fulfill({ status: 404, body: '' });
}

export type ScreenshotResult =
  | { ok: true; path: string }
  | { ok: false; reason: string };

/**
 * Render the component's default preview HTML in headless Chromium and write
 * `screenshot.png` to its dist/ directory. The PNG ships as part of the
 * regular artifact bundle on push — no extra endpoint needed (the existing
 * /api/component/[...path] route serves it).
 *
 * Safe to call repeatedly; relies on the upstream build cache to decide when
 * to regenerate (i.e. only called when buildPlan.previews is true).
 *
 * If Playwright fails (Chromium missing, sandbox issues, etc.), returns
 * `{ ok: false, reason }` and the caller logs/continues. The component just
 * ships without a screenshot.
 */
export async function generateComponentScreenshot(
  handoff: Handoff,
  data: TransformComponentTokensResult
): Promise<ScreenshotResult> {
  const previewPath = findDefaultPreviewPath(handoff, data);
  if (!previewPath) {
    return { ok: false, reason: 'no preview HTML on disk yet' };
  }

  const outputPath = path.join(getComponentDistPath(handoff, data.id), SCREENSHOT_FILENAME);

  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      reason: `chromium launch failed (${msg}). Run \`npx playwright install chromium\` once if you haven't.`,
    };
  }

  const context = await browser.newContext({
    viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
  });

  // Intercept all requests so /api/component/* and /assets/* resolve from the
  // local workspace filesystem — no HTTP server needed.
  await context.route('**/*', (route) => handleInterceptedRoute(route, handoff.workingPath));

  const page = await context.newPage();
  try {
    const fileUrl = `file://${previewPath}`;
    await page.goto(fileUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    // Small settle delay so web fonts and any JS-driven layout finish.
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    await page.screenshot({ path: outputPath, type: 'png', fullPage: false });
    return { ok: true, path: outputPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `screenshot failed: ${msg}` };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Returns the public URL where the screenshot will be served from after push. */
export function screenshotUrlFor(componentId: string): string {
  const base = process.env.HANDOFF_APP_BASE_PATH ?? '';
  return `${base}/api/component/${componentId}/${SCREENSHOT_FILENAME}`;
}

/** Suppress warning about getAPIPath being unused if module isn't called yet — defensive import */
void getAPIPath;
