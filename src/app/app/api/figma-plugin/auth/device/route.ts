import { NextResponse } from 'next/server';
import { createCliDeviceSession, purgeExpiredCliDeviceSessions } from '@/lib/server/cli-device-oauth';
import { issuerForCliSync } from '@/lib/server/request-public-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/figma-plugin/auth/device — RFC 8628 device authorization request for
 * the Figma plugin (P1.6c). Maps onto the shared cli-device-oauth flow: the user
 * approves at `verification_uri` (same /cli/device page), and the resulting token
 * carries the approving user's scopes — `figma:sync` when an admin approves.
 * Public (this is how a token is obtained). Body: optional `{}`.
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
    const verificationUri = `${issuer}/cli/device`.replace(/([^:]\/)\/+/g, '$1');
    const verificationUriComplete = `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;
    return NextResponse.json({
      device_code: deviceCode,
      user_code: userCode,
      verification_uri: verificationUri,
      verification_uri_complete: verificationUriComplete,
      expires_in: expiresIn,
      interval,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Device session failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
