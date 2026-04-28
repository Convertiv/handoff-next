import { NextResponse, type NextRequest } from 'next/server';
import { applyHandoffComponentPatch, getHandoffComponentRow, type ComponentPatchBody } from '@/lib/server/handoff-component-patch';

export async function GET(request: NextRequest) {
  if (process.env.HANDOFF_MODE !== 'dynamic') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get('id')?.trim() ?? '';
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  try {
    const row = await getHandoffComponentRow(id);
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (process.env.HANDOFF_MODE !== 'dynamic') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = (await request.json()) as ComponentPatchBody & { id?: string };
    const id = String(body.id ?? '').trim();
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const { id: _omit, ...patch } = body;
    await applyHandoffComponentPatch(session, id, patch);
    const row = await getHandoffComponentRow(id);
    return NextResponse.json(row);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    if (msg === 'Unauthorized') return NextResponse.json({ error: msg }, { status: 401 });
    if (msg === 'Forbidden') return NextResponse.json({ error: msg }, { status: 403 });
    if (msg === 'Not found') return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
