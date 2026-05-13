import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { approveCliDeviceSession } from '@/lib/server/cli-device-oauth';

/**
 * Browser completes RFC 8628 authorization (requires Handoff session).
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { user_code?: string };
  try {
    body = (await request.json()) as { user_code?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const userCode = body.user_code?.trim();
  if (!userCode) {
    return NextResponse.json({ error: 'user_code is required' }, { status: 400 });
  }

  const role = session.user.role ?? 'member';
  const result = await approveCliDeviceSession(userCode, session.user.id, role);
  if (result.ok) {
    return NextResponse.json({ ok: true });
  }
  const failure = result as { ok: false; error: string };
  return NextResponse.json({ error: failure.error }, { status: 400 });
}
