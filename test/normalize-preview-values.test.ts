import assert from 'node:assert';
import { describe, it } from 'node:test';
import { normalizePreviewValues, plainEquivalent } from '../src/app/lib/normalize-preview-values';

/** How a React registry actually stores an image slot: serialized render output, React internals and all. */
const imgElement = {
  key: null,
  type: 'img',
  props: { src: '/api/handoff/assets/img_abc/raw', alt: 'Students on campus', width: 600, height: 400 },
  _owner: null,
  _store: {},
};

/** A richtext slot, stored as an element carrying markup. */
const htmlElement = {
  key: null,
  type: 'div',
  props: { dangerouslySetInnerHTML: { __html: '<p>One unified cloud phone system.</p>' } },
  _owner: null,
};

/** A text slot, stored as an element wrapping copy. */
const textElement = {
  key: null,
  type: 'span',
  props: { children: 'For Higher Education', className: 'overline' },
  _owner: null,
};

/**
 * Capture repair at the sync boundary (Phase F, `F.-1`).
 *
 * Every case is grounded in the browser round-trip recorded in `docs/FIELD-BRIDGE.md`: the declared shape
 * renders, an element with `props.src` is silently replaced by the component's default, and the stored value
 * verbatim throws. The point of normalising is that the *declared* shape is the one that works.
 */
describe('plainEquivalent', () => {
  it('reads an image back into its declared shape, keeping the real src', () => {
    assert.deepEqual(plainEquivalent(imgElement, 'image'), {
      src: '/api/handoff/assets/img_abc/raw',
      alt: 'Students on campus',
      width: 600,
      height: 400,
    });
  });

  /** `image-url` is bound to the URL string itself, not an object around it. */
  it('reads an image-url back as the bare string', () => {
    assert.equal(plainEquivalent(imgElement, 'image-url'), '/api/handoff/assets/img_abc/raw');
  });

  it('reads richtext back as the markup string', () => {
    assert.equal(plainEquivalent(htmlElement, 'richtext'), '<p>One unified cloud phone system.</p>');
  });

  it('reads text back as the copy, ignoring structural props', () => {
    assert.equal(plainEquivalent(textElement, 'text'), 'For Higher Education');
  });

  /** Rule 1: never guess. An empty element yields nothing rather than an empty value. */
  it('returns undefined when there is nothing faithful to read out', () => {
    assert.equal(plainEquivalent({ type: 'div', props: {} }, 'text'), undefined);
    assert.equal(plainEquivalent({ type: 'div', props: { children: '   ' } }, 'text'), undefined);
    assert.equal(plainEquivalent({ type: 'div', props: {} }, 'image'), undefined);
  });

  it('leaves an already-plain value alone', () => {
    assert.equal(plainEquivalent({ src: '/a.png', alt: 'A' }, 'image'), undefined);
    assert.equal(plainEquivalent('Just a string', 'text'), undefined);
  });
});

