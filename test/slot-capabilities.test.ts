import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  applyCapabilitiesToProperties,
  bareArrayEncoding,
  describeEncoding,
  encodingForSlot,
  isSlotEditable,
  nestedEncodingLookup,
  placeholderForEncoding,
  readCapabilities,
  widgetForEncoding,
} from '../src/app/lib/slot-capabilities';

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

/**
 * The other half of the bridge: probing says which encoding a slot takes, this says what a value in
 * that encoding looks like. A fixed shared set, not written per client.
 */
describe('placeholderForEncoding', () => {
  it('gives an image a dimensioned placeholder so the slot keeps its proportions', () => {
    const v = placeholderForEncoding('image-object', { label: 'Hero image', width: 2560, height: 1400 }) as {
      src: string;
      alt: string;
    };
    assert.match(v.src, /2560x1400/);
    assert.match(v.src, /Hero%20image/);
    assert.equal(v.alt, 'Hero image');
  });

  it('leaves text empty rather than seeding sample copy', () => {
    // A scaffold carrying somebody's sample renders as finished when it is not — the lorem-ipsum-in-
    // the-stats-block failure.
    assert.equal(placeholderForEncoding('plain-text'), '');
    assert.equal(placeholderForEncoding('html-string'), '');
    assert.deepEqual(placeholderForEncoding('array-of-urltext'), []);
  });

  it('returns undefined for an unknown encoding rather than guessing', () => {
    assert.equal(placeholderForEncoding(null), undefined);
    assert.equal(placeholderForEncoding('something-new'), undefined);
  });

  it('offers no placeholder for serialized-element, which nothing accepts and nobody can author', () => {
    assert.equal(placeholderForEncoding('serialized-element'), undefined);
  });
});

describe('describeEncoding', () => {
  it('describes an encoding the component was observed to accept', () => {
    assert.match(describeEncoding('image-object')!, /\{ src, alt \}/);
    assert.match(describeEncoding('array-of-urltext')!, /url, text/);
    assert.equal(describeEncoding('plain-text'), 'plain text, no markup');
  });

  it('is null for an unknown encoding, so a caller says nothing rather than something wrong', () => {
    assert.equal(describeEncoding(null), null);
    assert.equal(describeEncoding('serialized-element'), null);
  });
});

describe('widgetForEncoding', () => {
  it('maps encodings to editors', () => {
    assert.equal(widgetForEncoding('image-object'), 'image');
    assert.equal(widgetForEncoding('html-string'), 'richtext');
    assert.equal(widgetForEncoding('plain-text'), 'text');
    assert.equal(widgetForEncoding('array-of-urltext'), 'list');
  });

  it('is null where no widget is safe — raw JSON with a warning beats a form that lies', () => {
    assert.equal(widgetForEncoding(null), null);
    assert.equal(widgetForEncoding('serialized-element'), null);
  });
});

/**
 * The editor renders from `properties`, the scaffold from the capability record. Wiring only the
 * scaffold left the two disagreeing about the same field — the failure mode that has cost the most time
 * on this work.
 */
