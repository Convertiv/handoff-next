import { handlers } from '@handoff/app/lib/auth';
import type { NextRequest } from 'next/server';

/** Auth uses Postgres, bcrypt, and Node crypto — must not run on Edge. */
export const runtime = 'nodejs';

/**
 * Force dynamic rendering — prevents Next.js build-time static analysis from
 * executing module-level NextAuth initialization (which requires AUTH_SECRET
 * and optionally DATABASE_URL at build time, causing "Failed to collect page
 * data" errors on Vercel).
 */
export const dynamic = 'force-dynamic';

/** Next.js 15+ typed routes expect `(req, ctx)`; next-auth `handlers` are still `(req)` only. */
export function GET(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
): Promise<Response> {
  void context;
  return handlers.GET(request);
}

export function POST(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> }
): Promise<Response> {
  void context;
  return handlers.POST(request);
}
