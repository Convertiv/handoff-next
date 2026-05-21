import 'server-only';

import { NextResponse } from 'next/server';
import { verifyCliAccessToken, jwtScopesInclude } from '@/lib/cli-sync-jwt';
import { issuerForCliSync } from '@/lib/server/request-public-url';

export type McpAuthContext = {
  userId: string;
  role: string;
  scopes: string;
  isLegacySecret: boolean;
};

function parseBearer(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/**
 * MCP + reference API auth: legacy sync secret or Handoff API JWT with required scopes.
 */
export function verifyHandoffApiAuth(
  request: Request,
  opts?: { requireScopes?: string[] }
): NextResponse | McpAuthContext {
  const secret = process.env.HANDOFF_SYNC_SECRET?.trim();
  const token = parseBearer(request);
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (secret && token === secret) {
    return { userId: 'service', role: 'admin', scopes: 'sync:read sync:write reference:read components:read components:write design:read design:write generate:component figma:sync', isLegacySecret: true };
  }

  const iss = issuerForCliSync(request);
  const jwt = verifyCliAccessToken(token, iss);
  if (!jwt.ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const scopes = jwt.payload.scp;
  for (const req of opts?.requireScopes ?? []) {
    if (!jwtScopesInclude(scopes, req)) {
      return NextResponse.json({ error: `Forbidden — missing scope: ${req}` }, { status: 403 });
    }
  }

  return {
    userId: jwt.payload.sub,
    role: jwt.payload.role,
    scopes,
    isLegacySecret: false,
  };
}

export function requirePostgresForMcp(): NextResponse | null {
  if (!process.env.DATABASE_URL?.trim()) {
    return NextResponse.json(
      { error: 'MCP requires Postgres (DATABASE_URL). Deploy Handoff to a hosted instance.' },
      { status: 503 }
    );
  }
  return null;
}
