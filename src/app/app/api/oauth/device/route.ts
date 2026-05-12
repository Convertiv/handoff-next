import { NextResponse } from 'next/server';
import { createCliDeviceSession, purgeExpiredCliDeviceSessions } from '@/lib/server/cli-device-oauth';
import { issuerForCliSync } from '@/lib/server/request-public-url';

/**
 * RFC 8628 device authorization request (public; CLI calls this).
 * POST with optional JSON body `{}`.
 */
export async function POST(request: Request) {
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
