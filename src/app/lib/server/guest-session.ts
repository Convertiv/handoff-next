import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The guest authoring session — how a link-bearer resumes the draft they started.
 *
 * A signed cookie, not a database session, and it carries the *minimum*: which link admitted them,
 * which submission is theirs, and the name they gave. See `docs/GUEST-AUTHORING.md`.
 *
 * **Capabilities are deliberately NOT in the cookie.** They are re-read from the link row on every
 * request, so revoking or expiring a link takes effect immediately instead of whenever the last issued
 * cookie happens to lapse. A cookie that carried its own permissions would be an offline credential
 * nobody could take back.
 *
 * **The link secret is not in the cookie either.** The cookie *is* the session credential once the
 * secret has been presented at the door; re-storing the secret would put it somewhere it can be read
 * again for no gain.
 *
 * **One cookie per link** (`handoff_guest_<linkId>`), which is what makes two links in one browser
 * independent — and is the mechanism behind "each recipient iterates on their own copy". The unit of
 * identity here is a browser, not a person: same person on two devices is two drafts, two people in one
 * browser profile is one. That is inherent to authoring without accounts, and the review queue shows
 * the self-declared name precisely because the session cannot vouch for who anyone is.
 *
 * No database or `next/headers` import: pure crypto, so signing and verification are unit-testable.
 */

/** Bumped if the payload shape changes; an unknown version fails verification rather than half-parsing. */
const VERSION = 1;

/** Session lifetime, capped further by the link's own expiry — a session can't outlive its link. */
export const GUEST_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface GuestSession {
  /** Public link id (never the secret). */
  linkId: string;
  /** The submission this guest is iterating on. Null until they create one. */
  submissionId: string | null;
  /** Self-declared, unverified display name. */
  name: string;
  /**
   * Optional email the builder gave, so they can be told what happens to their submission. Unverified —
   * collected with a visible note that we will use it, never treated as identity or access.
   */
  email?: string | null;
  /** Expiry, epoch ms. */
  exp: number;
}

export function guestCookieName(linkId: string): string {
  return `handoff_guest_${linkId}`;
}

function signingSecret(): string {
  const secret = (process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? '').trim();
  if (!secret) {
    // Failing loudly beats signing with a default: an empty key would make every guest cookie forgeable.
    throw new Error('AUTH_SECRET (or NEXTAUTH_SECRET) must be set to issue guest sessions.');
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Longest a guest name may be. Long enough to be recognizable, short enough not to be a payload. */
const MAX_NAME = 80;

export function sanitizeGuestName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Control characters stripped: this string is rendered in the review queue, and newlines in a
  // "submitted by" column are a display bug at best.
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_NAME);
}

/**
 * Issue a session token. `maxExp` is the link's own expiry when it has one, so the session cannot
 * outlive the link that justified it.
 */
export function issueGuestSession(
  input: { linkId: string; submissionId?: string | null; name: string; email?: string | null },
  opts: { now?: number; maxExp?: number | null } = {}
): { token: string; session: GuestSession } {
  const now = opts.now ?? Date.now();
  const wanted = now + GUEST_SESSION_TTL_MS;
  const exp = opts.maxExp != null ? Math.min(wanted, opts.maxExp) : wanted;

  const session: GuestSession = {
    linkId: input.linkId,
    submissionId: input.submissionId ?? null,
    name: sanitizeGuestName(input.name),
    email: input.email?.trim() ? input.email.trim().slice(0, 200) : null,
    exp,
  };
  const payload = Buffer.from(JSON.stringify({ v: VERSION, ...session }), 'utf8').toString('base64url');
  return { token: `${payload}.${sign(payload)}`, session };
}

/**
 * Verify a session token and return its payload, or null.
 *
 * `expectedLinkId` is required rather than optional: the cookie is named per link, but a client controls
 * cookie names, so a session minted for one link must not be accepted while acting on another.
 */
export function readGuestSession(
  token: string | undefined | null,
  expectedLinkId: string,
  opts: { now?: number } = {}
): GuestSession | null {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!signature || !safeEqual(sign(payload), signature)) return null;

  let parsed: (GuestSession & { v?: number }) | null = null;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== VERSION) return null;
  if (typeof parsed.linkId !== 'string' || parsed.linkId !== expectedLinkId) return null;
  if (typeof parsed.exp !== 'number' || parsed.exp <= (opts.now ?? Date.now())) return null;

  return {
    linkId: parsed.linkId,
    submissionId: typeof parsed.submissionId === 'string' ? parsed.submissionId : null,
    name: sanitizeGuestName(parsed.name),
    email: typeof parsed.email === 'string' && parsed.email ? parsed.email : null,
    exp: parsed.exp,
  };
}

/** Cookie attributes for a guest session. Path `/` because the authoring UI and its API both need it. */
export function guestCookieOptions(exp: number, now = Date.now()) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.max(0, Math.floor((exp - now) / 1000)),
  };
}
