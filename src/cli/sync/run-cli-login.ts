import type Handoff from '@handoff/index';
import { Logger } from '@handoff/utils/logger';
import { writeCliAuth } from './cli-auth-store.js';
import { tryOpenBrowserUrl } from './open-browser.js';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

type DeviceResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

type TokenResponse = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type RunCliLoginOptions = {
  /** When false, do not spawn a browser (default true unless CI=1 or HANDOFF_LOGIN_NO_BROWSER=1). */
  openBrowser?: boolean;
};

function shouldOpenBrowser(opts?: RunCliLoginOptions): boolean {
  if (opts?.openBrowser === false) return false;
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  if (process.env.HANDOFF_LOGIN_NO_BROWSER === '1' || process.env.HANDOFF_LOGIN_NO_BROWSER === 'true') return false;
  return true;
}

/**
 * RFC 8628 device flow: obtain access token and write `.handoff/cli-auth.json`.
 */
export async function runCliLogin(handoff: Handoff, remoteUrlArg: string, opts?: RunCliLoginOptions): Promise<void> {
  const base = remoteUrlArg.replace(/\/$/, '');
  const deviceRes = await fetch(`${base}/api/oauth/device`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: '{}',
  });
  if (!deviceRes.ok) {
    const t = await deviceRes.text().catch(() => '');
    throw new Error(`Device authorization failed (${deviceRes.status}): ${t || deviceRes.statusText}`);
  }
  const device = (await deviceRes.json()) as DeviceResponse;
  if (!device.device_code || !device.user_code) {
    throw new Error('Invalid device authorization response from server.');
  }

  const verifyUrl = device.verification_uri_complete ?? `${device.verification_uri}?user_code=${encodeURIComponent(device.user_code)}`;
  Logger.log('');
  Logger.log('Open this URL in your browser (sign in to Handoff if prompted), then approve CLI access:');
  Logger.log(verifyUrl);
  Logger.log('');
  Logger.log(`User code: ${device.user_code}`);
  Logger.log('');

  if (shouldOpenBrowser(opts)) {
    tryOpenBrowserUrl(verifyUrl);
    Logger.info('Attempted to open your default browser.');
  }

  const deadline = Date.now() + (device.expires_in ?? 900) * 1000;
  let intervalMs = (device.interval ?? 5) * 1000;

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    const tokenRes = await fetch(`${base}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        grant_type: DEVICE_GRANT,
        device_code: device.device_code,
      }),
    });
    const tokenJson = (await tokenRes.json()) as TokenResponse;
    if (tokenRes.ok && tokenJson.access_token) {
      const expiresIn = tokenJson.expires_in ?? 3600;
      await writeCliAuth(handoff.workingPath, {
        remoteUrl: base,
        accessToken: tokenJson.access_token,
        expiresAtMs: Date.now() + expiresIn * 1000,
      });
      Logger.success(`Logged in. Credentials saved to ${handoff.workingPath}/.handoff/cli-auth.json`);
      Logger.info('You can run `handoff-app pull` and `handoff-app push` without HANDOFF_CLOUD_TOKEN in .env (until the token expires).');
      return;
    }
    if (tokenJson.error === 'authorization_pending') {
      continue;
    }
    if (tokenJson.error === 'slow_down') {
      intervalMs = Math.min(intervalMs + 5000, 60_000);
      continue;
    }
    const msg = tokenJson.error_description || tokenJson.error || tokenRes.statusText;
    throw new Error(`Token request failed: ${msg}`);
  }

  throw new Error('Device authorization timed out. Run `handoff-app login` again.');
}
