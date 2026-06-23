import { NextResponse } from 'next/server';
import { getRegistryTheme, getRegistryAppearance } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/registry/theme.css — serves the workspace-pushed theme CSS followed
 * by the appearance-override CSS (set via /account/appearance).
 * Root layout includes this via <link rel="stylesheet" href="/api/registry/theme.css">.
 *
 * On a fresh registry, returns an empty stylesheet so the page still renders.
 */
export async function GET(): Promise<Response> {
  try {
    const [themeRow, appearanceRow] = await Promise.all([getRegistryTheme(), getRegistryAppearance()]);
    const parts = [themeRow?.css ?? '', appearanceRow?.css ?? ''].filter(Boolean);
    const css = parts.join('\n\n');
    const lastModified = themeRow?.updatedAt ?? appearanceRow?.updatedAt ?? null;
    return new NextResponse(css, {
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=60, must-revalidate',
        ...(lastModified ? { 'Last-Modified': lastModified.toUTCString() } : {}),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return new NextResponse(`/* handoff: theme unavailable — ${msg} */`, {
      status: 200,
      headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
