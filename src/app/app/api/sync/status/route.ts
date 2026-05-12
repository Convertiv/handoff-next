import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { getSyncStatus } = await import('@/lib/db/sync-queries');
  const { verifySyncAuth } = await import('@/lib/sync-auth');

  const authz = verifySyncAuth(request);
  if (authz instanceof NextResponse) return authz;

  const status = await getSyncStatus();
  return NextResponse.json(status);
}
