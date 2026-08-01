import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  PROBE_CANDIDATES,
  baseProps,
  buildSlotCapability,
  isSlotProp,
  sentinelFor,
  type ProbeCandidate,
} from '../src/transformers/plugins/slot-probe-candidates';

const byName = (n: string) => PROBE_CANDIDATES.find((c) => c.name === n)!;
const outcome = (name: string, accepted: boolean, threw = false) => ({ candidate: byName(name), accepted, threw });

describe('isSlotProp', () => {
  it('recognises the declared slot kind', () => {
    assert.ok(isSlotProp({ kind: 'slot', type: 'React.ReactNode' }));
  });

  it('recognises a ReactNode by type even when the kind is missing', () => {
    // Registries differ in what they populate; the type is the durable signal.
    assert.ok(isSlotProp({ type: 'React.ReactNode' }));
    assert.ok(isSlotProp({ generic: 'React.ReactElement' }));
    assert.ok(isSlotProp({ sourceType: 'JSX.Element' }));
  });

  it('leaves the JSON-native props alone — they need no probing', () => {
    assert.equal(isSlotProp({ kind: 'primitive', generic: 'string' }), false);
    assert.equal(isSlotProp({ kind: 'array', generic: 'FaqQuestion[]' }), false);
    assert.equal(isSlotProp(undefined), false);
  });
});

/**
 * Load-bearing, and a wrong value here does not look like a bug — it looks like a component whose slots
 * are not editable. Stubbing every prop as a string made components declaring `questions: FaqQuestion[]`
 * crash on `.map` before any slot rendered, and reported 21 slots across 14 components as unprobeable.
 */
describe('baseProps', () => {
  it('gives an array-typed prop an array, so the component does not crash on .map', () => {
    const b = baseProps({ questions: { kind: 'array', generic: 'FaqQuestion[]' } });
    assert.deepEqual(b.questions, []);
  });

  it('detects an array from the type when kind is absent', () => {
    assert.deepEqual(baseProps({ items: { generic: 'TimelineItem[]' } }).items, []);
    assert.deepEqual(baseProps({ items: { generic: 'Item[] | null' } }).items, []);
    assert.deepEqual(baseProps({ items: { generic: 'Array<Item>' } }).items, []);
  });

  it('handles objects, booleans and numbers by type', () => {
    const b = baseProps({
      cfg: { kind: 'object' },
      map: { generic: 'Record<string, string>' },
      flag: { type: 'boolean', generic: 'boolean | null' },
      count: { generic: 'number | null' },
    });
    assert.deepEqual(b.cfg, {});
    assert.deepEqual(b.map, {});
    assert.equal(b.flag, false);
    assert.equal(b.count, 1);
  });

  it('picks the first literal of a union, since a component may switch on it', () => {
    // An arbitrary string can land in no branch at all and render nothing.
    const b = baseProps({ displayMode: { kind: 'unknown', generic: '"all" | "progressive" | string | null' } });
    assert.equal(b.displayMode, 'all');
  });

  it('prefers declared options over a guessed string', () => {
    const b = baseProps({ theme: { type: 'text', options: [{ value: 'dark' }, { value: 'light' }] } });
    assert.equal(b.theme, 'dark');
  });

  it('never includes a slot prop — those are what the probe varies', () => {
    const b = baseProps({ titleSlot: { kind: 'slot' }, theme: { generic: 'string' } });
    assert.ok(!('titleSlot' in b));
    assert.ok('theme' in b);
  });

  it('uses the component id for anchor, so probe output is attributable', () => {
    assert.equal(baseProps({ anchor: { generic: 'string' } }, 'hero-background').anchor, 'hero-background');
  });
});

describe('sentinelFor', () => {
  it('is unique per slot so a result can be attributed', () => {
    assert.notEqual(sentinelFor('titleSlot', 0), sentinelFor('bodySlot', 1));
  });

  it('is safe inside a URL and a CSS attribute selector', () => {
    // The checks use `img[src*="…"]`; punctuation would break the selector or the URL.
    assert.match(sentinelFor('desktop-image.Slot', 3), /^[a-zA-Z0-9]+$/);
  });
});

/**
 * The ordering rule, measured across 8x8's catalog: `plain-text` was accepted by 80 slots and
 * `array-of-text` by 77, because a ReactNode slot renders a string — and an array of them — almost by
 * definition. Both true, both nearly information-free. Ordering by probe order would type every slot as
 * text and lose the image and button distinctions, which are the ones an editor needs.
 */
