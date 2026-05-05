import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { LOGIN_TO_USE_TOOL_MESSAGE } from '@/lib/login-required-messages';

export { LOGIN_TO_USE_TOOL_MESSAGE };

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

export type AuthOrCloudTokenOptions = {
  /**
   * Accept `HANDOFF_SYNC_SECRET` bearer without `X-Handoff-Proxy-Acting-User`.
   * Use only for trusted server-to-server calls (e.g. cloud `design-artifact-extract`).
   */
  allowServiceBearer?: boolean;
};

/**
 * NextAuth session, or sync bearer used for cloud AI proxy.
 *
 * Bearer-only access is **not** enough for user-facing AI routes: callers must either
 * have a browser session or send `X-Handoff-Proxy-Acting-User` (set by {@link proxyAiToCloud})
 * so proxied requests are tied to a signed-in user on the origin instance.
 */
export async function authOrCloudToken(
  request: Request,
  opts: AuthOrCloudTokenOptions = {}
): Promise<AuthOrCloudUser | NextResponse> {
  const session = await auth();
  if (session?.user?.id) {
    return { userId: session.user.id, role: session.user.role ?? 'viewer' };
  }

  const header = request.headers.get('authorization') ?? '';
  const bearerToken = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!bearerToken) {
    return NextResponse.json({ error: LOGIN_TO_USE_TOOL_MESSAGE }, { status: 401 });
  }

  const bearerErr = verifySyncBearer(request);
  if (bearerErr) return bearerErr;
  if (!opts.allowServiceBearer) {
    const acting = proxyActingUserId(request);
    if (!acting?.trim()) {
      return NextResponse.json(
        { error: 'Unauthorized — sign in to use AI, or use a configured cloud proxy with acting-user headers.' },
        { status: 401 }
      );
    }
  }
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
