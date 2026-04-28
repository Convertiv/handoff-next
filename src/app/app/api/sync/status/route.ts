import { NextResponse } from 'next/server';

export const dynamic = 'force-static';

export async function GET(request: Request) {
  if (process.env.HANDOFF_MODE !== 'dynamic') {
    return NextResponse.json({ error: 'Sync API requires HANDOFF_MODE=dynamic' }, { status: 404 });
  }
  const { getSyncStatus } = await import('@/lib/db/sync-queries');
  const { verifySyncBearer } = await import('@/lib/sync-auth');

  const unauthorized = verifySyncBearer(request);
  if (unauthorized) return unauthorized;

  const status = await getSyncStatus();
  return NextResponse.json(status);
}
