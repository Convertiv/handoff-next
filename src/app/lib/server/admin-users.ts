import 'server-only';

import { randomBytes } from 'crypto';
import { count, eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { appBaseUrl, sendInviteEmail } from '../email';
import { getDb } from '../db';
import { passwordResetTokens, users } from '../db/schema';
import { sha256Hex } from '../passwords';

const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

function requireAdmin(session: Session | null) {
  if (!session?.user?.id) throw new Error('Unauthorized');
  if (session.user.role !== 'admin') throw new Error('Forbidden');
  return session;
}

export type UserRowDto = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  emailVerified: string | null;
};

export async function listUsers(session: Session | null): Promise<UserRowDto[]> {
  requireAdmin(session);
  const db = getDb();

  const rows = await db.select().from(users);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role ?? 'member',
    emailVerified: r.emailVerified ? r.emailVerified.toISOString() : null,
  }));
}

export async function inviteUser(
  session: Session | null,
  email: string,
  role: 'admin' | 'member'
): Promise<{ ok: true } | { error: string }> {
  const s = requireAdmin(session);
  const db = getDb();

  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return { error: 'Invalid email.' };
  if (role !== 'admin' && role !== 'member') return { error: 'Invalid role.' };

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).limit(1);
  if (existing) return { error: 'A user with this email already exists.' };

  const inserted = await db
    .insert(users)
    .values({
      email: normalized,
      name: normalized.split('@')[0] || normalized,
      role,
      passwordHash: null,
    })
    .returning({ id: users.id });

  const created = inserted[0];
  if (!created) return { error: 'Failed to create user.' };

  const raw = randomBytes(32).toString('hex');
  const tokenHash = sha256Hex(raw);
  await db.insert(passwordResetTokens).values({
    userId: created.id,
    tokenHash,
    expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
  });

  const base = appBaseUrl();
  const inviteUrl = `${base}/reset-password?token=${encodeURIComponent(raw)}`;

  try {
    await sendInviteEmail(normalized, inviteUrl, s.user?.name ?? s.user?.email ?? null);
  } catch (e) {
    console.error('[admin] invite email failed', e);
    return { error: 'User was created but the invite email could not be sent.' };
  }

  return { ok: true };
}

export async function removeUser(session: Session | null, userId: string): Promise<{ ok: true } | { error: string }> {
  const s = requireAdmin(session);
  const db = getDb();
  if (!userId) return { error: 'Missing user id.' };
  if (userId === s.user!.id) return { error: 'You cannot remove your own account.' };

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return { error: 'User not found.' };
  if (target.role === 'admin') {
    const [{ n }] = await db.select({ n: count() }).from(users).where(eq(users.role, 'admin'));
    if (n <= 1) return { error: 'Cannot delete the last admin.' };
  }

  await db.delete(users).where(eq(users.id, userId));
  return { ok: true };
}

export async function updateUserRole(
  session: Session | null,
  userId: string,
  newRole: 'admin' | 'member'
): Promise<{ ok: true } | { error: string }> {
  requireAdmin(session);
  const db = getDb();
  if (newRole !== 'admin' && newRole !== 'member') return { error: 'Invalid role.' };

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return { error: 'User not found.' };

  if (target.role === 'admin' && newRole === 'member') {
    const [{ n }] = await db.select({ n: count() }).from(users).where(eq(users.role, 'admin'));
    if (n <= 1) return { error: 'Cannot remove the last admin.' };
  }

  await db.update(users).set({ role: newRole }).where(eq(users.id, userId));
  return { ok: true };
}