describe('buildSlotCapability', () => {
  it('puts the most specific accepted encoding first', () => {
    const cap = buildSlotCapability([
      outcome('plain-text', true),
      outcome('image-object', true),
      outcome('html-string', true),
    ]);
    assert.equal(cap.accepts[0], 'image-object');
    assert.deepEqual(cap.accepts, ['image-object', 'html-string', 'plain-text']);
  });

  it('separates rejected from threw — a slot that rejects most and accepts one is strongly typed', () => {
    const cap = buildSlotCapability([
      outcome('array-of-urltext', true),
      outcome('plain-text', false, true),
      outcome('image-object', false),
    ]);
    assert.deepEqual(cap.accepts, ['array-of-urltext']);
    assert.deepEqual(cap.threw, ['plain-text']);
    assert.deepEqual(cap.rejects, ['image-object']);
    assert.equal(cap.unresolved, false);
  });

  it('marks a slot with nothing accepted as unresolved rather than defaulting to text', () => {
    const cap = buildSlotCapability([outcome('plain-text', false), outcome('image-object', false, true)]);
    assert.deepEqual(cap.accepts, []);
    assert.ok(cap.unresolved);
  });

  it('is stable between runs, so a reshuffle never reads as a capability change', () => {
    const a = buildSlotCapability([outcome('array-of-urltext', true), outcome('array-of-labelhref', true)]);
    const b = buildSlotCapability([outcome('array-of-labelhref', true), outcome('array-of-urltext', true)]);
    assert.deepEqual(a.accepts, b.accepts);
  });
});

describe('PROBE_CANDIDATES', () => {
  it('keeps serialized-element in the set, because the zero is the finding', () => {
    // 0 of 135 slots across 8x8 accept it, which is only a finding while it is still measured.
    assert.ok(PROBE_CANDIDATES.some((c) => c.name === 'serialized-element'));
  });

  it('ranks array-of-text BELOW plain-text', () => {
    // An array of strings is not more specific than a string — React renders arrays of children
    // universally (77 of 135 slots accepted it, against plain-text's 80). Ranking it above text typed
    // `overlineSlot`, a short label, as a list.
    assert.ok(byName('array-of-text').specificity < byName('plain-text').specificity);
  });

  it('ranks every structured encoding above plain text', () => {
    const plain = byName('plain-text').specificity;
    for (const name of ['image-object', 'link-object', 'array-of-urltext', 'array-of-image-object']) {
      assert.ok(byName(name).specificity > plain, `${name} must outrank plain-text`);
    }
  });

  it('has a check that looks at where the sentinel landed, not just that it appears', () => {
    // A component echoing an unknown prop into an attribute must not read as accepting everything.
    const fakeRoot = {
      textContent: 'hp0zz appears in the text but there is no img',
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    assert.equal((byName('image-object') as ProbeCandidate).check(fakeRoot, 'hp0zz'), false);
    assert.equal((byName('plain-text') as ProbeCandidate).check(fakeRoot, 'hp0zz'), true);
  });
});

/**
 * The record `hero-background` must produce, pinned as a fixture.
 *
 * Each row cost a wrong turn to establish by hand. `desktopImageSlot: image-object` is the fact that
 * broke three times; `serialized-element` accepted nowhere is the month's bug. If a candidate set or
 * ranking change moves any of these, that is a regression rather than a refinement.
 */
describe('hero-background regression fixture', () => {
  const expected: Record<string, string> = {
    overlineSlot: 'plain-text',
    titleSlot: 'html-string',
    bodySlot: 'html-string',
    desktopImageSlot: 'image-object',
    mobileImageSlot: 'image-object',
    buttonSlots: 'array-of-urltext',
    breadcrumbSlot: 'plain-text',
  };

  it('ranks each known slot to the encoding it was measured to accept', () => {
    // Replays ordering only — the live render lives in the verify script, which needs the 8x8 checkout.
    const accepted: Record<string, string[]> = {
      overlineSlot: ['plain-text', 'array-of-text'],
      titleSlot: ['html-string', 'plain-text', 'array-of-text'],
      bodySlot: ['html-string', 'plain-text', 'array-of-text'],
      desktopImageSlot: ['image-object'],
      mobileImageSlot: ['image-object'],
      buttonSlots: ['array-of-urltext', 'array-of-labelhref'],
      breadcrumbSlot: ['plain-text', 'array-of-text'],
    };
    for (const [slot, names] of Object.entries(accepted)) {
      const cap = buildSlotCapability(PROBE_CANDIDATES.map((c) => outcome(c.name, names.includes(c.name))));
      assert.equal(cap.accepts[0], expected[slot], `${slot} should lead with ${expected[slot]}`);
    }
  });
});
