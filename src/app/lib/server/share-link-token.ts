import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Share-link tokens: minting, parsing and verification.
 *
 * **Why the shape changed.** A read-only share link could get away with storing its token in plaintext
 * as the primary key — leaking the table leaks read access to a safe field subset. A *write-capable*
 * link is a different bet, so the URL now carries two parts:
 *
 *     /s/<id>.<secret>
 *
 * `id` is a non-secret handle used for lookup (still the primary key, still indexable), and only
 * `sha256(secret)` is stored. A database read no longer yields usable links. This is the ordinary
 * API-key shape — an id to find the row, a secret to prove you hold it — and it is why lookup can stay
 * a single indexed query instead of scanning and hashing every row.
 *
 * **Legacy links keep working.** Rows written before this (no `tokenHash`) treat `token` as the secret
 * itself and are compared directly. `verifyShareSecret` handles both, so nothing has to be migrated and
 * existing read-only viewer URLs don't break.
 *
 * No database import: pure crypto, so the verification logic is unit-testable.
 */

/** Bytes of entropy in a link secret. 32 bytes ≈ 43 base64url chars — not guessable, still pasteable. */
const SECRET_BYTES = 32;
/** Bytes in the public id. Only needs to be collision-resistant, not secret. */
const ID_BYTES = 12;

export interface MintedShareToken {
  /** Stored as `handoff_share_link.token` — the lookup handle. Safe to log. */
  id: string;
  /** Stored as `handoff_share_link.token_hash`. */
  secretHash: string;
  /**
   * The full `<id>.<secret>` string for the URL. Returned exactly once, at creation — it is never
   * recoverable afterwards, which is the point of hashing.
   */
  urlToken: string;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function mintShareToken(): MintedShareToken {
  const id = randomBytes(ID_BYTES).toString('base64url');
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { id, secretHash: sha256(secret), urlToken: `${id}.${secret}` };
}

export interface ParsedShareToken {
  id: string;
  /** Null for a legacy single-part token, where the whole string is both handle and secret. */
  secret: string | null;
}

/**
 * Split a URL token into its lookup id and secret.
 *
 * A single-part token is a legacy link: id and secret are the same string. Splitting on the *first*
 * dot only — base64url never produces a dot, so a second one means a malformed token, and treating the
 * remainder as the secret keeps that from silently becoming a different valid token.
 */
export function parseShareToken(raw: string): ParsedShareToken | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const dot = trimmed.indexOf('.');
  if (dot === -1) return { id: trimmed, secret: null };

  const id = trimmed.slice(0, dot);
  const secret = trimmed.slice(dot + 1);
  if (!id || !secret || secret.includes('.')) return null;
  return { id, secret };
}

/** Constant-time string compare that tolerates length mismatch without throwing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on unequal lengths, and the lengths here are hex digests or opaque tokens —
  // a length difference is not a secret, so comparing it first is safe.
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Does `parsed` prove possession of the stored link?
 *
 * The two shapes are kept strictly apart, deliberately:
 * - stored hash present → the presented token MUST have a secret part, hashed and compared. A
 *   single-part token can never satisfy a hashed row.
 * - stored hash absent (legacy) → the presented id must equal the stored token, and a token that
 *   arrives with a secret part is rejected rather than having its id half accepted.
 */
export function verifyShareSecret(
  parsed: ParsedShareToken,
  stored: { token: string; tokenHash: string | null }
): boolean {
  if (stored.tokenHash) {
    if (parsed.secret == null) return false;
    return safeEqual(sha256(parsed.secret), stored.tokenHash);
  }
  if (parsed.secret != null) return false;
  return safeEqual(parsed.id, stored.token);
}
