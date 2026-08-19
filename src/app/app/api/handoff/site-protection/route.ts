import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getProtectionState,
  lockEveryoneOut,
  setProtectionEnabled,
  setProtectionHint,
  setSitePassword,
} from '@/lib/server/site-protection';

/**
 * Reading and changing the site password settings (`docs/SITE-PASSWORD.md` §7). Admin only, both verbs.
 *
 * Note what this cannot return: `getProtectionState` projects `enabled`, `configured`, `hint` and `epoch` and
 * has no access to the hash, so no widening of this response can leak the password. That is the reason the
 * shape exists rather than returning the row.
 */

/** Short, because it is typed once and shared by voice or chat. Long enough not to be guessed in ten tries. */
const MIN_PASSWORD_LENGTH = 8;

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (session.user.role !== 'admin') {
    return { error: NextResponse.json({ error: 'Admins only.' }, { status: 403 }) };
  }
  return { userId: session.user.id };
}

export async function GET() {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;
  return NextResponse.json(await getProtectionState());
}

export async function PUT(request: NextRequest) {
  const gate = await requireAdmin();
  if (gate.error) return gate.error;

  const body = (await request.json().catch(() => ({}))) as {
    enabled?: unknown;
    password?: unknown;
    hint?: unknown;
    lockEveryoneOut?: unknown;
  };

  /**
   * Password first, so that "enable it and set the password" in one request cannot switch the curtain on
   * before there is a secret to open it with.
   */
  if (typeof body.password === 'string' && body.password.length > 0) {
    if (body.password.trim().length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        { error: `Use at least ${MIN_PASSWORD_LENGTH} characters.` },
        { status: 400 }
      );
    }
    await setSitePassword(body.password, gate.userId!);
  }

  if (typeof body.hint === 'string' || body.hint === null) {
    await setProtectionHint(typeof body.hint === 'string' ? body.hint : null, gate.userId!);
  }

  if (typeof body.enabled === 'boolean') {
    /**
     * Refuse to switch on a curtain with no password behind it. The state would look protected in the admin
     * screen while `getProtectionState` reports disabled — a disagreement nobody would find until they were
     * relying on it.
     */
    const state = await getProtectionState();
    if (body.enabled && !state.configured && typeof body.password !== 'string') {
      return NextResponse.json({ error: 'Set a password before turning protection on.' }, { status: 400 });
    }
    await setProtectionEnabled(body.enabled, gate.userId!);
  }

  if (body.lockEveryoneOut === true) {
    await lockEveryoneOut(gate.userId!);
  }

  return NextResponse.json(await getProtectionState());
}
