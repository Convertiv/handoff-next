import { NextResponse } from 'next/server';
import { exchangeCliDeviceCode } from '@/lib/server/cli-device-oauth';
import { issuerForCliSync } from '@/lib/server/request-public-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/figma-plugin/auth/token — device-code poll for the Figma plugin
 * (P1.6, spec §4). The plugin polls every `interval` seconds with `{ deviceCode }`
 * until approved. Response = TokenPollResponse:
 *   { status: "pending" }
 *   { status: "approved", token, scopes?, user? }
 * A `410` means the device code expired (plugin restarts the flow). CORS is applied
 * by proxy.ts. Public (no Bearer — this is how the token is obtained).
 */
export async function POST(request: Request): Promise<Response> {
  let body: { deviceCode?: unknown };
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const deviceCode = typeof body.deviceCode === 'string' ? body.deviceCode.trim() : '';
  if (!deviceCode) {
    return NextResponse.json({ error: 'deviceCode is required' }, { status: 400 });
  }

  const result = await exchangeCliDeviceCode(deviceCode, issuerForCliSync(request));
  if (result.ok) {
    return NextResponse.json({
      status: 'approved',
      token: result.accessToken,
      scopes: result.scopes ? result.scopes.split(/\s+/).filter(Boolean) : [],
      user: result.user,
    });
  }

  const failure = result as Extract<typeof result, { ok: false }>;
  // Still waiting on the user to approve → keep polling.
  if (failure.error === 'authorization_pending') {
    return NextResponse.json({ status: 'pending' });
  }
  // Expired device code → 410 so the plugin restarts the flow.
  if (failure.error === 'expired_token') {
    return NextResponse.json({ error: 'Device code expired' }, { status: 410 });
  }
  // Denied / already-consumed / unknown → surface as an error the plugin can show.
  return NextResponse.json({ error: failure.errorDescription ?? failure.error }, { status: failure.httpStatus });
}
