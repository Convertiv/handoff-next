import { NextResponse } from 'next/server';
import { issuerForCliSync } from '@/lib/server/request-public-url';
import { OAUTH_SCOPES } from '@/lib/oauth-scopes';

export const dynamic = 'force-dynamic';

/**
 * RFC 9728 OAuth Protected Resource Metadata for the Handoff MCP endpoint.
 * Served at /.well-known/oauth-protected-resource via a next.config.mjs rewrite.
 */
export async function GET(request: Request) {
  const issuer = issuerForCliSync(request);
  return NextResponse.json({
    resource: `${issuer}/api/mcp/`,
    authorization_servers: [issuer],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ['header'],
  });
}
