import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  describeEncoding,
  encodingForSlot,
  placeholderForEncoding,
  readCapabilities,
  widgetForEncoding,
} from '../src/app/lib/slot-capabilities';

/**
 * Replays what `scaffoldArgsForComponent` now does per field, without needing a data provider.
 *
 * The behaviour under test is the priority rule: a measured encoding beats a seeded preview value.
 * Across 8x8's catalog the previews hold serialized React elements and **no slot accepts one**, so
 * seeding from them handed the model a shape the component discards — which is the bug this fixes.
 */
function scaffoldField(component: unknown, name: string, previewValue: unknown) {
  const caps = readCapabilities(component);
  const encoding = encodingForSlot(caps, name);
  if (encoding) {
    const value = placeholderForEncoding(encoding, { label: 'Desktop image', width: 2560, height: 1400 });
    return {
      value: value === undefined ? previewValue : value,
      editorType: widgetForEncoding(encoding),
      shape: describeEncoding(encoding),
      measured: true,
    };
  }
  if (caps?.slots?.[name]?.unresolved) return { value: previewValue, measured: true, editable: false };
  return { value: previewValue, measured: false };
}

const serializedElement = {
  key: null,
  type: 'img',
  props: { src: '../../images/content/iframe-bg-img.jpeg', width: 2560, height: 1400 },
  _owner: null,
  _store: {},
};

const probed = {
  id: 'hero-background',
  data: {
    capabilities: {
      componentId: 'hero-background',
      slots: {
        desktopImageSlot: { accepts: ['image-object'], rejects: [], threw: [], unresolved: false },
        titleSlot: { accepts: ['html-string', 'plain-text'], rejects: [], threw: [], unresolved: false },
        buttonSlots: { accepts: ['array-of-urltext'], rejects: [], threw: ['plain-text'], unresolved: false },
        audioSlot: { accepts: [], rejects: ['plain-text'], threw: [], unresolved: true },
      },
    },
  },
};

describe('scaffolding from a capability record', () => {
  it('replaces a serialized-element preview with the encoding the component accepts', () => {
    const f = scaffoldField(probed, 'desktopImageSlot', serializedElement);
    const v = f.value as { src: string; alt: string };
    assert.ok(!('props' in (f.value as object)), 'must not hand back the serialized element');
    assert.match(v.src, /placehold\.co\/2560x1400/);
    assert.equal(f.editorType, 'image');
    assert.match(f.shape!, /\{ src, alt \}/);
  });

  it('describes a button slot as the array it was measured to take', () => {
    const f = scaffoldField(probed, 'buttonSlots', serializedElement);
    assert.deepEqual(f.value, []);
    assert.equal(f.editorType, 'list');
    assert.match(f.shape!, /url, text/);
  });

  it('leaves richtext empty rather than seeding sample copy', () => {
    const f = scaffoldField(probed, 'titleSlot', { props: { dangerouslySetInnerHTML: { __html: 'Sample' } } });
    assert.equal(f.value, '');
    assert.equal(f.editorType, 'richtext');
  });

  it('marks an unresolved slot not-editable rather than guessing a shape for it', () => {
    const f = scaffoldField(probed, 'audioSlot', serializedElement);
    assert.equal(f.editable, false);
    assert.equal(f.measured, true);
  });

  it('falls through untouched for a component that predates probing', () => {
    // Phase 2 must be a no-op until a workspace rebuilds and pushes, or deploying it would change every
    // catalog at once with nothing measured to back the change.
    const f = scaffoldField({ id: 'legacy', data: {} }, 'desktopImageSlot', serializedElement);
    assert.equal(f.measured, false);
    assert.equal(f.value, serializedElement);
  });

  it('falls through for a slot the record does not mention', () => {
    const f = scaffoldField(probed, 'someNewSlot', 'existing');
    assert.equal(f.measured, false);
    assert.equal(f.value, 'existing');
  });
});
