import { handlers } from '@handoff/app/lib/auth';
import type { NextRequest } from 'next/server';

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
