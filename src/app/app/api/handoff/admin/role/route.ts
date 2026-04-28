import { NextResponse, type NextRequest } from 'next/server';

export async function POST(request: NextRequest) {
  if (process.env.HANDOFF_MODE !== 'dynamic') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const { auth } = await import('@/lib/auth');
  const { updateUserRole } = await import('@/lib/server/admin-users');
  try {
    const session = await auth();
    const body = (await request.json()) as { userId?: string; role?: 'admin' | 'member' };
    const r = await updateUserRole(session, String(body.userId || ''), body.role ?? 'member');
    if ('error' in r) return NextResponse.json(r, { status: 400 });
    return NextResponse.json(r);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === 'Forbidden') return NextResponse.json({ error: msg }, { status: 403 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
