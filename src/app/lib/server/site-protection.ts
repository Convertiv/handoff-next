import 'server-only';

import { eq } from 'drizzle-orm';
import { unstable_cache, revalidateTag } from 'next/cache';
import { getDb } from '../db';
import { handoffSiteProtection } from '../db/schema-active';
import { hashPassword, verifyPassword } from '../passwords';

/**
 * Reading and changing the site password (`docs/SITE-PASSWORD.md`).
 *
 * The hash never leaves this module. `getProtectionStatus` is the only shape anything else may see, and it
 * carries no secret — which is what makes it safe for the admin screen and impossible to leak by widening a
 * response.
 */

const ROW_ID = 'default';
const TAG = 'site-protection';
/** Next 16 wants a cache-life profile; 'max' means no time-based expiry, purge on demand. */
const PURGE = 'max';

export interface ProtectionState {
  enabled: boolean;
  /** Whether a password has ever been set. Never the hash, never the password. */
  configured: boolean;
  hint: string | null;
  epoch: number;
}

const DISABLED: ProtectionState = { enabled: false, configured: false, hint: null, epoch: 1 };

/**
 * The gate reads this on every page render, so it is cached and purged on write rather than queried per
 * request — the same idiom as `registry-cache.ts`.
 *
 * **Fails open, deliberately.** If the database is unreachable this returns "disabled" rather than throwing,
 * so a transient outage cannot lock every visitor — including the admins — out of the whole deployment behind
 * a password nobody can now verify. A curtain that fails closed is a curtain that becomes an outage.
 */
export const getProtectionState = unstable_cache(
  async (): Promise<ProtectionState> => {
    try {
      const db = getDb();
      const [row] = await db
        .select()
        .from(handoffSiteProtection)
        .where(eq(handoffSiteProtection.id, ROW_ID))
        .limit(1);
      if (!row) return DISABLED;
      return {
        // Enabled but never configured is not protection — it is a locked door with no key cut.
        enabled: row.enabled && Boolean(row.passwordHash),
        configured: Boolean(row.passwordHash),
        hint: row.hint,
        epoch: row.epoch,
      };
    } catch {
      return DISABLED;
    }
  },
  ['site-protection-state'],
  { tags: [TAG] }
);

function revalidate(): void {
  revalidateTag(TAG, PURGE);
}

/** Check a submitted password. False whenever protection is off or unconfigured — never "anything matches". */
export async function checkSitePassword(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const db = getDb();
  const [row] = await db
    .select({ enabled: handoffSiteProtection.enabled, passwordHash: handoffSiteProtection.passwordHash })
    .from(handoffSiteProtection)
    .where(eq(handoffSiteProtection.id, ROW_ID))
    .limit(1);
  if (!row?.enabled || !row.passwordHash) return false;
  return verifyPassword(candidate, row.passwordHash);
}

async function upsert(values: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select({ id: handoffSiteProtection.id })
    .from(handoffSiteProtection)
    .where(eq(handoffSiteProtection.id, ROW_ID))
    .limit(1);
  if (existing) {
    await db.update(handoffSiteProtection).set(values).where(eq(handoffSiteProtection.id, ROW_ID));
  } else {
    await db.insert(handoffSiteProtection).values({ id: ROW_ID, ...values });
  }
  revalidate();
}

/**
 * Set or replace the password.
 *
 * **Always bumps `epoch`**, which evicts every existing unlock cookie. Rotating a password without evicting
 * the people who knew the old one achieves nothing, and that is the whole reason someone rotates it.
 */
export async function setSitePassword(password: string, actorId: string | null): Promise<void> {
  const current = await readEpoch();
  await upsert({
    passwordHash: await hashPassword(password),
    epoch: current + 1,
    updatedAt: new Date(),
    updatedBy: actorId,
  });
}

/**
 * Turn the curtain on or off. Does **not** touch `epoch`: disabling and re-enabling is not a rotation, and
 * silently evicting everyone on a toggle would be a surprise.
 */
export async function setProtectionEnabled(enabled: boolean, actorId: string | null): Promise<void> {
  await upsert({ enabled, updatedAt: new Date(), updatedBy: actorId });
}

export async function setProtectionHint(hint: string | null, actorId: string | null): Promise<void> {
  await upsert({ hint: hint?.trim() || null, updatedAt: new Date(), updatedBy: actorId });
}

/** "Lock everyone out now" — a rotation of the cookie epoch with the password left alone. */
export async function lockEveryoneOut(actorId: string | null): Promise<void> {
  const current = await readEpoch();
  await upsert({ epoch: current + 1, updatedAt: new Date(), updatedBy: actorId });
}

/** Read straight through, not through the cache: a stale epoch here would issue cookies that never validate. */
async function readEpoch(): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ epoch: handoffSiteProtection.epoch })
    .from(handoffSiteProtection)
    .where(eq(handoffSiteProtection.id, ROW_ID))
    .limit(1);
  return row?.epoch ?? 1;
}

/** The current epoch, for minting a cookie right after a successful unlock. */
export async function currentEpoch(): Promise<number> {
  return readEpoch();
}
