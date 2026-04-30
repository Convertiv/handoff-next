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

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
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

/**
 * Renders a component preview HTML page in headless Chromium and returns a PNG buffer.
 * Results are cached in-memory (LRU) by preview pathname.
 */
export async function captureComponentPreviewPng(requestOrigin: string, previewPathname: string): Promise<Buffer> {
  const cacheKey = previewPathname;
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
    await page.goto(absoluteUrl, { waitUntil: 'networkidle', timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 400));
    const buf = await page.screenshot({ type: 'png', fullPage: true });
    const buffer = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    lruSet(cacheKey, buffer);
    return buffer;
  } finally {
    await context.close();
  }
}
