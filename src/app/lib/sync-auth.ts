import { NextResponse } from 'next/server';

/**
 * Shared secret for CLI / automation (`Authorization: Bearer <HANDOFF_SYNC_SECRET>`).
 * Not used for browser sessions.
 */
export function verifySyncBearer(request: Request): NextResponse | null {
  const secret = process.env.HANDOFF_SYNC_SECRET;
  if (!secret || !secret.trim()) {
    return NextResponse.json({ error: 'HANDOFF_SYNC_SECRET is not configured on the server' }, { status: 503 });
  }
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token || token !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}
