import { NextResponse } from 'next/server';
import { usePostgres } from '@/lib/db/dialect';

/**
 * GET /api/handoff/components/history/version?id=<componentId>&v=<versionNumber>
 *
 * Returns the FULL snapshot for a single version (incl. data/properties/
 * previews) — used by the version-compare UI to diff two versions' content.
 * Fetched on demand (two requests per comparison) so the history list itself
 * never carries the heavy snapshot blobs. No auth — component data is public.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const v = Number(url.searchParams.get('v'));

  if (!id || !Number.isFinite(v)) {
    return NextResponse.json({ error: 'Missing or invalid id/v parameter' }, { status: 400 });
  }

  if (!usePostgres()) {
    return NextResponse.json({ version: null });
  }

  try {
    const { getComponentVersion } = await import('@/lib/db/component-version-queries');
    const version = await getComponentVersion(id, v);
    if (!version) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }
    return NextResponse.json({ version });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed to fetch version';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
