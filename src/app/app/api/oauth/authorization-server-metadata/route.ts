import { NextResponse } from 'next/server';
import { issuerForCliSync } from '@/lib/server/request-public-url';
import { OAUTH_SCOPES } from '@/lib/oauth-scopes';

export const dynamic = 'force-dynamic';

/**
 * RFC 8414 Authorization Server Metadata. Served at
 * /.well-known/oauth-authorization-server via a next.config.mjs rewrite.
 *
 * Endpoint URLs carry a trailing slash: next.config.mjs sets trailingSlash:true,
 * so the canonical form of every app-router route already ends in "/" — since
 * these endpoints are meant to be read from this document (not hardcoded by
 * clients), advertising the canonical URL avoids a 308 redirect on every call.
 */
export async function GET(request: Request) {
  const issuer = issuerForCliSync(request);
  return NextResponse.json({
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize/`,
    token_endpoint: `${issuer}/api/oauth/token/`,
    registration_endpoint: `${issuer}/api/oauth/register/`,
    scopes_supported: OAUTH_SCOPES,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
  });
}
