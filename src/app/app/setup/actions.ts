'use server';

import { redirect } from 'next/navigation';
import { hashPassword } from '../../lib/passwords';
import { getDb } from '../../lib/db';
import { getUserCount } from '../../lib/db/queries';
import { users } from '../../lib/db/schema';

export type SetupResult = { error: string } | null;

export async function createFirstAdmin(_prevState: SetupResult, formData: FormData): Promise<SetupResult> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (!email || !email.includes('@')) return { error: 'A valid email address is required.' };
  if (password.length < 8) return { error: 'Password must be at least 8 characters.' };
  if (password !== confirm) return { error: 'Passwords do not match.' };

  // Safety check: only allow setup when no users exist
  const existing = await getUserCount();
  if (existing > 0) return { error: 'Registry is already configured. Sign in to continue.' };

  const db = getDb();
  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    email,
    name: email.split('@')[0],
    role: 'admin',
    passwordHash,
    emailVerified: new Date(),
  });

  redirect('/login?setup=1');
}
