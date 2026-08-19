/**
 * Who gets past the site password, and who is sent to the unlock page (`docs/SITE-PASSWORD.md` §5).
 *
 * Pure and dependency-free so the rule can be tested exhaustively without a database, a request or a cookie —
 * the same split as `decidePatternMetaChange` and `decideRename`. This is the highest-consequence `if` in the
 * feature: too strict and the canvas, the guest flow or sign-in break; too loose and the curtain is decorative.
 */

/**
 * Paths that must render even when the curtain is down.
 *
 * ⚠️ Every entry here is load-bearing. Read the reasons before removing one.
 */
export const GATE_EXEMPT_PREFIXES = [
  /**
   * The gate itself. Without this the redirect target is also gated and the app redirects forever.
   */
  '/unlock',
  /**
   * Signing in must not require the shared secret. A person with a real account has a *stronger* credential
   * than the curtain; making them type a shared password first would be backwards, and would mean handing the
   * curtain password to everyone who has an account anyway.
   */
  '/login',
  '/reset-password',
  /** First-run admin creation. A deployment with no users has nobody who could have set a password. */
  '/setup',
  /**
   * **Guest share links bypass the curtain** (Brad, 2026-08-14).
   *
   * A share link is already a bearer credential: high-entropy, scoped to one template, revocable, rate-limited,
   * capped at 50 pages and optionally passphrase-protected. Requiring the site password on top makes every
   * invitation a two-secret handover — the exact friction the passphrase default was changed to remove — and
   * puts a wall in front of the one flow whose whole point is handing work to somebody with no account.
   */
  '/s/',
] as const;

/**
 * Paths that never reach this decision at all, listed for the tests rather than for the runtime.
 *
 * The gate lives in the root layout, which API routes, `_next` and static assets do not render — so they are
 * exempt structurally rather than by allowlist. That is deliberate and is what keeps the preview canvas
 * working: its iframe is opaque-origin, so its requests for `/api/component/*.css`, `/assets/js/preview.js`
 * and `/api/registry/theme.css` carry **no cookies** and could never satisfy a gate. Blocking them is exactly
 * the Vercel Deployment Protection failure this feature exists to escape.
 */
export const STRUCTURALLY_EXEMPT_PREFIXES = ['/api', '/_next', '/assets', '/favicon.ico'] as const;

export interface GateInput {
  pathname: string;
  /** Protection configured *and* switched on. A deployment with no row reads as false. */
  enabled: boolean;
  /** Whether the visitor is signed in. A session outranks the curtain. */
  hasSession: boolean;
  /** Whether a valid, unexpired unlock cookie at the current epoch was presented. */
  unlocked: boolean;
}

export type GateDecision =
  | { gate: false; reason: 'disabled' | 'exempt' | 'session' | 'unlocked' }
  | { gate: true };

/**
 * Whether this path is exempt regardless of everything else. Exported for the unlock page's own guard.
 *
 * Matches on **segment boundaries**, not raw prefixes: a bare `startsWith` would exempt `/setupsomething` on
 * the strength of `/setup`, which is how an allowlist quietly grows holes as routes are added. A prefix that
 * already ends in `/` — like `/s/` — is taken as written, which is what keeps `/system` gated.
 */
export function isExemptPath(pathname: string): boolean {
  // `x-pathname` carries no query string today, but a caller passing one should not change the answer.
  const path = pathname.split(/[?#]/)[0];
  return [...GATE_EXEMPT_PREFIXES, ...STRUCTURALLY_EXEMPT_PREFIXES].some((prefix) =>
    prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix || path.startsWith(`${prefix}/`)
  );
}

/**
 * The decision.
 *
 * Order matters and is deliberate: `disabled` first, so the common case costs nothing and a misconfigured
 * exemption cannot lock a deployment that never wanted protection; then path exemptions, so the unlock page
 * and sign-in are reachable even to somebody with neither credential.
 */
export function decideGate(input: GateInput): GateDecision {
  if (!input.enabled) return { gate: false, reason: 'disabled' };
  if (isExemptPath(input.pathname)) return { gate: false, reason: 'exempt' };
  if (input.hasSession) return { gate: false, reason: 'session' };
  if (input.unlocked) return { gate: false, reason: 'unlocked' };
  return { gate: true };
}
