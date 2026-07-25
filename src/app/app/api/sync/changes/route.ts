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

  const rawLimit = searchParams.get('limit');
  const limit = rawLimit === null || rawLimit === '' ? undefined : Number(rawLimit);
  const limitSafe = limit !== undefined && Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : undefined;

  // Bounded page: the response carries `hasMore`/`nextCursor`, and `version` advances only
  // to the last delivered id when bounded, so a client that re-pulls (either looping on
  // `hasMore` or on its normal poll interval) drains the feed without skipping events.
  const changeset = await fetchSyncChangesSince(sinceSafe, limitSafe);
  return NextResponse.json(changeset);
}
