import 'server-only';

import { chromium, type Browser } from 'playwright-core';
import { handoffBasePath } from '@/lib/api-path';

const LRU_MAX = 32;
const lru = new Map<string, Buffer>();

function lruGet(key: string): Buffer | undefined {
  const v = lru.get(key);
  if (!v) return undefined;
  lru.delete(key);
  lru.set(key, v);
  return v;
}

function lruSet(key: string, buf: Buffer): void {
  lru.delete(key);
  lru.set(key, buf);
  while (lru.size > LRU_MAX) {
    const first = lru.keys().next().value as string | undefined;
    if (first) lru.delete(first);
  }
}

let browserPromise: Promise<Browser> | null = null;

const BROWSER_LAUNCH_TIMEOUT_MS = 30_000;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = Promise.race([
      chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Chromium launch timed out')), BROWSER_LAUNCH_TIMEOUT_MS)
      ),
    ]).catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

/** Allowed pathname prefix for component preview HTML (includes app basePath when set). */
export function componentPreviewPathPrefix(): string {
  const base = handoffBasePath();
  return base ? `${base}/api/component/` : '/api/component/';
}

/**
 * Validates and normalizes the `url` query value to a pathname the server may load
 * (must be under /api/component/ or {basePath}/api/component/).
 */
export function sanitizeComponentPreviewPath(raw: string): string | null {
  let decoded = raw.trim();
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    return null;
  }
  if (!decoded.startsWith('/')) return null;
  const prefix = componentPreviewPathPrefix();
  if (!decoded.startsWith(prefix)) return null;
  const rest = decoded.slice(prefix.length);
  if (!/^[\w.-]+\.html$/i.test(rest)) return null;
  return decoded;
}

export function originFromRequestHeaders(headers: Headers): string {
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  if (!host) {
    const port = process.env.PORT || '3000';
    return `http://127.0.0.1:${port}`;
  }
  const rawProto = headers.get('x-forwarded-proto');
  const proto = rawProto?.split(',')[0]?.trim() || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  return `${proto}://${host}`;
}

/** Origin for server-side Playwright when there is no incoming request (background jobs). */
export function internalHandoffServerOrigin(): string {
  const explicit = process.env.HANDOFF_APP_INTERNAL_ORIGIN?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  return `http://127.0.0.1:${process.env.PORT || '3000'}`;
}

/**
 * Renders a component preview HTML page in headless Chromium and returns a PNG buffer.
 * Results are cached in-memory (LRU) by preview pathname.
 */
export async function captureComponentPreviewPng(
  requestOrigin: string,
  previewPathname: string,
  opts?: { cacheKeySuffix?: string }
): Promise<Buffer> {
  const cacheKey = `${previewPathname}${opts?.cacheKeySuffix ?? ''}`;
  const hit = lruGet(cacheKey);
  if (hit) return hit;

  const absoluteUrl = `${requestOrigin}${previewPathname}`;
  const browser = await getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  try {
    // `load` avoids dev/HMR pages that never reach `networkidle`; static previews still paint after load.
    await page.goto(absoluteUrl, { waitUntil: 'load', timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 400));
    const buf = await page.screenshot({ type: 'png', fullPage: true });
    const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    lruSet(cacheKey, buffer);
    return buffer;
  } finally {
    await context.close();
  }
}
