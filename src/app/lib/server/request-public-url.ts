import { handoffBasePath } from '@/lib/api-path';

/** Public browser origin (scheme + host), no path. */
export function publicOriginFromRequest(request: Request): string {
  const u = new URL(request.url);
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? u.host;
  const rawProto = request.headers.get('x-forwarded-proto');
  const proto = rawProto?.split(',')[0]?.trim() || (u.protocol === 'https:' ? 'https' : 'http');
  return `${proto}://${host}`;
}

/** Issuer claim for CLI JWTs: origin + optional Handoff base path (no trailing slash). */
export function issuerForCliSync(request: Request): string {
  const origin = publicOriginFromRequest(request);
  const base = handoffBasePath();
  if (!base) return origin.replace(/\/+$/, '');
  const path = base.startsWith('/') ? base : `/${base}`;
  return `${origin.replace(/\/+$/, '')}${path}`.replace(/\/+$/, '');
}
