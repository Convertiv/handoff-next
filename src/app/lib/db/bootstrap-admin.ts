/**
 * Create the initial admin user when the DB has no users.
 *
 * Usage: `npx tsx src/app/lib/db/bootstrap-admin.ts`
 *
 * Reads HANDOFF_ADMIN_EMAIL and HANDOFF_ADMIN_PASSWORD from .env.
 */
import 'dotenv/config';
import { count } from 'drizzle-orm';
import { hashPassword } from '../passwords';
import { getDb } from './index';
import { users } from './schema';

async function main() {
  const email = process.env.HANDOFF_ADMIN_EMAIL?.trim().toLowerCase();
  const plain = process.env.HANDOFF_ADMIN_PASSWORD;
  if (!email || !plain) {
    console.error('Set HANDOFF_ADMIN_EMAIL and HANDOFF_ADMIN_PASSWORD in your .env');
    process.exit(1);
  }

  const db = getDb();

  const [{ n }] = await db.select({ n: count() }).from(users);
  if ((n ?? 0) > 0) {
    console.log('Users already exist — skipping bootstrap.');
    process.exit(0);
  }

  const passwordHash = await hashPassword(plain);
  await db.insert(users).values({
    email,
    name: email.split('@')[0] || 'Admin',
    role: 'admin',
    passwordHash,
  });

  console.log('Bootstrap admin user created:', email);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
