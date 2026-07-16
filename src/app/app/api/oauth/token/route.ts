import { NextResponse } from 'next/server';
import { exchangeCliDeviceCode } from '@/lib/server/cli-device-oauth';
import { exchangeAuthorizationCode, refreshAccessToken } from '@/lib/server/mcp-oauth-connector';
import { issuerForCliSync } from '@/lib/server/request-public-url';

function parseBody(body: string, contentType: string | null): Record<string, string> {
  const ct = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (ct === 'application/x-www-form-urlencoded') {
    const params = new URLSearchParams(body);
    const out: Record<string, string> = {};
    params.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  try {
    return JSON.parse(body) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * RFC 8628 token request: grant_type=urn:ietf:params:oauth:grant-type:device_code
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const fields = parseBody(raw, request.headers.get('content-type'));
  const grantType = fields.grant_type ?? fields['grant_type'];
  const issuer = issuerForCliSync(request);

  if (grantType === 'urn:ietf:params:oauth:grant-type:device_code') {
    const deviceCode = fields.device_code ?? fields['device_code'];
    if (!deviceCode?.trim()) {
      return NextResponse.json({ error: 'invalid_request', error_description: 'device_code is required.' }, { status: 400 });
    }
    const result = await exchangeCliDeviceCode(deviceCode.trim(), issuer);
    if (result.ok) {
      return NextResponse.json({ access_token: result.accessToken, token_type: result.tokenType, expires_in: result.expiresIn });
    }
    const failure = result as Extract<typeof result, { ok: false }>;
    return NextResponse.json({ error: failure.error, error_description: failure.errorDescription }, { status: failure.httpStatus });
  }

  if (grantType === 'authorization_code') {
    const code = fields.code?.trim();
    const redirectUri = fields.redirect_uri?.trim();
    const clientId = fields.client_id?.trim();
    const codeVerifier = fields.code_verifier?.trim();
    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return NextResponse.json(
        { error: 'invalid_request', error_description: 'code, redirect_uri, client_id, and code_verifier are required.' },
        { status: 400 }
      );
    }
    const result = await exchangeAuthorizationCode({ code, redirectUri, clientId, codeVerifier, issuer });
    if (!result.ok) {
      const failure = result as Extract<typeof result, { ok: false }>;
      return NextResponse.json({ error: failure.error, error_description: failure.errorDescription }, { status: 400 });
    }
    return NextResponse.json({
      access_token: result.tokens.accessToken,
      refresh_token: result.tokens.refreshToken,
      token_type: 'Bearer',
      expires_in: result.tokens.expiresIn,
      scope: result.tokens.scopes,
    });
  }

  if (grantType === 'refresh_token') {
    const refreshToken = fields.refresh_token?.trim();
    const clientId = fields.client_id?.trim();
    if (!refreshToken || !clientId) {
      return NextResponse.json({ error: 'invalid_request', error_description: 'refresh_token and client_id are required.' }, { status: 400 });
    }
    const result = await refreshAccessToken({ refreshToken, clientId, issuer });
    if (!result.ok) {
      const failure = result as Extract<typeof result, { ok: false }>;
      return NextResponse.json({ error: failure.error, error_description: failure.errorDescription }, { status: 400 });
    }
    return NextResponse.json({
      access_token: result.tokens.accessToken,
      refresh_token: result.tokens.refreshToken,
      token_type: 'Bearer',
      expires_in: result.tokens.expiresIn,
      scope: result.tokens.scopes,
    });
  }

  return NextResponse.json(
    { error: 'unsupported_grant_type', error_description: 'Supported: device_code, authorization_code, refresh_token.' },
    { status: 400 }
  );
}
