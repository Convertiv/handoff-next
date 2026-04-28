import { NextResponse } from 'next/server';

export async function GET() {
  if (process.env.HANDOFF_MODE !== 'dynamic') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const { auth } = await import('@/lib/auth');
  const { listUsers } = await import('@/lib/server/admin-users');
  try {
    const session = await auth();
    const rows = await listUsers(session);
    return NextResponse.json(rows);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === 'Forbidden') return NextResponse.json({ error: msg }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
