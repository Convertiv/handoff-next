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

const WORKSPACE_AUTH: McpAuthContext = {
  userId: 'workspace',
  role: 'admin',
  scopes: 'sync:read reference:read components:read design:read',
  isLegacySecret: false,
};

/**
 * MCP + reference API auth.
 * - Workspace mode (no DATABASE_URL): unauthenticated local access — returns a read-only workspace context.
 *   Set HANDOFF_SYNC_SECRET to require a bearer token even in workspace mode.
 * - Registry mode (DATABASE_URL set): legacy sync secret or Handoff API JWT with required scopes.
 */
export function verifyHandoffApiAuth(
  request: Request,
  opts?: { requireScopes?: string[] }
): NextResponse | McpAuthContext {
  const secret = process.env.HANDOFF_SYNC_SECRET?.trim();
  const token = parseBearer(request);

  // Workspace mode with no secret configured: allow unauthenticated local access
  if (!process.env.DATABASE_URL?.trim() && !secret) {
    return WORKSPACE_AUTH;
  }

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

/** @deprecated MCP no longer requires Postgres — workspace mode is supported. */
export function requirePostgresForMcp(): NextResponse | null {
  return null;
}
