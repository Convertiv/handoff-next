import { NextResponse } from 'next/server';
import { exchangeCliDeviceCode } from '@/lib/server/cli-device-oauth';
import { issuerForCliSync } from '@/lib/server/request-public-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBody(body: string, contentType: string | null): Record<string, string> {
  const ct = contentType?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (ct === 'application/x-www-form-urlencoded') {
    const out: Record<string, string> = {};
    new URLSearchParams(body).forEach((v, k) => { out[k] = v; });
    return out;
  }
  try {
    return JSON.parse(body) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * POST /api/figma-plugin/auth/token — RFC 8628 device-code token exchange for the
 * Figma plugin (P1.6c). Polls the shared cli-device-oauth session; returns the
 * scoped access token once the user has approved. Accepts JSON or form-encoded
 * `{ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code }`
 * (grant_type optional — device_code is the only supported grant here).
 */
export async function POST(request: Request): Promise<Response> {
  const raw = await request.text();
  const fields = parseBody(raw, request.headers.get('content-type'));
  const grantType = fields.grant_type;
  if (grantType && grantType !== 'urn:ietf:params:oauth:grant-type:device_code') {
    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: 'Only the device_code grant is supported here.' },
      { status: 400 }
    );
  }
  const deviceCode = fields.device_code;
  if (!deviceCode?.trim()) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'device_code is required.' }, { status: 400 });
  }
  const result = await exchangeCliDeviceCode(deviceCode.trim(), issuerForCliSync(request));
  if (result.ok) {
    return NextResponse.json({ access_token: result.accessToken, token_type: result.tokenType, expires_in: result.expiresIn });
  }
  const failure = result as Extract<typeof result, { ok: false }>;
  return NextResponse.json({ error: failure.error, error_description: failure.errorDescription }, { status: failure.httpStatus });
}
