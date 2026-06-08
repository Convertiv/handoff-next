import fs from 'fs-extra';
import path from 'path';
import type Handoff from '@handoff/index';
import type { TransformComponentTokensResult } from '@handoff/transformers/preview/types';
import { getAPIPath, getComponentDistPath } from './api';
import { closeSharedBrowser, getSharedBrowser, handleInterceptedRoute } from './playwright-shared';

const SCREENSHOT_FILENAME = 'screenshot.png';
const VIEWPORT_WIDTH = 1200;
const VIEWPORT_HEIGHT = 800;
const DEVICE_SCALE_FACTOR = 2;
const SETTLE_MS = 400;
const NAV_TIMEOUT_MS = 30_000;

/** Backwards-compatible export — delegates to the shared browser closer. */
export async function closeScreenshotBrowser(): Promise<void> {
  await closeSharedBrowser();
}

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

export type ScreenshotResult = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Render the component's default preview HTML in headless Chromium and write
 * `screenshot.png` to its dist/ directory. Uses the shared browser process so
 * cost is amortized across components and validators in the same build pass.
 */
export async function generateComponentScreenshot(
  handoff: Handoff,
  data: TransformComponentTokensResult
): Promise<ScreenshotResult> {
  const previewPath = findDefaultPreviewPath(handoff, data);
  if (!previewPath) return { ok: false, reason: 'no preview HTML on disk yet' };

  const outputPath = path.join(getComponentDistPath(handoff, data.id), SCREENSHOT_FILENAME);

  let browser;
  try {
    browser = await getSharedBrowser();
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
  await context.route('**/*', (route) => handleInterceptedRoute(route, handoff.workingPath));

  const page = await context.newPage();
  try {
    await page.goto(`file://${previewPath}`, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
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

export function screenshotUrlFor(componentId: string): string {
  const base = process.env.HANDOFF_APP_BASE_PATH ?? '';
  return `${base}/api/component/${componentId}/${SCREENSHOT_FILENAME}`;
}

/** Returns the absolute disk path where the screenshot would live for a
 *  component, regardless of whether it currently exists. */
export function screenshotDiskPathFor(handoff: Handoff, componentId: string): string {
  return path.join(getComponentDistPath(handoff, componentId), SCREENSHOT_FILENAME);
}

/** True when the screenshot.png already exists on disk for this component. */
export function screenshotExists(handoff: Handoff, componentId: string): boolean {
  return fs.existsSync(screenshotDiskPathFor(handoff, componentId));
}

void getAPIPath;
