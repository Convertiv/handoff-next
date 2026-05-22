import type { Session } from 'next-auth';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { withAuth } from './lib/auth';
import { userMiddleware } from './middleware-hook.mjs';

/**
 * Default Handoff gate: public asset/API paths, optional admin check when DATABASE_URL is set.
 */
async function defaultHandoffProxy(request: NextRequest, session: Session | null): Promise<NextResponse> {
  const publicPaths = [
    '/api/auth',
    '/_next',
    '/favicon.ico',
    '/assets',
    '/api/component',
    '/api/components.json',
    '/api/pattern',
    '/api/patterns.json',
    '/api/tokens',
    '/login',
    '/reset-password',
    '/api/mcp',
    '/api/handoff/reference-materials',
    '/api/sync',
  ];

  const { pathname } = request.nextUrl;

  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/admin')) {
    if (!process.env.DATABASE_URL?.trim()) {
      const setup = new URL('/dev/local-setup', request.url);
      return NextResponse.redirect(setup);
    }
    if (!session?.user?.id) {
      const login = new URL('/login', request.url);
      login.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(login);
    }
    if (session.user.role !== 'admin') {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return NextResponse.next();
}

export default withAuth(async (request) => {
  const session = request.auth as Session | null;
  const runDefault = () => defaultHandoffProxy(request, session);

  if (typeof userMiddleware === 'function') {
    return userMiddleware(request, runDefault);
  }
  return runDefault();
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)'],
};
