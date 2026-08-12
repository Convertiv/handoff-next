import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  fieldLinkKey,
  orderPropertiesByDocument,
  requestFieldReveal,
} from '../src/app/components/Playground/FieldLinkContext';

/**
 * The rail ↔ canvas link — roadmap F.2's orientation half.
 *
 * Both functions exist because the two ends name the same field differently: the rail walks real args
 * (`items.1.paragraph`) while a mark carries `@index` (`items.paragraph:1`). Getting that normalisation wrong
 * means hover linking silently never matches, which looks like "the feature isn't wired" rather than a bug.
 */
describe('fieldLinkKey', () => {
  it('leaves a plain path alone', () => {
    assert.equal(fieldLinkKey('title'), 'title');
    assert.equal(fieldLinkKey('author.linked_in'), 'author.linked_in');
  });

  it('strips a mark row suffix', () => {
    assert.equal(fieldLinkKey('items.paragraph:1'), 'items.paragraph');
  });

  it('strips rail row indices', () => {
    assert.equal(fieldLinkKey('items.1.paragraph'), 'items.paragraph');
    assert.equal(fieldLinkKey('cards.12.cta.text'), 'cards.cta.text');
  });

  /** The point of the whole function: both spellings must land on the same key. */
  it('maps both spellings of the same field to one key', () => {
    assert.equal(fieldLinkKey('items.3.paragraph'), fieldLinkKey('items.paragraph:3'));
  });
});

describe('orderPropertiesByDocument', () => {
  const properties = { theme: { type: 'enum' }, title: { type: 'text' }, paragraph: { type: 'text' } };

  it('reorders top-level fields to match the page', () => {
    const out = orderPropertiesByDocument(properties, ['paragraph', 'title']);
    assert.deepEqual(Object.keys(out!), ['paragraph', 'title', 'theme']);
  });

  /** A nested mark still positions its top-level field — `items.title` places `items`. */
  it('positions a field by its first mark', () => {
    const out = orderPropertiesByDocument({ a: {}, items: {} }, ['items.title:0', 'items.title:1', 'a']);
    assert.deepEqual(Object.keys(out!), ['items', 'a']);
  });

  /**
   * No report must mean no reordering: a React block carries no marks and a canvas mid-load has reported
   * nothing, and scrambling or emptying the rail in either case would be worse than schema order.
   */
  it('returns the object untouched when nothing was reported', () => {
    assert.equal(orderPropertiesByDocument(properties, null), properties);
    assert.equal(orderPropertiesByDocument(properties, []), properties);
  });

  /** Unreported fields — config, anchors, theme switches — keep schema order rather than being invented a place. */
  it('keeps unreported fields in schema order, after the reported ones', () => {
    const out = orderPropertiesByDocument({ z: {}, title: {}, a: {} }, ['title']);
    assert.deepEqual(Object.keys(out!), ['title', 'z', 'a']);
  });

  it('preserves the values, not just the keys', () => {
    const out = orderPropertiesByDocument(properties, ['title']);
    assert.deepEqual(out!.title, { type: 'text' });
  });

  it('tolerates nothing to order', () => {
    assert.equal(orderPropertiesByDocument(undefined, ['title']), undefined);
    assert.equal(orderPropertiesByDocument(null, ['title']), null);
  });
});

/**
 * `requestFieldReveal` runs in components that also render on the server, where `window` does not exist.
 *
 * The guard matters more than it looks: this is called from `BuildPanel` and `GuestAuthoring`, both of which are in
 * the server-rendered tree. An unguarded `window.postMessage` would throw during SSR — turning "clicking a finding
 * doesn't jump" into "the page 500s".
 */
describe('requestFieldReveal', () => {
  it('is a no-op with no window rather than a crash', () => {
    assert.equal(typeof window, 'undefined', 'this test is only meaningful without a DOM');
    assert.doesNotThrow(() => requestFieldReveal(0, 'title'));
    assert.doesNotThrow(() => requestFieldReveal(2, null));
  });
});
