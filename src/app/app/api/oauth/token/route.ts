import { NextResponse } from 'next/server';
import { exchangeCliDeviceCode } from '@/lib/server/cli-device-oauth';
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
  const deviceCode = fields.device_code ?? fields['device_code'];
  const expected =
    'urn:ietf:params:oauth:grant-type:device_code' as const;
  if (grantType !== expected) {
    return NextResponse.json(
      { error: 'unsupported_grant_type', error_description: 'Use grant_type device_code.' },
      { status: 400 }
    );
  }
  if (!deviceCode?.trim()) {
    return NextResponse.json({ error: 'invalid_request', error_description: 'device_code is required.' }, { status: 400 });
  }

  const issuer = issuerForCliSync(request);
  const result = await exchangeCliDeviceCode(deviceCode.trim(), issuer);

  if (result.ok) {
    return NextResponse.json({
      access_token: result.accessToken,
      token_type: result.tokenType,
      expires_in: result.expiresIn,
    });
  }

  const failure = result as Extract<typeof result, { ok: false }>;
  return NextResponse.json(
    {
      error: failure.error,
      error_description: failure.errorDescription,
    },
    { status: failure.httpStatus }
  );
}
