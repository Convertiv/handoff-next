import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

export async function GET(request: Request) {
  const { getSyncStatus } = await import('@/lib/db/sync-queries');
  const { verifySyncBearer } = await import('@/lib/sync-auth');

  const unauthorized = verifySyncBearer(request);
  if (unauthorized) return unauthorized;

  const status = await getSyncStatus();
  return NextResponse.json(status);
}
