import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  mintShareToken,
  parseShareToken,
  sha256,
  verifyShareSecret,
} from '../src/app/lib/server/share-link-token';

/**
 * Write-capable share links, so the failure modes worth pinning are the ones that would hand write
 * access to someone holding only part of a token — or holding a database dump.
 */

describe('mintShareToken', () => {
  it('stores only a hash, and returns the secret exactly once', () => {
    const minted = mintShareToken();
    const [id, secret] = minted.urlToken.split('.');
    assert.equal(id, minted.id);
    assert.equal(minted.secretHash, sha256(secret));
    // The stored fields must not contain the secret in any form.
    assert.ok(!minted.id.includes(secret));
    assert.ok(!minted.secretHash.includes(secret));
  });

  it('does not repeat itself', () => {
    const ids = new Set<string>();
    const secrets = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const m = mintShareToken();
      ids.add(m.id);
      secrets.add(m.urlToken.split('.')[1]);
    }
    assert.equal(ids.size, 200);
    assert.equal(secrets.size, 200);
  });
});

describe('parseShareToken', () => {
  it('splits a two-part token', () => {
    assert.deepEqual(parseShareToken('abc.def'), { id: 'abc', secret: 'def' });
  });

  it('treats a single-part token as legacy — id only, no secret', () => {
    assert.deepEqual(parseShareToken('legacytoken'), { id: 'legacytoken', secret: null });
  });

  it('rejects malformed tokens rather than guessing', () => {
    // A second dot cannot come from base64url, so it is a malformed token, not a secret containing a
    // dot. Guessing would let one string resolve as two different tokens.
    for (const raw of ['', '   ', '.', 'abc.', '.def', 'a.b.c']) {
      assert.equal(parseShareToken(raw), null, `${JSON.stringify(raw)} should not parse`);
    }
  });

  it('ignores surrounding whitespace from a pasted URL', () => {
    assert.deepEqual(parseShareToken('  abc.def \n'), { id: 'abc', secret: 'def' });
  });
});

describe('verifyShareSecret', () => {
  it('accepts the minted token against its own stored row', () => {
    const minted = mintShareToken();
    const parsed = parseShareToken(minted.urlToken)!;
    assert.equal(verifyShareSecret(parsed, { token: minted.id, tokenHash: minted.secretHash }), true);
  });

  it('rejects the right id with the wrong secret', () => {
    const minted = mintShareToken();
    const other = mintShareToken();
    const forged = parseShareToken(`${minted.id}.${other.urlToken.split('.')[1]}`)!;
    assert.equal(verifyShareSecret(forged, { token: minted.id, tokenHash: minted.secretHash }), false);
  });

  it('rejects a bare id against a hashed row — the id is not a credential', () => {
    // The whole point of the split: `id` is public and appears in logs. Accepting it alone would make
    // a write-capable link out of a log line.
    const minted = mintShareToken();
    assert.equal(
      verifyShareSecret({ id: minted.id, secret: null }, { token: minted.id, tokenHash: minted.secretHash }),
      false
    );
  });

  it('still accepts a legacy single-part token where the token is the secret', () => {
    assert.equal(
      verifyShareSecret({ id: 'legacy-token-value', secret: null }, { token: 'legacy-token-value', tokenHash: null }),
      true
    );
  });

  it('rejects a two-part token against a legacy row instead of accepting its id half', () => {
    assert.equal(
      verifyShareSecret({ id: 'legacy-token-value', secret: 'anything' }, { token: 'legacy-token-value', tokenHash: null }),
      false
    );
  });

  it('rejects a mismatched legacy token', () => {
    assert.equal(verifyShareSecret({ id: 'nope', secret: null }, { token: 'legacy', tokenHash: null }), false);
  });

  it('does not throw on length mismatch (timingSafeEqual would)', () => {
    assert.equal(verifyShareSecret({ id: 'short', secret: null }, { token: 'much-longer-token', tokenHash: null }), false);
    const minted = mintShareToken();
    assert.equal(verifyShareSecret({ id: minted.id, secret: 'x' }, { token: minted.id, tokenHash: minted.secretHash }), false);
  });
});
