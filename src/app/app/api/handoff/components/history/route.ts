import { NextResponse } from 'next/server';
import { usePostgres } from '@/lib/db/dialect';

/**
 * GET /api/handoff/components/history?id=<componentId>&limit=<n>
 *
 * Returns the version history for a single component.
 * No auth required — component data is already public via the registry.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);

  if (!id) {
    return NextResponse.json({ error: 'Missing id parameter' }, { status: 400 });
  }

  if (!usePostgres()) {
    return NextResponse.json({ versions: [], total: 0 });
  }

  try {
    const { getComponentVersionHistory, getComponentVersionCount } = await import('@/lib/db/component-version-queries');
    const [versions, total] = await Promise.all([
      getComponentVersionHistory(id, limit),
      getComponentVersionCount(id),
    ]);
    return NextResponse.json({ versions, total });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Failed to fetch version history';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
