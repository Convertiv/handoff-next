import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { fetchSyncChangesSince } = await import('@/lib/db/sync-queries');
  const { verifySyncAuth } = await import('@/lib/sync-auth');

  const authz = verifySyncAuth(request);
  if (authz instanceof NextResponse) return authz;

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('since');
  const since = raw === null || raw === '' ? 0 : Number(raw);
  const sinceSafe = Number.isFinite(since) ? Math.max(0, Math.floor(since)) : 0;

  const changeset = await fetchSyncChangesSince(sinceSafe);
  return NextResponse.json(changeset);
}
