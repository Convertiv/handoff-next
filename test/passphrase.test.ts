import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  MAX_ATTEMPTS,
  clearedLockState,
  generatePassphrase,
  hashPassphrase,
  isLocked,
  lockRemainingMinutes,
  nextLockState,
  normalizePassphrase,
  verifyPassphrase,
} from '../src/app/lib/server/passphrase';

/**
 * Four words is 32 bits — deliberately low, because it has to survive being read aloud. The lockout is what
 * makes that safe, so it is tested as carefully as the hashing.
 */

describe('generatePassphrase', () => {
  it('produces four hyphenated words by default', () => {
    const phrase = generatePassphrase();
    assert.equal(phrase.split('-').length, 4);
    assert.match(phrase, /^[a-z]+(-[a-z]+){3}$/);
  });

  it('does not repeat itself across many draws', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassphrase()));
    // 32 bits: 200 draws colliding would mean the generator is broken, not unlucky.
    assert.equal(seen.size, 200);
  });

  it('draws from the whole list, not a corner of it', () => {
    const words = new Set(Array.from({ length: 2000 }, () => generatePassphrase()).flatMap((p) => p.split('-')));
    assert.ok(words.size > 200, `only ${words.size} distinct words appeared`);
  });
});

describe('normalizePassphrase', () => {
  it('forgives the ways a human retypes one', () => {
    for (const input of ['Amber-Cliff-Ferry-Basil', '  amber-cliff-ferry-basil  ', 'amber cliff ferry basil', 'amber--cliff-ferry-basil']) {
      assert.equal(normalizePassphrase(input), 'amber-cliff-ferry-basil', input);
    }
  });
});

describe('hash / verify', () => {
  it('accepts the right passphrase and rejects a wrong one', () => {
    const stored = hashPassphrase('amber-cliff-ferry-basil');
    assert.equal(verifyPassphrase('amber-cliff-ferry-basil', stored), true);
    assert.equal(verifyPassphrase('amber-cliff-ferry-cumin', stored), false);
  });

  it('accepts a differently-typed version of the same phrase', () => {
    const stored = hashPassphrase('amber-cliff-ferry-basil');
    assert.equal(verifyPassphrase('Amber Cliff Ferry Basil', stored), true);
  });

  it('salts, so the same phrase hashes differently for two links', () => {
    const a = hashPassphrase('amber-cliff-ferry-basil');
    const b = hashPassphrase('amber-cliff-ferry-basil');
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hash, b.hash);
    // …and each still verifies against its own salt.
    assert.equal(verifyPassphrase('amber-cliff-ferry-basil', a), true);
    assert.equal(verifyPassphrase('amber-cliff-ferry-basil', b), true);
  });

  it('never stores the phrase itself', () => {
    const stored = hashPassphrase('amber-cliff-ferry-basil');
    assert.ok(!stored.hash.includes('amber'));
    assert.ok(!stored.salt.includes('amber'));
  });

  it('refuses a link with no passphrase set rather than treating it as open', () => {
    // A link without a passphrase must fail *verification* — whether it needs one is the caller's decision.
    assert.equal(verifyPassphrase('anything', { hash: null, salt: null }), false);
    assert.equal(verifyPassphrase('anything', { hash: 'abc', salt: null }), false);
    assert.equal(verifyPassphrase('', { hash: null, salt: null }), false);
  });
});

describe('lockout', () => {
  it('counts failures without locking below the threshold', () => {
    let state = { attemptCount: 0, lockedUntil: null as Date | null };
    for (let i = 0; i < MAX_ATTEMPTS - 1; i += 1) state = nextLockState(state.attemptCount);
    assert.equal(state.attemptCount, MAX_ATTEMPTS - 1);
    assert.equal(state.lockedUntil, null);
  });

  it('locks at the threshold', () => {
    const now = Date.now();
    let state = { attemptCount: MAX_ATTEMPTS - 1, lockedUntil: null as Date | null };
    state = nextLockState(state.attemptCount, now);
    assert.equal(state.attemptCount, MAX_ATTEMPTS);
    assert.ok(state.lockedUntil && state.lockedUntil.getTime() > now);
  });

  it('doubles the wait per block of failures, capped', () => {
    const now = Date.now();
    const wait = (attempts: number) => {
      const s = nextLockState(attempts - 1, now);
      return s.lockedUntil ? s.lockedUntil.getTime() - now : 0;
    };
    assert.equal(wait(MAX_ATTEMPTS), 5 * 60 * 1000);
    assert.equal(wait(MAX_ATTEMPTS * 2), 10 * 60 * 1000);
    assert.equal(wait(MAX_ATTEMPTS * 3), 20 * 60 * 1000);
    // Capped at an hour, so a determined guesser cannot push the legitimate user out for a day.
    assert.equal(wait(MAX_ATTEMPTS * 20), 60 * 60 * 1000);
  });

  it('is never permanent — a correct passphrase clears the count', () => {
    // The property that matters: an attacker with the link must not be able to permanently deny the recipient.
    assert.deepEqual(clearedLockState(), { attemptCount: 0, lockedUntil: null });
  });

  it('reports lock state against a clock', () => {
    const now = Date.now();
    assert.equal(isLocked(new Date(now + 60_000), now), true);
    assert.equal(isLocked(new Date(now - 1), now), false);
    assert.equal(isLocked(null, now), false);
    assert.equal(isLocked(undefined, now), false);
  });

  it('rounds remaining time up, so "0 minutes" never means "still locked"', () => {
    const now = Date.now();
    assert.equal(lockRemainingMinutes(new Date(now + 1_000), now), 1);
    assert.equal(lockRemainingMinutes(new Date(now + 90_000), now), 2);
    assert.equal(lockRemainingMinutes(null, now), 0);
  });
});
