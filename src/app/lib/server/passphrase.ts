import { randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Memorable passphrases for invite links (see `docs/INVITE-TO-BUILD.md`).
 *
 * A second factor on top of the link secret, because a link gets forwarded in email threads and the secret
 * alone travels with it. Four words from the list below is **32 bits** — deliberately not a lot, and that is
 * the trade: it has to survive being read aloud on a call. What makes it safe is the lockout, not the entropy,
 * so `MAX_ATTEMPTS` and `nextLockState` are as load-bearing as the hash.
 *
 * **`scrypt`, not the SHA-256 used for link secrets.** A 32-byte random token needs a fast comparison; four
 * human-memorable words need a slow one. Node's built-in scrypt means zero new dependencies.
 */

/**
 * 256 short, unambiguous words — 8 bits each.
 *
 * Chosen for reading aloud: no homophones (no "their"/"there"), no words that differ by one letter, nothing
 * that could land badly in a customer's inbox. Length is a power of two so `randomInt` stays unbiased.
 */
const WORDS = [
  'able','acid','acorn','actor','adapt','afar','agile','album','alert','alley','almond','alpha','amber','amble','anchor','angle',
  'apple','april','arbor','arcade','arch','arctic','argon','armor','array','arrow','ash','aspen','atlas','atom','audio','august',
  'auto','avenue','axis','bacon','badge','bagel','baker','balcony','bamboo','banjo','barley','basil','basin','batch','beacon','beam',
  'bean','bench','berry','beta','birch','bison','blade','blend','blink','block','bloom','blue','board','bolt','bonus','book',
  'boost','borax','bottle','boulder','bowl','brave','bread','brick','bridge','brisk','bronze','brook','brush','bubble','buffet','bulb',
  'bundle','bunny','burst','cabin','cable','cacao','cactus','cadet','camel','camp','canal','candle','canoe','canvas','canyon','cargo',
  'carrot','carve','castle','cedar','cello','census','chalk','charm','cheese','cherry','chess','chili','chime','cider','cinema','circus',
  'citrus','clamp','clay','clever','cliff','cloak','clock','cloud','clover','cobalt','cocoa','coffee','coin','comet','compass','coral',
  'cork','corn','cosmos','cotton','coupon','crane','crate','crayon','cream','creek','crisp','crown','cube','cumin','curl','cycle',
  'daisy','dance','dawn','deck','delta','denim','desert','diary','diesel','dial','dime','dinner','dolphin','domino','donut','dove',
  'dragon','drift','drum','dune','dusk','eagle','east','echo','eclair','edge','eight','elbow','elder','elm','ember','emerald',
  'engine','envoy','epoch','equal','ethos','exit','fable','fabric','falcon','fancy','fawn','feather','fence','fern','ferry','fiber',
  'fiddle','fig','filter','finch','fjord','flame','flask','fleet','flint','float','flour','flute','foam','forest','forge','fossil',
  'fox','frame','frost','fudge','fuel','gadget','galaxy','garlic','gauge','gazebo','gecko','gemini','ginger','glacier','glass','glide',
  'globe','glory','goblet','gold','gopher','gorge','granite','grape','gravel','green','grid','grotto','guitar','gulf','gumbo','gusto',
  'gyro','hammer','hangar','harbor','harvest','hazel','heather','helium','helm','herald','hickory','hollow','honey','hoop','horizon','hornet',
] as const;

/** Failed attempts before a link locks. */
export const MAX_ATTEMPTS = 10;
/** First lockout, then doubling per subsequent block of failures. */
const BASE_LOCK_MS = 5 * 60 * 1000;
const MAX_LOCK_MS = 60 * 60 * 1000;

export function generatePassphrase(words = 4): string {
  return Array.from({ length: words }, () => WORDS[randomInt(WORDS.length)]).join('-');
}

/** Normalized before hashing so "Amber-Cliff " and "amber-cliff" are the same secret to a tired human. */
export function normalizePassphrase(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-').replace(/-+/g, '-');
}

export interface PassphraseHash {
  hash: string;
  salt: string;
}

export function hashPassphrase(passphrase: string, salt?: string): PassphraseHash {
  const useSalt = salt ?? randomBytesHex(16);
  const derived = scryptSync(normalizePassphrase(passphrase), useSalt, 32).toString('hex');
  return { hash: derived, salt: useSalt };
}

export function verifyPassphrase(input: string, stored: { hash: string | null; salt: string | null }): boolean {
  if (!stored.hash || !stored.salt) return false;
  const { hash } = hashPassphrase(input, stored.salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(stored.hash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function randomBytesHex(bytes: number): string {
  let out = '';
  for (let i = 0; i < bytes; i += 1) out += randomInt(256).toString(16).padStart(2, '0');
  return out;
}

/* -------------------------------------------------------------------------- */
/* Lockout                                                                    */
/* -------------------------------------------------------------------------- */

export interface LockState {
  attemptCount: number;
  lockedUntil: Date | null;
}

export function isLocked(lockedUntil: Date | null | undefined, now = Date.now()): boolean {
  return lockedUntil != null && lockedUntil.getTime() > now;
}

/**
 * The state after one more failure.
 *
 * **Temporary and resettable, never a permanent ban.** A permanent lock would let anyone with the link deny
 * access to its legitimate recipient with ten wrong guesses — the attacker's goal becomes trivially reachable
 * instead of merely hard. Locks double per block of failures up to an hour, and a correct passphrase clears
 * the count entirely.
 */
export function nextLockState(attemptCount: number, now = Date.now()): LockState {
  const attempts = attemptCount + 1;
  if (attempts < MAX_ATTEMPTS) return { attemptCount: attempts, lockedUntil: null };

  // Every full block of MAX_ATTEMPTS failures doubles the wait: 5m, 10m, 20m… capped at an hour.
  const blocks = Math.floor(attempts / MAX_ATTEMPTS);
  const wait = Math.min(BASE_LOCK_MS * 2 ** (blocks - 1), MAX_LOCK_MS);
  return { attemptCount: attempts, lockedUntil: new Date(now + wait) };
}

/** After a correct passphrase. Clearing the count is what makes the lock a speed bump, not a trap. */
export function clearedLockState(): LockState {
  return { attemptCount: 0, lockedUntil: null };
}

/** How long until this lock expires, for a message a human can act on. */
export function lockRemainingMinutes(lockedUntil: Date | null | undefined, now = Date.now()): number {
  if (!isLocked(lockedUntil, now)) return 0;
  return Math.max(1, Math.ceil((lockedUntil!.getTime() - now) / 60000));
}
