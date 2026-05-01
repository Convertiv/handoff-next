import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { userMiddleware } from './middleware-hook.mjs';

/**
 * Default Handoff gate: public asset/API paths, optional JWT admin check when DATABASE_URL is set.
 */
async function defaultHandoffProxy(request: NextRequest): Promise<NextResponse> {
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
  ];

  const { pathname } = request.nextUrl;

  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  /** Local SQLite mode: trusted single-user; skip JWT gate for /admin. */
  const isLocalSqlite = !process.env.DATABASE_URL?.trim();

  if (pathname.startsWith('/admin')) {
    if (isLocalSqlite) {
      return NextResponse.next();
    }
    const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    const token = await getToken({ req: request, secret });
    if (!token?.sub) {
      const login = new URL('/login', request.url);
      login.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(login);
    }
    if (token.role !== 'admin') {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return NextResponse.next();
}

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (typeof userMiddleware === 'function') {
    return userMiddleware(request, defaultHandoffProxy);
  }
  return defaultHandoffProxy(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)'],
};
