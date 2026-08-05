import assert from 'node:assert';
import { describe, it } from 'node:test';
import { clearImageFieldWrites, imageFieldWrites } from '../src/app/lib/image-field-write';

/**
 * The `[object Object]` bug, pinned down.
 *
 * `image-gallery`'s items measured `array-of-image-object`, so an item is `{ src: 'https://…', alt }` — `src`
 * is a **string**. The image control, though, is bound to an image *object* and writes `src`/`srcset`/`alt`
 * inside whatever path it is given. Pointed at `src`, it wrote `src.src`, the component received an object
 * where it expected a URL, and the page rendered `<img src="[object Object]">`.
 *
 * Three call sites shared that convention by copy — the field's remove button, its generate flow, and the
 * media browser's commit — which is why the rule now lives in one function with tests on it.
 */
describe('imageFieldWrites', () => {
  const image = { src: 'https://cdn.example/photo.jpg', srcset: 'https://cdn.example/photo.jpg 2x', alt: 'A photo' };

  it('writes the URL string at the field itself when the value IS the URL', () => {
    const writes = imageFieldWrites(['images', '0', 'src'], image, true);
    assert.deepEqual(writes, [[['images', '0', 'src'], 'https://cdn.example/photo.jpg']]);
    // The regression, stated as the thing that must never come back: nothing may be written *under* `src`.
    for (const [path] of writes) {
      assert.equal(path.at(-1), 'src', 'writes at src, never inside it');
    }
  });

  it('never produces a non-string value for a scalar target', () => {
    // The failure was not a wrong path in the abstract — it was an object reaching an `img` tag.
    const [[, value]] = imageFieldWrites(['images', '0', 'src'], image, true);
    assert.equal(typeof value, 'string');
    assert.notEqual(String(value), '[object Object]');
  });

  it('nests src/srcset/alt for an image-object prop, which is the other real case', () => {
    assert.deepEqual(imageFieldWrites(['desktopImage'], image, false), [
      [['desktopImage', 'src'], 'https://cdn.example/photo.jpg'],
      [['desktopImage', 'srcset'], 'https://cdn.example/photo.jpg 2x'],
      [['desktopImage', 'alt'], 'A photo'],
    ]);
  });

  it('omits alt when none is supplied, so generating an image keeps authored alt text', () => {
    const writes = imageFieldWrites(['desktopImage'], { src: 'x.jpg' }, false);
    assert.deepEqual(writes.map(([p]) => p.at(-1)), ['src', 'srcset']);
    assert.equal(writes.find(([p]) => p.at(-1) === 'srcset')?.[1], '', 'srcset cleared rather than left stale');
  });

  it('writes no alt in scalar mode even when one is supplied', () => {
    // The item's own `alt` field owns it. Two controls writing one value is the drift this file exists for.
    const writes = imageFieldWrites(['images', '0', 'src'], image, true);
    assert.equal(writes.length, 1);
  });
});

describe('clearImageFieldWrites', () => {
  it('clears the string in place for a scalar target', () => {
    assert.deepEqual(clearImageFieldWrites(['images', '0', 'src'], true), [[['images', '0', 'src'], '']]);
  });

  it('clears src and srcset for an object target', () => {
    assert.deepEqual(clearImageFieldWrites(['hero'], false), [
      [['hero', 'src'], ''],
      [['hero', 'srcset'], ''],
    ]);
  });

  it('clears exactly the paths the writer wrote', () => {
    // A remove that does not mirror the write leaves half a value behind — an empty `src` beside a live
    // `srcset`, or in scalar mode an object where a string belongs.
    for (const scalar of [true, false]) {
      const written = imageFieldWrites(['f'], { src: 'a.jpg', srcset: 's' }, scalar).map(([p]) => p.join('.'));
      const cleared = clearImageFieldWrites(['f'], scalar).map(([p]) => p.join('.'));
      assert.deepEqual(cleared, written, `scalar=${scalar}`);
    }
  });
});
