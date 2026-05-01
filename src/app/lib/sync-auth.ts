import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';

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

export type AuthOrCloudUser = {
  userId: string;
  role: string;
};

/**
 * NextAuth session, or `Authorization: Bearer` matching HANDOFF_SYNC_SECRET
 * (local Handoff instances proxying AI to this server).
 */
export async function authOrCloudToken(request: Request): Promise<AuthOrCloudUser | NextResponse> {
  const session = await auth();
  if (session?.user?.id) {
    return { userId: session.user.id, role: session.user.role ?? 'viewer' };
  }
  const bearerErr = verifySyncBearer(request);
  if (bearerErr) return bearerErr;
  return { userId: 'cloud-proxy', role: 'admin' };
}

/** When bearer proxy auth, optional acting user from local instance (rate limits). */
export function proxyActingUserId(request: Request): string | undefined {
  return request.headers.get('x-handoff-proxy-acting-user')?.trim() || undefined;
}

/** Rate limit / logging key: real session user, or forwarded id when cloud receives a proxied request. */
export function rateLimitUserId(authUser: AuthOrCloudUser, request: Request): string {
  if (authUser.userId === 'cloud-proxy') {
    return proxyActingUserId(request) ?? 'cloud-proxy';
  }
  return authUser.userId;
}
