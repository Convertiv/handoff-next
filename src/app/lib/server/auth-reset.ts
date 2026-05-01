import 'server-only';

import { randomBytes } from 'crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { appBaseUrl, sendPasswordResetEmail } from '../email';
import { getDb } from '../db';
import { passwordResetTokens, users } from '../db/schema';
import { hashPassword, sha256Hex } from '../passwords';
import { logEvent } from './event-log';

const RESET_EXPIRY_MS = 60 * 60 * 1000;

export async function requestPasswordReset(email: string): Promise<{ ok: true }> {
  const normalized = email.trim().toLowerCase();
  const db = getDb();
  if (!normalized) return { ok: true };

  const [u] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);
  if (!u) {
    await logEvent({
      category: 'auth',
      eventType: 'password_reset.request',
      status: 'success',
      route: '/api/handoff/auth/request-reset',
      requestPreview: normalized,
      metadata: { email: normalized, userFound: false },
    });
    return { ok: true };
  }

  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, u.id));

  const raw = randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(raw);
  await db.insert(passwordResetTokens).values({
    userId: u.id,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_EXPIRY_MS),
  });

  const base = appBaseUrl();
  const resetUrl = `${base}/reset-password?token=${encodeURIComponent(raw)}`;

  try {
    await sendPasswordResetEmail(u.email, resetUrl);
  } catch (e) {
    console.error('[auth] requestPasswordReset email failed', e);
  }

  await logEvent({
    category: 'auth',
    eventType: 'password_reset.request',
    status: 'success',
    actorUserId: u.id,
    route: '/api/handoff/auth/request-reset',
    requestPreview: u.email,
    metadata: { email: u.email, userFound: true },
  });

  return { ok: true };
}

export async function resetPassword(token: string, newPassword: string): Promise<{ ok: true } | { error: string }> {
  const db = getDb();
  if (!token || newPassword.length < 8) return { error: 'Password must be at least 8 characters.' };

  const tokenHash = sha256Hex(token);
  const now = new Date();
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now)
      )
    )
    .limit(1);

  if (!row) {
    await logEvent({
      category: 'auth',
      eventType: 'password_reset.complete',
      status: 'error',
      route: '/api/handoff/auth/reset-password',
      error: 'Invalid or expired reset link.',
    });
    return { error: 'Invalid or expired reset link.' };
  }

  const hashed = await hashPassword(newPassword);
  await db.update(users).set({ passwordHash: hashed }).where(eq(users.id, row.userId));
  await db.update(passwordResetTokens).set({ usedAt: now }).where(eq(passwordResetTokens.id, row.id));

  await logEvent({
    category: 'auth',
    eventType: 'password_reset.complete',
    status: 'success',
    actorUserId: row.userId,
    route: '/api/handoff/auth/reset-password',
    entityType: 'password_reset_token',
    entityId: row.id,
  });

  return { ok: true };
}
