import assert from 'node:assert';
import { describe, it } from 'node:test';
import { encodingForSlot, isSlotEditable, readCapabilities } from '../src/app/lib/slot-capabilities';

/** Exactly what the build writes and the push carries — the shape verified against 8x8's catalog. */
const record = {
  componentId: 'hero-background',
  candidates: ['image-object', 'html-string', 'plain-text'],
  slots: {
    desktopImageSlot: { accepts: ['image-object'], rejects: ['plain-text'], threw: [], unresolved: false },
    titleSlot: { accepts: ['html-string', 'plain-text'], rejects: [], threw: [], unresolved: false },
    audioSlot: { accepts: [], rejects: ['plain-text', 'image-object'], threw: [], unresolved: true },
  },
  unresolved: ['audioSlot'],
};

describe('readCapabilities', () => {
  it('reads the record out of the data jsonb, where the push puts it', () => {
    const caps = readCapabilities({ id: 'hero-background', data: { capabilities: record } });
    assert.equal(caps?.componentId, 'hero-background');
    assert.deepEqual(caps?.slots.desktopImageSlot?.accepts, ['image-object']);
  });

  it('also reads a top-level field, so a shape change on the wire does not silently lose it', () => {
    const caps = readCapabilities({ id: 'x', capabilities: record });
    assert.deepEqual(caps?.slots.titleSlot?.accepts, ['html-string', 'plain-text']);
  });

  it('returns null for an unprobed component rather than an empty record', () => {
    // "Not probed" and "probed, found nothing" must stay distinguishable: an empty record would mark
    // every slot uneditable, which is the confident-wrong answer this mechanism exists to remove.
    assert.equal(readCapabilities({ id: 'x', data: {} }), null);
    assert.equal(readCapabilities({ id: 'x' }), null);
    assert.equal(readCapabilities(null), null);
    assert.equal(readCapabilities('nonsense'), null);
  });

  it('survives a malformed record instead of throwing into a page render', () => {
    const caps = readCapabilities({ data: { capabilities: { slots: { a: 'not an object', b: { accepts: 'nope' } } } } });
    assert.ok(caps);
    assert.deepEqual(caps.slots.b?.accepts, []);
    assert.ok(caps.slots.b?.unresolved);
  });

  it('recomputes unresolved from accepts rather than trusting the stored flag', () => {
    const caps = readCapabilities({ data: { capabilities: { slots: { s: { accepts: [], unresolved: false } } } } });
    assert.ok(caps?.slots.s?.unresolved, 'a slot with no accepted encoding is unresolved regardless');
  });
});

describe('encodingForSlot', () => {
  it('gives the most specific accepted encoding', () => {
    const caps = readCapabilities({ data: { capabilities: record } });
    assert.equal(encodingForSlot(caps, 'desktopImageSlot'), 'image-object');
    assert.equal(encodingForSlot(caps, 'titleSlot'), 'html-string');
  });

  it('is null for an unresolved slot, an unknown slot, and an unprobed component', () => {
    const caps = readCapabilities({ data: { capabilities: record } });
    assert.equal(encodingForSlot(caps, 'audioSlot'), null);
    assert.equal(encodingForSlot(caps, 'noSuchSlot'), null);
    assert.equal(encodingForSlot(null, 'titleSlot'), null);
  });
});

describe('isSlotEditable', () => {
  it('is false wherever there is no measured encoding', () => {
    const caps = readCapabilities({ data: { capabilities: record } });
    assert.ok(isSlotEditable(caps, 'desktopImageSlot'));
    assert.equal(isSlotEditable(caps, 'audioSlot'), false);
    assert.equal(isSlotEditable(null, 'desktopImageSlot'), false);
  });
});
