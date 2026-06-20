import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { userMiddleware } from './middleware-hook.mjs';

/**
 * Default Handoff gate: public asset/API paths, optional JWT admin check when DATABASE_URL is set.
 *
 * Uses `getToken` only (Edge-safe). Do not import `@/lib/auth` here — that module pulls in
 * Postgres, bcrypt, and Node `crypto`, which break on Vercel Edge middleware.
 */
async function defaultHandoffProxy(request: NextRequest): Promise<NextResponse> {
  const publicPaths = [
    '/api/auth',
    '/_next',
    '/favicon.ico',
    '/assets',
    '/foundations/assets',
    '/api/component',
    '/api/components.json',
    '/api/pattern',
    '/api/patterns.json',
    '/api/tokens',
    '/login',
    '/reset-password',
    '/setup',       // first-run admin setup (reachable before any users exist)
    '/api/setup',   // setup API route
    '/api/mcp',
    '/api/handoff/reference-materials',
    '/api/sync',
    '/api/admin/migrate', // manual migration trigger (bearer-auth'd inside the route)
    '/api/registry',      // per-project content push/get (bearer-auth on writes)
  ];

  const { pathname } = request.nextUrl;

  // Inject the pathname so server components can read it without the
  // full request object (used by root layout for the /setup redirect).
  const response = NextResponse.next({
    request: { headers: new Headers(request.headers) },
  });
  response.headers.set('x-pathname', pathname);

  if (publicPaths.some((p) => pathname.startsWith(p))) {
    return response;
  }

  if (pathname.startsWith('/admin')) {
    if (!process.env.DATABASE_URL?.trim()) {
      const setup = new URL('/developer/local-setup', request.url);
      return NextResponse.redirect(setup);
    }
    const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;
    const token = await getToken({
      req: request,
      secret,
      secureCookie: process.env.NODE_ENV === 'production',
    });
    if (!token?.sub) {
      const login = new URL('/login', request.url);
      login.searchParams.set('callbackUrl', pathname);
      return NextResponse.redirect(login);
    }
    if (token.role !== 'admin') {
      return NextResponse.redirect(new URL('/', request.url));
    }
  }

  return response;
}

/** Next.js 16 proxy convention — function must be named `proxy` (or be a default export). */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (typeof userMiddleware === 'function') {
    return userMiddleware(request, defaultHandoffProxy);
  }
  return defaultHandoffProxy(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)'],
};
