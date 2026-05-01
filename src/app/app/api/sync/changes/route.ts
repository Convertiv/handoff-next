import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

export async function GET(request: Request) {
  const { fetchSyncChangesSince } = await import('@/lib/db/sync-queries');
  const { verifySyncBearer } = await import('@/lib/sync-auth');

  const unauthorized = verifySyncBearer(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('since');
  const since = raw === null || raw === '' ? 0 : Number(raw);
  const sinceSafe = Number.isFinite(since) ? Math.max(0, Math.floor(since)) : 0;

  const changeset = await fetchSyncChangesSince(sinceSafe);
  return NextResponse.json(changeset);
}