describe('applyCapabilitiesToProperties', () => {
  const caps = readCapabilities({
    data: {
      capabilities: {
        slots: {
          desktopImageSlot: { accepts: ['image-object'], rejects: [], threw: [], unresolved: false },
          titleSlot: { accepts: ['html-string'], rejects: [], threw: [], unresolved: false },
          buttonSlots: { accepts: ['array-of-urltext'], rejects: [], threw: [], unresolved: false },
          audioSlot: { accepts: [], rejects: ['plain-text'], threw: [], unresolved: true },
        },
      },
    },
  });

  const properties = {
    desktopImageSlot: { kind: 'slot', type: 'React.ReactNode', rules: { dimensions: { recommended: { width: 2560, height: 1400 } } } },
    titleSlot: { kind: 'slot', type: 'React.ReactNode' },
    buttonSlots: { kind: 'slot', type: 'React.ReactNode' },
    audioSlot: { kind: 'slot', type: 'React.ReactNode' },
    theme: { kind: 'primitive', type: 'text', options: [{ value: 'dark' }] },
  };

  it('gives an image slot an image editor instead of a slot editor', () => {
    const out = applyCapabilitiesToProperties(properties, caps) as Record<string, Record<string, unknown>>;
    assert.equal(out.desktopImageSlot!.editorType, 'image');
    assert.equal(out.desktopImageSlot!.encoding, 'image-object');
    assert.equal(out.desktopImageSlot!.measured, true);
  });

  it('maps the other measured encodings to their widgets', () => {
    const out = applyCapabilitiesToProperties(properties, caps) as Record<string, Record<string, unknown>>;
    assert.equal(out.titleSlot!.editorType, 'richtext');
    assert.equal(out.buttonSlots!.editorType, 'list');
  });

  it('keeps declared intent — dimension rules and enum options are authored, not measured', () => {
    const out = applyCapabilitiesToProperties(properties, caps) as Record<string, Record<string, unknown>>;
    assert.deepEqual(out.desktopImageSlot!.rules, properties.desktopImageSlot.rules);
    assert.deepEqual(out.theme!.options, properties.theme.options);
  });

  it('flags an unresolved slot rather than silently re-typing it', () => {
    // A form that reports success and changes nothing is what this mechanism exists to stop.
    const out = applyCapabilitiesToProperties(properties, caps) as Record<string, Record<string, unknown>>;
    assert.equal(out.audioSlot!.editable, false);
    assert.equal(out.audioSlot!.measured, true);
  });

  it('leaves non-slot props completely alone', () => {
    const out = applyCapabilitiesToProperties(properties, caps) as Record<string, Record<string, unknown>>;
    assert.equal(out.theme!.editorType, undefined);
    assert.equal(out.theme!.kind, 'primitive');
  });

  it('returns the original object for an unprobed component, so nothing re-renders', () => {
    assert.equal(applyCapabilitiesToProperties(properties, null), properties);
  });
});

/**
 * Nested slots are keyed by path — `cards[].imageSlot`, not `imageSlot` — because a bare field name is
 * not unique: two containers on one component can both have a `bodySlot` and need not accept the same
 * thing.
 */
describe('nestedEncodingLookup', () => {
  const caps = readCapabilities({
    capabilities: {
      componentId: 'grid',
      slots: {
        'cards[].imageSlot': { accepts: ['image-object'] },
        'cards[].bodySlot': { accepts: [] },
        'subCard.bodySlot': { accepts: ['html-string'] },
        titleSlot: { accepts: ['plain-text'] },
      },
    },
  });

  it('finds a slot inside an array container', () => {
    assert.equal(nestedEncodingLookup(caps, 'cards')!('imageSlot'), 'image-object');
  });

  it('finds a slot inside an object container', () => {
    assert.equal(nestedEncodingLookup(caps, 'subCard')!('bodySlot'), 'html-string');
  });

  it('returns null for probed-and-nothing-worked, undefined for never-probed', () => {
    // The distinction is the whole point: one says "do not write this", the other says "we do not know"
    // and the caller must fall back rather than assert anything.
    assert.equal(nestedEncodingLookup(caps, 'cards')!('bodySlot'), null);
    assert.equal(nestedEncodingLookup(caps, 'cards')!('missingSlot'), undefined);
  });

  it('does not confuse a top-level slot for a nested one of the same name', () => {
    assert.equal(nestedEncodingLookup(caps, 'cards')!('titleSlot'), undefined);
  });

  it('returns undefined entirely when the component was never probed', () => {
    assert.equal(nestedEncodingLookup(null, 'cards'), undefined);
  });
});

describe('bareArrayEncoding', () => {
  it('reads an array-of-elements slot, where the item IS the slot', () => {
    const caps = readCapabilities({ capabilities: { slots: { 'logoSlots[]': { accepts: ['image-object'] } } } });
    assert.equal(bareArrayEncoding(caps, 'logoSlots'), 'image-object');
    assert.equal(bareArrayEncoding(caps, 'other'), undefined);
  });
});
