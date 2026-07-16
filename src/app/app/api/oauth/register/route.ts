import { NextResponse } from 'next/server';
import { registerOAuthClient } from '@/lib/server/mcp-oauth-connector';

export const dynamic = 'force-dynamic';

/**
 * RFC 7591 Dynamic Client Registration — public endpoint (no auth); this is how
 * claude.ai / Claude Desktop register themselves as an MCP OAuth client the first
 * time a user adds the Handoff connector.
 */
export async function POST(request: Request) {
  let body: { client_name?: string; redirect_uris?: string[]; token_endpoint_auth_method?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: 'Invalid JSON body.' }, { status: 400 });
  }

  const result = await registerOAuthClient({
    clientName: body.client_name,
    redirectUris: body.redirect_uris ?? [],
    tokenEndpointAuthMethod: body.token_endpoint_auth_method,
  });

  if (!result.ok) {
    const failure = result as Extract<typeof result, { ok: false }>;
    return NextResponse.json({ error: failure.error, error_description: failure.errorDescription }, { status: 400 });
  }

  return NextResponse.json(
    {
      client_id: result.clientId,
      client_secret: result.clientSecret,
      client_name: result.clientName,
      redirect_uris: result.redirectUris,
      token_endpoint_auth_method: result.tokenEndpointAuthMethod,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    { status: 201 }
  );
}
