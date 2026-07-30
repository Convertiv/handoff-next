import assert from 'node:assert';
import { describe, it } from 'node:test';
import { toArrayItems } from '../src/app/components/Playground/fields/Field';

/**
 * `alert.buttonSlot` is declared `type: 'array'` but its preview stores a single serialized React
 * element. `items.map(...)` threw, the error boundary showed "This page couldn't load", and the
 * component could not be edited at all.
 */
describe('toArrayItems', () => {
  it('passes an array through untouched', () => {
    const arr = [{ text: 'Go' }];
    assert.equal(toArrayItems(arr), arr);
  });

  it('wraps a single object — the live crash', () => {
    const element = { key: null, type: 'a', props: { href: '#' }, _owner: null };
    assert.deepEqual(toArrayItems(element), [element]);
  });

  it('wraps a bare string, which is what the author meant by one item', () => {
    assert.deepEqual(toArrayItems('Learn more'), ['Learn more']);
  });

  it('treats null, undefined and empty string as no items', () => {
    for (const v of [null, undefined, '']) assert.deepEqual(toArrayItems(v), []);
  });

  it('does not treat zero or false as empty', () => {
    // They are legitimate scalar array items; dropping them would silently lose data.
    assert.deepEqual(toArrayItems(0), [0]);
    assert.deepEqual(toArrayItems(false), [false]);
  });
});
