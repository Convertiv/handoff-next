import { NextResponse, type NextRequest } from 'next/server';
import { checkSitePassword, currentEpoch, getProtectionState } from '@/lib/server/site-protection';
import { issueUnlock, unlockCookieOptions, UNLOCK_COOKIE } from '@/lib/server/unlock-cookie';
import { isRateLimited } from '@/lib/rate-limit';

/**
 * Check the site password and, if it is right, set the unlock cookie (`docs/SITE-PASSWORD.md`).
 *
 * The only unauthenticated write in this feature, and the weakest point in it: one shared secret with no
 * username is guessable in a way a login is not. Hence the limiter and the delay below.
 */

/**
 * Ten attempts a minute per IP.
 *
 * ⚠️ The limiter is **in-memory and per-isolate** (`lib/rate-limit.ts` says so): it slows a burst, it does not
 * bound the damage across instances. Proportionate for a curtain, and explicitly not a claim that this
 * secures anything.
 */
const UNLOCK_LIMIT = { limit: 10, windowMs: 60_000 };

/** Deliberate cost on failure. Cheap for a person typing once, tedious for a script. */
const FAILURE_DELAY_MS = 400;

function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return `site-unlock:${ip}`;
}

export async function POST(request: NextRequest) {
  const state = await getProtectionState();
  /**
   * Nothing to unlock. Answering the same way as a wrong password would be needless mystery — the unlock page
   * is public, so "this site is not protected" is not a secret.
   */
  if (!state.enabled) {
    return NextResponse.json({ error: 'This site is not password protected.' }, { status: 400 });
  }

  if (isRateLimited(clientKey(request), UNLOCK_LIMIT.limit, UNLOCK_LIMIT.windowMs)) {
    return NextResponse.json({ error: 'Too many attempts. Wait a minute and try again.' }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  const password = typeof body.password === 'string' ? body.password : '';

  if (!(await checkSitePassword(password))) {
    await new Promise((resolve) => setTimeout(resolve, FAILURE_DELAY_MS));
    // Never distinguishes "wrong" from anything else. There is only one secret, so there is nothing else to say.
    return NextResponse.json({ error: 'That password did not work.' }, { status: 401 });
  }

  /**
   * Read the epoch straight from the row rather than from `state`, which is cached. A cookie minted against a
   * stale epoch would fail its very next check — the user would type the right password and stay locked out.
   */
  const epoch = await currentEpoch();
  const response = NextResponse.json({ success: true });
  response.cookies.set(UNLOCK_COOKIE, issueUnlock(epoch), unlockCookieOptions());
  return response;
}
