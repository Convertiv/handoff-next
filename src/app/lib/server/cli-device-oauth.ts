import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { signCliAccessToken } from '@/lib/cli-sync-jwt';
import { getDb } from '@/lib/db';
import { cliDeviceSessions, users } from '@/lib/db/schema';

const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXYZ23456789';

function randomUserCodeSegment(len: number): string {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) {
    s += USER_CODE_ALPHABET[bytes[i]! % USER_CODE_ALPHABET.length]!;
  }
  return s;
}

export function generateUserCode(): string {
  return `${randomUserCodeSegment(4)}-${randomUserCodeSegment(4)}`;
}

export function generateDeviceCode(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceCode(plain: string): string {
  return createHash('sha256').update(plain, 'utf8').digest('hex');
}

export function scopesForRole(role: string | undefined): string {
  if (role === 'admin') {
    return [
      'sync:read',
      'sync:write',
      'reference:read',
      'components:read',
      'components:write',
      'design:read',
      'design:write',
      'generate:component',
      'figma:sync',
    ].join(' ');
  }
  return ['sync:read', 'reference:read', 'components:read', 'design:read', 'design:write'].join(' ');
}

export type CreateDeviceSessionResult = {
  deviceCode: string;
  userCode: string;
  expiresIn: number;
  interval: number;
};

const DEVICE_TTL_SEC = 900;
const POLL_INTERVAL_SEC = 5;

export async function createCliDeviceSession(): Promise<CreateDeviceSessionResult> {
  const db = getDb();
  const deviceCode = generateDeviceCode();
  const userCode = generateUserCode();
  const deviceCodeHash = hashDeviceCode(deviceCode);
  const expiresAt = new Date(Date.now() + DEVICE_TTL_SEC * 1000);

  await db.insert(cliDeviceSessions).values({
    deviceCodeHash,
    userCode,
    status: 'pending',
    expiresAt,
  });

  return {
    deviceCode,
    userCode,
    expiresIn: DEVICE_TTL_SEC,
    interval: POLL_INTERVAL_SEC,
  };
}

export async function approveCliDeviceSession(userCode: string, userId: string, role: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = getDb();
  const normalized = userCode.replace(/\s/g, '').toUpperCase();
  const rows = await db
    .select()
    .from(cliDeviceSessions)
    .where(and(eq(cliDeviceSessions.userCode, normalized), eq(cliDeviceSessions.status, 'pending'), gt(cliDeviceSessions.expiresAt, new Date())))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return { ok: false, error: 'Invalid or expired user code.' };
  }
  const scopes = scopesForRole(role);
  await db
    .update(cliDeviceSessions)
    .set({ status: 'approved', userId, scopes })
    .where(eq(cliDeviceSessions.id, row.id));
  return { ok: true };
}

export type ExchangeDeviceCodeResult =
  | { ok: true; accessToken: string; expiresIn: number; tokenType: 'Bearer' }
  | { ok: false; error: string; errorDescription?: string; httpStatus: number };

/**
 * RFC 8628: pending -> authorization_pending; approved -> access_token; consumed/denied/expired -> errors
 */
export async function exchangeCliDeviceCode(deviceCodePlain: string, issuer: string): Promise<ExchangeDeviceCodeResult> {
  const db = getDb();
  const hash = hashDeviceCode(deviceCodePlain);
  const rows = await db.select().from(cliDeviceSessions).where(eq(cliDeviceSessions.deviceCodeHash, hash)).limit(1);
  const row = rows[0];
  if (!row) {
    return { ok: false, error: 'invalid_grant', errorDescription: 'Unknown device code.', httpStatus: 400 };
  }
  if (row.expiresAt < new Date()) {
    return { ok: false, error: 'expired_token', errorDescription: 'Device session expired.', httpStatus: 400 };
  }
  if (row.status === 'pending') {
    return { ok: false, error: 'authorization_pending', errorDescription: 'The authorization request is still pending.', httpStatus: 400 };
  }
  if (row.status === 'denied') {
    return { ok: false, error: 'access_denied', errorDescription: 'User denied the request.', httpStatus: 400 };
  }
  if (row.status === 'consumed') {
    return { ok: false, error: 'invalid_grant', errorDescription: 'Device code already used.', httpStatus: 400 };
  }
  if (row.status !== 'approved' || !row.userId) {
    return { ok: false, error: 'authorization_pending', httpStatus: 400 };
  }

  const userRows = await db.select({ role: users.role }).from(users).where(eq(users.id, row.userId)).limit(1);
  const actualRole = userRows[0]?.role ?? 'member';

  const TOKEN_TTL_SEC = 365 * 24 * 3600; // 1 year — CLI tokens are machine credentials, not browser sessions

  const accessToken = signCliAccessToken({
    sub: row.userId,
    role: actualRole,
    scp: row.scopes,
    iss: issuer,
    ttlSeconds: TOKEN_TTL_SEC,
  });

  await db.update(cliDeviceSessions).set({ status: 'consumed' }).where(eq(cliDeviceSessions.id, row.id));

  return { ok: true, accessToken, expiresIn: TOKEN_TTL_SEC, tokenType: 'Bearer' };
}

/** Delete expired sessions (best-effort cleanup). */
export async function purgeExpiredCliDeviceSessions(): Promise<void> {
  const db = getDb();
  await db.delete(cliDeviceSessions).where(lt(cliDeviceSessions.expiresAt, new Date()));
}
