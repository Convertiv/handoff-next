import { NextResponse } from 'next/server';
import { getRegistryTheme } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/registry/theme.css — serves the pushed theme CSS bytes verbatim
 * with appropriate cache headers. Root layout includes this via
 * <link rel="stylesheet" href="/api/registry/theme.css">.
 *
 * On a fresh registry with no theme pushed yet, returns an empty stylesheet
 * (200 with empty body) so the layout doesn't 404. Browsers happily render
 * with no extra theme — the default Handoff styles still apply.
 */
export async function GET(): Promise<Response> {
  try {
    const row = await getRegistryTheme();
    const css = row?.css ?? '';
    // Conservative cache: 60s public, allow revalidate. Theme pushes are infrequent
    // but when they happen we want changes visible within ~a minute, not hours.
    return new NextResponse(css, {
      headers: {
        'Content-Type': 'text/css; charset=utf-8',
        'Cache-Control': 'public, max-age=60, must-revalidate',
        ...(row?.updatedAt ? { 'Last-Modified': row.updatedAt.toUTCString() } : {}),
      },
    });
  } catch (e) {
    // If the table doesn't exist yet (pre-migration) or DB is down, serve an
    // empty stylesheet so the page still renders. The 500 would block the layout.
    const msg = e instanceof Error ? e.message : 'Error';
    return new NextResponse(`/* handoff: theme unavailable — ${msg} */`, {
      status: 200,
      headers: { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}
