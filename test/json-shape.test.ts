import assert from 'node:assert';
import { describe, it } from 'node:test';
import { describeJsonShape } from '../src/app/lib/json-shape';

/**
 * Both cases here are live failures. The probe answers ReactNode slots and deliberately ignores
 * JSON-native props — but nothing was describing those either, so they reached the model as
 * "array of object".
 */
describe('describeJsonShape', () => {
  it('disambiguates stats, which the model got exactly backwards', () => {
    // It put "Uptime Guarantee" in `stat` and "99.999%" in `sub`. Key names alone do not say which is
    // the number; the examples do.
    const shape = describeJsonShape([
      { _key: '1', _type: 'statCard', stat: '100', sub: 'Countries', eyebrow: 'Available in' },
    ]);
    assert.match(shape!, /stat: "100"/);
    assert.match(shape!, /sub: "Countries"/);
    assert.match(shape!, /write EVERY item/);
  });

  it('names the keys of a gallery image, which the model could not guess', () => {
    const shape = describeJsonShape([{ src: '/img/a.webp', alt: 'A student' }]);
    assert.match(shape!, /src: "\/img\/a\.webp"/);
    assert.match(shape!, /alt: "A student"/);
  });

  it('drops bookkeeping keys nobody authors', () => {
    const shape = describeJsonShape([{ _key: '1', _type: 'card', title: 'Hi' }]);
    assert.ok(!shape!.includes('_key'));
    assert.ok(!shape!.includes('_type'));
  });

  it('clips a long example rather than pasting lorem into every field description', () => {
    const shape = describeJsonShape([{ body: 'x'.repeat(200) }]);
    assert.ok(shape!.length < 90, `too long: ${shape}`);
    assert.match(shape!, /…/);
  });

  it('strips markup from an example so the description stays readable', () => {
    assert.match(describeJsonShape([{ body: '<p>Real <b>copy</b></p>' }])!, /body: "Real copy"/);
  });

  it('calls a serialized element what an author actually writes', () => {
    const el = { key: null, type: 'p', props: { children: 'x' }, _owner: null, _store: {} };
    assert.match(describeJsonShape([{ bodySlot: el }])!, /bodySlot: HTML string/);
  });

  it('describes a plain object prop too, not just arrays', () => {
    assert.match(describeJsonShape({ prev: 'Back', next: 'Forward' })!, /prev: "Back", next: "Forward"/);
  });

  it('collapses a nested object to its keys rather than recursing', () => {
    // Shipped for every field of every block in the catalog; depth costs more than it explains.
    const shape = describeJsonShape([{ image: { src: '/a.png', alt: 'A' }, title: 'T' }]);
    assert.match(shape!, /image: \{ src, alt \}/);
  });

  it('returns null when the value teaches nothing, so the caller can fall back', () => {
    assert.equal(describeJsonShape([]), null);
    assert.equal(describeJsonShape(undefined), null);
    assert.equal(describeJsonShape('a string'), null);
    assert.equal(describeJsonShape({}), null);
    assert.equal(describeJsonShape({ _key: '1' }), null);
  });

  it('handles an array of plain strings', () => {
    assert.match(describeJsonShape(['a', 'b'])!, /array of plain strings/);
  });
});
