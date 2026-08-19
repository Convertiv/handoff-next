import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideGate, isExemptPath, GATE_EXEMPT_PREFIXES } from '../src/app/lib/site-gate';

const base = { pathname: '/library', enabled: true, hasSession: false, unlocked: false };

describe('decideGate', () => {
  it('gates an ordinary page when protection is on and the visitor has nothing', () => {
    assert.deepEqual(decideGate(base), { gate: true });
  });

  it('does nothing at all when protection is off', () => {
    assert.deepEqual(decideGate({ ...base, enabled: false }), { gate: false, reason: 'disabled' });
  });

  it('lets a signed-in user through — a session outranks a shared secret', () => {
    assert.deepEqual(decideGate({ ...base, hasSession: true }), { gate: false, reason: 'session' });
  });

  it('lets an unlocked visitor through', () => {
    assert.deepEqual(decideGate({ ...base, unlocked: true }), { gate: false, reason: 'unlocked' });
  });
});

describe('exemptions', () => {
  it('never gates the unlock page — that would be an infinite redirect', () => {
    assert.deepEqual(decideGate({ ...base, pathname: '/unlock' }), { gate: false, reason: 'exempt' });
    assert.deepEqual(decideGate({ ...base, pathname: '/unlock?next=%2Flibrary' }), {
      gate: false,
      reason: 'exempt',
    });
  });

  it('never gates sign-in: an account holder should not need the shared password', () => {
    for (const p of ['/login', '/login?callbackUrl=/admin', '/reset-password', '/setup']) {
      assert.deepEqual(decideGate({ ...base, pathname: p }), { gate: false, reason: 'exempt' }, p);
    }
  });

  it('never gates a guest share link — the link is its own credential', () => {
    assert.deepEqual(decideGate({ ...base, pathname: '/s/abc123' }), { gate: false, reason: 'exempt' });
  });

  it('leaves the preview canvas alone: its iframe is opaque-origin and sends no cookies', () => {
    for (const p of [
      '/api/component/main.css',
      '/api/component/hero-client.mjs',
      '/assets/css/preview.css',
      '/assets/js/preview.js',
      '/api/registry/theme.css',
      '/_next/static/chunk.js',
    ]) {
      assert.deepEqual(decideGate({ ...base, pathname: p }), { gate: false, reason: 'exempt' }, p);
    }
  });

  it('matches on segment boundaries, not raw prefixes', () => {
    // The failure this prevents: '/setup' exempting '/setupanything', and '/s/' exempting '/system'.
    for (const p of ['/system', '/setupsomething-else', '/logins', '/unlocked-pages', '/assetsomething']) {
      assert.deepEqual(decideGate({ ...base, pathname: p }), { gate: true }, p);
    }
  });

  it('ignores a query string when deciding', () => {
    assert.deepEqual(decideGate({ ...base, pathname: '/library?page=2' }), { gate: true });
    assert.deepEqual(decideGate({ ...base, pathname: '/login?callbackUrl=%2Fadmin' }), {
      gate: false,
      reason: 'exempt',
    });
  });

  it('gates the ordinary app surfaces', () => {
    for (const p of ['/', '/library', '/playground/page-abc', '/admin', '/system/component/hero', '/review']) {
      assert.deepEqual(decideGate({ ...base, pathname: p }), { gate: true }, p);
    }
  });

  it('isExemptPath agrees with the decision for every declared prefix', () => {
    for (const prefix of GATE_EXEMPT_PREFIXES) {
      assert.equal(isExemptPath(prefix), true, prefix);
    }
  });

  it('checks disabled before exemptions, so a disabled site reports disabled', () => {
    assert.deepEqual(decideGate({ ...base, enabled: false, pathname: '/unlock' }), {
      gate: false,
      reason: 'disabled',
    });
  });
});