describe('normalizePreviewValues', () => {
  const properties = {
    imageSlot: { type: 'image' },
    bodySlot: { type: 'richtext' },
    overlineSlot: { type: 'text' },
  };

  it('normalises every eligible field and reports what it did', () => {
    const previews = {
      generic: {
        title: 'Generic',
        values: { imageSlot: imgElement, bodySlot: htmlElement, overlineSlot: textElement },
      },
    };
    const { previews: next, changes } = normalizePreviewValues(properties, previews);
    const values = (next as any).generic.values;

    assert.deepEqual(values.imageSlot, {
      src: '/api/handoff/assets/img_abc/raw',
      alt: 'Students on campus',
      width: 600,
      height: 400,
    });
    assert.equal(values.bodySlot, '<p>One unified cloud phone system.</p>');
    assert.equal(values.overlineSlot, 'For Higher Education');
    // The wrapper's own metadata survives.
    assert.equal((next as any).generic.title, 'Generic');
    assert.equal(changes.length, 3);
    assert.deepEqual(
      changes.map((c) => c.path).sort(),
      ['bodySlot', 'imageSlot', 'overlineSlot']
    );
  });

  /** Rule 2: a slot legitimately holds an element tree — normalising it would break correct React slots. */
  it('never touches a slot', () => {
    const previews = { generic: { values: { bodySlot: htmlElement } } };
    const { previews: next, changes } = normalizePreviewValues({ bodySlot: { type: 'React.ReactNode' } }, previews);
    assert.equal(changes.length, 0);
    assert.equal(next, previews, 'should be returned by identity');
  });

  /**
   * Rule 1: an array holding an element with **no anchors in it** has no recoverable items, so it is left alone
   * for the audit to keep reporting. (A rendered *button* array is recoverable — see the buttons block below.)
   */
  it('leaves a declared array holding an un-invertible element untouched', () => {
    const previews = { generic: { values: { buttonSlots: imgElement } } };
    const { previews: next, changes } = normalizePreviewValues({ buttonSlots: { type: 'array' } }, previews);
    assert.equal(changes.length, 0);
    assert.equal(next, previews);
  });

  /** Rule 3: sync runs repeatedly, so a second pass must find nothing. */
  it('is idempotent', () => {
    const previews = { generic: { values: { imageSlot: imgElement } } };
    const first = normalizePreviewValues(properties, previews);
    const second = normalizePreviewValues(properties, first.previews);
    assert.equal(second.changes.length, 0);
    assert.equal(second.previews, first.previews, 'a settled value should be returned by identity');
  });

  it('returns the original object by identity when nothing needs changing', () => {
    const previews = { generic: { values: { imageSlot: { src: '/a.png', alt: 'A' } } } };
    const { previews: next, changes } = normalizePreviewValues(properties, previews);
    assert.equal(next, previews);
    assert.deepEqual(changes, []);
  });

  it('normalises a bare values object as well as a wrapped one', () => {
    const { previews: next, changes } = normalizePreviewValues(properties, {
      generic: { imageSlot: imgElement },
    });
    assert.equal(changes.length, 1);
    assert.equal((next as any).generic.imageSlot.src, '/api/handoff/assets/img_abc/raw');
  });

  it('ignores values with no declared property', () => {
    const { changes } = normalizePreviewValues(properties, {
      generic: { values: { somethingUndeclared: imgElement } },
    });
    assert.deepEqual(changes, []);
  });

  it('tolerates nonsense input', () => {
    assert.deepEqual(normalizePreviewValues(undefined, undefined).changes, []);
    assert.deepEqual(normalizePreviewValues('nope', 'nope').changes, []);
    assert.deepEqual(normalizePreviewValues(properties, { generic: 'not an object' }).changes, []);
  });
});

/**
 * Rendered buttons, back to `{ url, text }`.
 *
 * All 23 of the declared-`array`-holding-an-element cases on 8x8 turned out to be this one shape in two
 * variants, which is why the array case moved out of the leave-alone set: looking at the real data showed the
 * inversion was mechanical rather than bespoke.
 */
describe('plainEquivalent — buttons', () => {
  /** `footerButtonSlot`: a single `<a>`, with a chevron icon as its trailing child. */
  const singleAnchor = {
    key: null,
    type: 'a',
    props: {
      href: '/resources',
      children: [
        'See all resources',
        { key: null, type: 'span', props: { children: { key: null, type: 'svg', props: { width: 8 } } } },
      ],
    },
  };

  /** `buttonSlots`: a wrapper whose children are the anchors. */
  const anchorGroup = {
    key: null,
    props: {
      children: [
        { key: 'button-0', type: 'a', props: { href: '/demo', children: ['Book a demo', null] } },
        { key: 'button-1', type: 'a', props: { href: '/contact', children: ['Talk to sales', null] } },
      ],
    },
  };

  it('reads a single anchor back as a button, ignoring the icon child', () => {
    assert.deepEqual(plainEquivalent(singleAnchor, 'button'), { url: '/resources', text: 'See all resources' });
  });

  it('reads a wrapper of anchors back as an array of buttons, in order', () => {
    assert.deepEqual(plainEquivalent(anchorGroup, 'array'), [
      { url: '/demo', text: 'Book a demo' },
      { url: '/contact', text: 'Talk to sales' },
    ]);
  });

  /** A single anchor against a declared array is still an array of one — this is `footerButtonSlot`. */
  it('wraps a lone anchor when the field is declared an array', () => {
    assert.deepEqual(plainEquivalent(singleAnchor, 'array'), [{ url: '/resources', text: 'See all resources' }]);
  });

  /**
   * Rule 1: an empty array would read as a deliberate "no buttons" and quietly drop whatever was really there,
   * so a wrapper with no anchors yields nothing and the audit keeps reporting it.
   */
  it('returns undefined when the element carries no anchors', () => {
    assert.equal(plainEquivalent({ type: 'div', props: { children: ['just text'] } }, 'array'), undefined);
    assert.equal(plainEquivalent({ type: 'div', props: {} }, 'button'), undefined);
  });

  it('keeps an anchor that has a label but no href', () => {
    assert.deepEqual(plainEquivalent({ type: 'a', props: { children: ['Unlinked'] } }, 'button'), {
      url: '',
      text: 'Unlinked',
    });
  });

  it('leaves an already-plain array alone', () => {
    assert.equal(plainEquivalent([{ url: '/a', text: 'A' }], 'array'), undefined);
  });
});
