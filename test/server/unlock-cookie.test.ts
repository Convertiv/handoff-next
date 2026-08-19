import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

/** `server-only`, so this lives under test/server — see `npm run test:unit:server`. */
process.env.AUTH_SECRET ??= 'test-secret-for-unlock-cookie';

let issueUnlock: typeof import('../../src/app/lib/server/unlock-cookie').issueUnlock;
let readUnlock: typeof import('../../src/app/lib/server/unlock-cookie').readUnlock;
let UNLOCK_TTL_MS: number;

before(async () => {
  const mod = await import('../../src/app/lib/server/unlock-cookie');
  ({ issueUnlock, readUnlock, UNLOCK_TTL_MS } = mod);
});

describe('unlock cookie', () => {
  const now = 1_700_000_000_000;

  it('round-trips at the epoch it was issued for', () => {
    assert.equal(readUnlock(issueUnlock(3, now), 3, now + 1000), true);
  });

  it('stops working when the epoch moves — this is what rotating the password does', () => {
    const cookie = issueUnlock(3, now);
    assert.equal(readUnlock(cookie, 4, now + 1000), false, 'a rotated password must evict existing holders');
  });

  it('does not accept an older cookie replayed against a newer epoch, or vice versa', () => {
    assert.equal(readUnlock(issueUnlock(5, now), 4, now + 1000), false);
  });

  it('expires', () => {
    const cookie = issueUnlock(1, now);
    assert.equal(readUnlock(cookie, 1, now + UNLOCK_TTL_MS - 1000), true);
    assert.equal(readUnlock(cookie, 1, now + UNLOCK_TTL_MS + 1000), false);
  });

  it('rejects a forged signature', () => {
    const parts = issueUnlock(1, now).split('.');
    parts[3] = 'forged';
    assert.equal(readUnlock(parts.join('.'), 1, now), false);
  });

  it('rejects an edited epoch even though the rest is intact', () => {
    const parts = issueUnlock(1, now).split('.');
    parts[1] = '2';
    assert.equal(readUnlock(parts.join('.'), 2, now), false, 'the signature covers the epoch');
  });

  it('rejects an extended expiry', () => {
    const parts = issueUnlock(1, now).split('.');
    parts[2] = String(now + 10 * UNLOCK_TTL_MS);
    assert.equal(readUnlock(parts.join('.'), 1, now), false);
  });

  it('fails closed on junk', () => {
    for (const bad of [null, undefined, '', 'nope', 'v1.1.1', 'v2.1.1.sig']) {
      assert.equal(readUnlock(bad, 1, now), false, String(bad));
    }
  });
});
