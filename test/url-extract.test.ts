import assert from 'node:assert';
import { describe, it } from 'node:test';
import { normalizeUrl } from '../src/app/lib/url-safety';

/**
 * This makes the SERVER fetch a URL the user typed, so it is an SSRF surface: without these checks a
 * user could reach anything the deployment can reach but they cannot — localhost, cloud metadata,
 * internal services.
 */
describe('normalizeUrl', () => {
  it('adds https when the scheme is missing', () => {
    assert.equal(normalizeUrl('example.com/pricing'), 'https://example.com/pricing');
  });

  it('keeps an explicit scheme', () => {
    assert.equal(normalizeUrl('http://example.com/'), 'http://example.com/');
  });

  it('refuses non-http schemes', () => {
    for (const u of ['file:///etc/passwd', 'ftp://example.com', 'gopher://example.com']) {
      assert.throws(() => normalizeUrl(u), /Only http and https|does not look like a URL/, u);
    }
  });

  it('refuses loopback and localhost', () => {
    for (const u of ['http://localhost:3000', 'http://127.0.0.1', 'http://app.localhost']) {
      assert.throws(() => normalizeUrl(u), /not reachable from here/, u);
    }
  });

  it('refuses private ranges', () => {
    for (const u of ['http://10.0.0.5', 'http://192.168.1.1', 'http://172.16.0.9', 'http://172.31.255.1']) {
      assert.throws(() => normalizeUrl(u), /not reachable from here/, u);
    }
  });

  it('refuses the cloud metadata address', () => {
    // 169.254.169.254 is the one that leaks instance credentials.
    assert.throws(() => normalizeUrl('http://169.254.169.254/latest/meta-data/'), /not reachable from here/);
  });

  it('refuses internal-looking hostnames', () => {
    for (const u of ['http://db.internal', 'http://printer.local']) {
      assert.throws(() => normalizeUrl(u), /not reachable from here/, u);
    }
  });

  it('allows ordinary public URLs', () => {
    assert.doesNotThrow(() => normalizeUrl('https://8x8.com/pricing'));
    // A public IP that merely starts with 17 must not be caught by the 172.16/12 rule.
    assert.doesNotThrow(() => normalizeUrl('http://172.15.0.1'));
    assert.doesNotThrow(() => normalizeUrl('http://172.32.0.1'));
  });
});
