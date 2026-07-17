import { NextResponse } from 'next/server';
import { createCliDeviceSession, purgeExpiredCliDeviceSessions } from '@/lib/server/cli-device-oauth';
import { issuerForCliSync } from '@/lib/server/request-public-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/figma-plugin/auth/device — device authorization request for the Figma
 * plugin (P1.6, spec §4). Maps onto the shared cli-device-oauth flow: the user
 * approves at `verificationUrl` (the /cli/device page), and the resulting token
 * carries the approving user's scopes — `figma:sync` when an admin approves.
 * Public (this is how a token is obtained). Body: `{}`.
 *
 * Response = DeviceCodeResponse (camelCase, per the plugin contract):
 *   { deviceCode, userCode, verificationUrl, expiresIn, interval }
 * CORS is applied by proxy.ts for the whole /api/figma-plugin/* namespace.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    await purgeExpiredCliDeviceSessions();
  } catch {
    /* best-effort */
  }
  try {
    const { deviceCode, userCode, expiresIn, interval } = await createCliDeviceSession();
    const issuer = issuerForCliSync(request);
    const verificationUrl = `${issuer}/cli/device?user_code=${encodeURIComponent(userCode)}`.replace(/([^:]\/)\/+/g, '$1');
    return NextResponse.json({
      deviceCode,
      userCode,
      verificationUrl,
      expiresIn,
      interval,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Device session failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
