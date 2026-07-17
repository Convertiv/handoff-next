import { getToken } from 'next-auth/jwt';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { userMiddleware } from './middleware-hook.mjs';

/**
 * CORS for the Figma-plugin API (P1.6). The plugin UI runs in a sandboxed iframe
 * whose Origin is `null` (desktop) or `https://www.figma.com` (web), so every call
 * is cross-origin. Auth is Bearer-only (no cookies), so a wildcard origin is safe
 * and correct — do NOT set Allow-Credentials (incompatible with `*`). These headers
 * must ride on EVERY response for the namespace, including preflight and errors.
 */
const FIGMA_PLUGIN_PREFIX = '/api/figma-plugin';
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function applyCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
  return res;
}

/**
 * Short-circuit CORS for `/api/figma-plugin/*`, returning the response to send, or
 * `null` when the path isn't ours.
 *
 * - **Preflight** `OPTIONS` → 204 + CORS, answered here BEFORE any auth (a preflight
 *   carries no Authorization header, so gating it on auth breaks every POST).
 * - Otherwise `next()` with CORS stamped on. Headers set here merge onto the route's
 *   final response, so error status codes (401/410/500) carry CORS too.
 *
 * The no-trailing-slash requirement (the plugin calls the no-slash forms, and a
 * cross-origin 308 drops the POST body) is handled by `skipTrailingSlashRedirect`
 * in next.config — Next fires that redirect before middleware, so it can't be
 * intercepted here.
 */
function handleFigmaPluginCors(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (pathname !== FIGMA_PLUGIN_PREFIX && !pathname.startsWith(`${FIGMA_PLUGIN_PREFIX}/`)) {
    return null;
  }
  if (request.method === 'OPTIONS') {
    return applyCors(new NextResponse(null, { status: 204 }));
  }
  return applyCors(NextResponse.next());
}

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
    '/api/figma-plugin',  // Figma plugin API (figma:sync-scoped inside the routes; CORS handled above)
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
  // Figma-plugin CORS + preflight + trailing-slash — handled before anything else
  // (incl. the user middleware hook) so it can never be gated behind auth.
  const figmaPluginResponse = handleFigmaPluginCors(request);
  if (figmaPluginResponse) return figmaPluginResponse;

  if (typeof userMiddleware === 'function') {
    return userMiddleware(request, defaultHandoffProxy);
  }
  return defaultHandoffProxy(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets/).*)'],
};
