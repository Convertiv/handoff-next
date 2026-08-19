import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The "I typed the password" cookie (`docs/SITE-PASSWORD.md` §4).
 *
 * Signed rather than stored: there is nothing to keep server-side, and a session row per anonymous visitor
 * would need sweeping. Same HMAC idiom as `guest-session.ts`.
 *
 * Format `v1.<epoch>.<expiry>.<signature>`.
 */

export const UNLOCK_COOKIE = 'handoff_unlock';
/** 30 days. Long enough that a client is not retyping it daily; short enough to expire after an engagement. */
export const UNLOCK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signingSecret(): string {
  const secret = (process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? '').trim();
  if (!secret) throw new Error('AUTH_SECRET (or NEXTAUTH_SECRET) must be set to use site protection.');
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function equal(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Mint a cookie value for the given epoch. */
export function issueUnlock(epoch: number, now = Date.now()): string {
  const payload = `v1.${epoch}.${now + UNLOCK_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Is this a cookie we issued, still in date, **and at the current epoch**?
 *
 * The epoch check is the point: a cookie signed under an older epoch was valid for a password that has since
 * been changed, and must stop working the moment it is. Fails closed on anything unexpected.
 */
export function readUnlock(value: string | null | undefined, currentEpoch: number, now = Date.now()): boolean {
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const [, epochRaw, expRaw, signature] = parts;
  if (!equal(signature, sign(parts.slice(0, 3).join('.')))) return false;

  const epoch = Number(epochRaw);
  const exp = Number(expRaw);
  if (!Number.isFinite(epoch) || !Number.isFinite(exp)) return false;
  if (epoch !== currentEpoch) return false;
  return now <= exp;
}

/** Cookie attributes. `SameSite=Lax` is right: this is only ever needed on a top-level navigation. */
export function unlockCookieOptions(now = Date.now()) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: new Date(now + UNLOCK_TTL_MS),
  };
}
