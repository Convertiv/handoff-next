import { NextResponse } from 'next/server';
import { issuerForCliSync } from '@/lib/server/request-public-url';
import { OAUTH_SCOPES } from '@/lib/oauth-scopes';

export const dynamic = 'force-dynamic';

/**
 * RFC 9728 OAuth Protected Resource Metadata for the Handoff MCP endpoint.
 * Served at /.well-known/oauth-protected-resource via a next.config.mjs rewrite.
 *
 * `resource` is advertised WITHOUT a trailing slash. MCP clients (Claude included)
 * canonicalize the connector URL to the no-slash form and cross-check it against
 * this value per RFC 9728 §3.3 — a trailing-slash mismatch makes strict clients
 * reject the connection before any authenticated call. `skipTrailingSlashRedirect`
 * (next.config.mjs) means /api/mcp serves directly with no 308, so the no-slash
 * form is both what the client uses and what the server answers.
 */
export async function GET(request: Request) {
  const issuer = issuerForCliSync(request);
  return NextResponse.json({
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ['header'],
  });
}
