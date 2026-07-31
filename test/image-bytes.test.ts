import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  assetIdForBytes,
  contentHashForBytes,
  decodeImageDataUrl,
  extensionForMimeType,
  isStorableImageMimeType,
  shouldReencodeToWebp,
} from '../src/app/lib/image-bytes';

const png = (payload: string) => `data:image/png;base64,${Buffer.from(payload).toString('base64')}`;

/**
 * The boundary between "an image model returned a string" and "there is a file in the asset library".
 * Everything downstream trusts the output, so the checks live here.
 */
describe('decodeImageDataUrl', () => {
  it('decodes what openAiImageEdit actually returns', () => {
    const decoded = decodeImageDataUrl(png('hello'));
    assert.ok(decoded);
    assert.equal(decoded.mimeType, 'image/png');
    assert.equal(decoded.bytes.toString(), 'hello');
  });

  it('accepts jpeg and webp, the other two we store', () => {
    for (const type of ['image/jpeg', 'image/webp']) {
      const decoded = decodeImageDataUrl(`data:${type};base64,${Buffer.from('x').toString('base64')}`);
      assert.equal(decoded?.mimeType, type);
    }
  });

  it('tolerates the casing and whitespace real payloads arrive with', () => {
    const b64 = Buffer.from('hello').toString('base64');
    assert.equal(decodeImageDataUrl(`DATA:IMAGE/PNG;BASE64,${b64}`)?.bytes.toString(), 'hello');
    assert.equal(decodeImageDataUrl(`  ${png('hello')}  `)?.bytes.toString(), 'hello');
  });

  it('refuses SVG, which would be a stored XSS on a public-read bucket', () => {
    const svg = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
    assert.equal(decodeImageDataUrl(`data:image/svg+xml;base64,${svg}`), null);
  });

  it('refuses non-image types outright', () => {
    assert.equal(decodeImageDataUrl(`data:text/html;base64,${Buffer.from('<b>').toString('base64')}`), null);
    assert.equal(decodeImageDataUrl(`data:application/pdf;base64,${Buffer.from('%PDF').toString('base64')}`), null);
  });

  it('returns null rather than throwing for anything unusable', () => {
    // A job that cannot decode should be recorded as failed, not unwind the worker.
    for (const bad of [null, undefined, 42, {}, '', 'not a data url', 'https://example.com/a.png']) {
      assert.equal(decodeImageDataUrl(bad), null);
    }
  });

  it('rejects an empty payload, which is what a truncated response looks like', () => {
    assert.equal(decodeImageDataUrl('data:image/png;base64,'), null);
  });

  it('handles a line-wrapped payload, which is how they arrive over the wire', () => {
    const b64 = Buffer.from('hello there friend').toString('base64');
    const wrapped = `data:image/png;base64,${b64.slice(0, 8)}\n${b64.slice(8)}`;
    assert.equal(decodeImageDataUrl(wrapped)?.bytes.toString(), 'hello there friend');
  });

  it('rejects a mangled payload instead of storing an unopenable file', () => {
    // Buffer.from(_, 'base64') discards junk rather than failing, so without the round-trip check
    // this would decode to something plausible-looking and be written to the library.
    assert.equal(decodeImageDataUrl('data:image/png;base64,!!!!'), null);
    assert.equal(decodeImageDataUrl('data:image/png;base64,aGVsbG8=$$$'), null);
  });
});

describe('isStorableImageMimeType', () => {
  it('is the same allowlist the decoder enforces', () => {
    assert.ok(isStorableImageMimeType('image/png'));
    assert.ok(!isStorableImageMimeType('image/svg+xml'));
    assert.ok(!isStorableImageMimeType('image/gif'));
    assert.ok(!isStorableImageMimeType(undefined));
  });
});

describe('extensionForMimeType', () => {
  it('maps to the extension the filename should carry', () => {
    assert.equal(extensionForMimeType('image/png'), 'png');
    assert.equal(extensionForMimeType('image/jpeg'), 'jpg');
    assert.equal(extensionForMimeType('image/webp'), 'webp');
  });
});

describe('assetIdForBytes', () => {
  it('is content-addressed, so regenerating the same image is idempotent', () => {
    const a = assetIdForBytes(Buffer.from('same'));
    assert.equal(a, assetIdForBytes(Buffer.from('same')));
    assert.notEqual(a, assetIdForBytes(Buffer.from('different')));
  });

  it('matches the img_<12 hex> convention the Figma ingest established', () => {
    assert.match(assetIdForBytes(Buffer.from('x')), /^img_[0-9a-f]{12}$/);
  });

  it('shares its hash with contentHashForBytes, which is stored for dedupe', () => {
    const bytes = Buffer.from('x');
    assert.ok(contentHashForBytes(bytes).startsWith(assetIdForBytes(bytes).slice(4)));
  });
});

describe('shouldReencodeToWebp', () => {
  it('converts the formats the image model returns', () => {
    assert.ok(shouldReencodeToWebp('image/png'));
    assert.ok(shouldReencodeToWebp('image/jpeg'));
  });

  it('never re-encodes WebP, which would be a second lossy pass for nothing', () => {
    assert.equal(shouldReencodeToWebp('image/webp'), false);
  });

  it('respects an opt-out, for artwork that must be stored as given', () => {
    assert.equal(shouldReencodeToWebp('image/png', false), false);
  });
});
