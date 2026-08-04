/**
 * What we try writing into a slot, and how we decide the answer.
 *
 * Pure and free of jsdom so it can be unit-tested without a DOM. The harness that actually renders is
 * `slot-probe.ts`; everything here is the part worth arguing about.
 *
 * See `docs/SLOT-PROBING.md` for why a slot's shape is probed rather than described.
 */

export interface ProbeCandidate {
  name: string;
  /** Build a value carrying `sentinel` so the result can be attributed to this slot and candidate. */
  make: (sentinel: string) => unknown;
  /**
   * Did it render? Asserts *where* the sentinel landed, not merely that the string appears — a
   * component that dumps unknown props into an attribute would otherwise read as accepting everything.
   */
  check: (root: ProbeRoot, sentinel: string) => boolean;
  /**
   * Higher wins when ordering `accepts`.
   *
   * Measured across 8x8's catalog: `plain-text` is accepted by 80 slots and `array-of-text` by 77,
   * because a `ReactNode` slot renders a string — and an array of them — almost by definition. Both are
   * true and nearly information-free. Ordering by probe order would type every slot as text and lose
   * the image and button distinctions, which are the ones an editor needs.
   */
  specificity: number;
}

/** The subset of `Element` the checks use — keeps this file DOM-library agnostic. */
export interface ProbeRoot {
  textContent: string | null;
  querySelector(selectors: string): unknown;
  querySelectorAll(selectors: string): ArrayLike<{ textContent: string | null }>;
}

const has = (root: ProbeRoot, sel: string) => !!root.querySelector(sel);
const text = (root: ProbeRoot) => root.textContent || '';

export const PROBE_CANDIDATES: ProbeCandidate[] = [
  {
    name: 'image-object',
    specificity: 50,
    make: (s) => ({ src: `https://probe.invalid/${s}.png`, alt: s }),
    check: (r, s) => has(r, `img[src*="${s}"]`),
  },
  {
    name: 'array-of-image-object',
    specificity: 48,
    make: (s) => [1, 2].map((n) => ({ src: `https://probe.invalid/${s}n${n}.png`, alt: `${s}n${n}` })),
    check: (r, s) => [1, 2].every((n) => has(r, `img[src*="${s}n${n}"]`)),
  },
  {
    name: 'array-of-urltext',
    specificity: 44,
    make: (s) => [1, 2].map((n) => ({ url: `/${s}n${n}`, text: `${s}n${n}` })),
    check: (r, s) => [1, 2].every((n) => has(r, `a[href*="${s}n${n}"]`)),
  },
  {
    name: 'array-of-labelhref',
    specificity: 44,
    make: (s) => [1, 2].map((n) => ({ label: `${s}n${n}`, href: `/${s}n${n}` })),
    check: (r, s) => [1, 2].every((n) => has(r, `a[href*="${s}n${n}"]`)),
  },
  {
    name: 'link-object',
    specificity: 40,
    make: (s) => ({ label: s, text: s, href: `/${s}`, url: `/${s}` }),
    check: (r, s) => has(r, `a[href*="${s}"]`),
  },
  {
    name: 'html-string',
    specificity: 20,
    make: (s) => `<b>${s}</b>`,
    check: (r, s) => Array.from(r.querySelectorAll('b')).some((b) => (b.textContent || '').includes(s)),
  },
  {
    name: 'plain-text',
    specificity: 10,
    make: (s) => s,
    check: (r, s) => text(r).includes(s),
  },
  {
    /**
     * Ranked *below* `plain-text`, deliberately.
     *
     * An array of strings is not a more specific encoding than a string — React renders arrays of
     * children universally, so 77 of 135 slots accepted it against `plain-text`'s 80. It is the same
     * information-free "this slot renders children" fact, pluralised. Contrast `array-of-urltext`, which
     * only 14 slots accepted, because that one requires the component to *interpret* objects into links.
     *
     * Ranking it above text typed `overlineSlot` — a short label — as a list. When both are accepted we
     * cannot tell a genuine list slot from a text slot, and a text box on a list is degraded while a
     * list editor on a label is simply wrong.
     */
    name: 'array-of-text',
    specificity: 8,
    make: (s) => [1, 2].map((n) => `${s}n${n}`),
    check: (r, s) => [1, 2].every((n) => text(r).includes(`${s}n${n}`)),
  },
  {
    /**
     * Kept despite being accepted by **0 of 135 slots** across 8x8's catalog. That zero is the finding —
     * previews are seeded with serialized elements and nothing accepts them — and it is only a finding
     * while it is still being measured.
     */
    name: 'serialized-element',
    specificity: 5,
    make: (s) => ({ key: null, type: 'img', props: { src: `https://probe.invalid/${s}.png`, alt: s }, _owner: null, _store: {} }),
    check: (r, s) => has(r, `img[src*="${s}"]`),
  },
];

/** Deterministic, collision-free, and safe inside a URL, a class name and a CSS attribute selector. */
export function sentinelFor(slot: string, index: number): string {
  return `hp${index}${slot.replace(/[^a-zA-Z0-9]/g, '')}zz`.slice(0, 40);
}

// ── Property schema → probe inputs ───────────────────────────────────────────

export interface PropertyMeta {
  kind?: string;
  type?: string;
  generic?: string;
  sourceType?: string;
  options?: unknown[];
}

/** A prop typed as a React node — the only population that needs probing at all. */
export function isSlotProp(meta: PropertyMeta | undefined): boolean {
  if (!meta) return false;
  if (meta.kind === 'slot') return true;
  const t = `${meta.type ?? ''} ${meta.generic ?? ''} ${meta.sourceType ?? ''}`;
  return /React\.(ReactNode|ReactElement)|\bJSX\.Element\b/.test(t);
}

/**
 * Values for every **non**-slot prop, so the component renders far enough to reach the slot.
 *
 * This is load-bearing, and getting it wrong does not look like a bug — it looks like a component whose
 * slots are not editable. Stubbing every prop as `'x'` made a component declaring
 * `questions: FaqQuestion[]` crash on `.map` before any slot rendered, and reported 21 slots across 14
 * components as unprobeable. Deriving from the declared type instead cut the catalog's unresolved slots
 * from 58 to 20.
 *
 * These are the JSON-native props — the half types genuinely answer. They exist here to make probing the
 * other half possible.
 */
export function baseProps(properties: Record<string, PropertyMeta>, componentId = 'probe'): Record<string, unknown> {
  const base: Record<string, unknown> = {};

  for (const [name, meta] of Object.entries(properties ?? {})) {
    if (isSlotProp(meta)) continue;

    const declared = String(meta?.generic ?? meta?.sourceType ?? meta?.type ?? '');
    const bare = declared.replace(/\s*\|\s*(null|undefined)\b/g, '').trim();

    if (meta?.kind === 'array' || /\[\]$/.test(bare) || /^Array</.test(bare)) {
      base[name] = [];
    } else if (meta?.kind === 'object' || /^Record</.test(bare)) {
      base[name] = {};
    } else if (meta?.type === 'boolean' || /^boolean$/.test(bare)) {
      base[name] = false;
    } else if (meta?.type === 'number' || /^number$/.test(bare)) {
      base[name] = 1;
    } else if (Array.isArray(meta?.options) && meta.options.length) {
      const first = meta.options[0] as { value?: unknown };
      base[name] = first && typeof first === 'object' && 'value' in first ? first.value : first;
    } else {
      // A literal union such as `"all" | "progressive" | string | null` — take the first literal, since
      // a component may switch on it and an arbitrary string can land in no branch at all.
      const literal = bare.match(/"([^"]+)"/);
      base[name] = literal ? literal[1] : name === 'anchor' ? componentId : 'probe';
    }
  }

  return base;
}

// ── Records ──────────────────────────────────────────────────────────────────

export interface SlotCapability {
  /** Accepted encodings, most specific first. `accepts[0]` is what every consumer should use. */
  accepts: string[];
  /** Encodings that rendered nothing. Distinct from `threw`. */
  rejects: string[];
  /** Encodings that errored. A slot rejecting most and accepting one is strongly typed, not broken. */
  threw: string[];
  /** True when nothing was accepted — the slot is not editable, and we say so rather than guessing. */
  unresolved: boolean;
}

export interface ComponentCapabilities {
  componentId: string;
  /** Candidate set used, so a record can be reproduced or invalidated when the set changes. */
  candidates: string[];
  slots: Record<string, SlotCapability>;
  /** Slot names with no accepted encoding — the list a human has to act on. */
  unresolved: string[];
  /** Set when the component could not be probed at all; no slot record is emitted in that case. */
  error?: string;
  /**
   * The slot targets the probe *would* have measured, recorded only when it bailed before measuring any.
   *
   * Always accompanies `error`, and exists because of what the record looks like without it: a probe that
   * fails to load its module emits `slots: {}` and `unresolved: []`, which is byte-identical to a component
   * whose every slot measured fine. A failure reads as a clean bill of health.
   *
   * That is not hypothetical — `product-comparison` reported "0 unresolved" for exactly this reason while
   * its module had never loaded, and the empty list was believed over the baked record that disagreed.
   * An absence of findings and an absence of measurement are different claims, and only one of them is
   * evidence. This is the field that tells them apart.
   */
  unprobed?: string[];
}

/**
 * Assemble one slot's result, ordering `accepts` by specificity.
 *
 * Ties break on the candidate list's own order so a record is stable between runs — a record that
 * reshuffles would show as a spurious capability change.
 */
export function buildSlotCapability(
  outcomes: { candidate: ProbeCandidate; accepted: boolean; threw: boolean }[]
): SlotCapability {
  const order = new Map(PROBE_CANDIDATES.map((c, i) => [c.name, i]));
  const accepts = outcomes
    .filter((o) => o.accepted)
    .sort(
      (a, b) =>
        b.candidate.specificity - a.candidate.specificity ||
        (order.get(a.candidate.name) ?? 0) - (order.get(b.candidate.name) ?? 0)
    )
    .map((o) => o.candidate.name);

  return {
    accepts,
    rejects: outcomes.filter((o) => !o.accepted && !o.threw).map((o) => o.candidate.name),
    threw: outcomes.filter((o) => o.threw).map((o) => o.candidate.name),
    unresolved: accepts.length === 0,
  };
}

// ── Nested slots ─────────────────────────────────────────────────────────────
//
// A `ReactNode` sitting inside a JSON-native container: `cards[].imageSlot`, `items[].bodySlot`,
// `slides[].mediaSlot`. Measured across 8x8's catalog there are 48 of them in 27 components, against
// 132 top-level slots — so real coverage was 73%, not the 84% first reported.
//
// They matter more than that ratio suggests. Repeatable content is where the body of a generated page
// lives: a hero is one slot, a feature grid is six. It is also the direct reason `image-gallery` could
// generate three images and place none of them — nothing had ever told anyone what
// `images[].thumbnailSlot` accepts.

/** Where a nested slot lives, and how to reach it. */
export interface NestedSlot {
  /** The container prop, e.g. `cards`. */
  prop: string;
  container: 'array' | 'object';
  /** The field inside each item, or null for a bare array of elements (`logoSlots[]`). */
  field: string | null;
  /** Record key: `cards[].imageSlot`, `logoSlots[]`, `subCard.bodySlot`. */
  path: string;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isElementLike = (v: unknown): boolean =>
  isPlainObject(v) && (('props' in v && 'type' in v) || '_owner' in v || '$$typeof' in v);

/**
 * Find the nested slots a component's preview values reveal.
 *
 * Derived from values rather than types for the same reason everything else here is: the declared type
 * of a container's item is a named interface the registry does not ship, while the preview shows an
 * actual item with an actual element in it.
 *
 * Only the first item of an array is inspected — a list is homogeneous, and probing every entry would
 * multiply the work for no new information.
 */
export function enumerateNestedSlots(previewValues: Record<string, unknown>): NestedSlot[] {
  const found: NestedSlot[] = [];

  for (const [prop, value] of Object.entries(previewValues ?? {})) {
    if (Array.isArray(value)) {
      const first = value[0];
      if (isElementLike(first)) {
        found.push({ prop, container: 'array', field: null, path: `${prop}[]` });
      } else if (isPlainObject(first)) {
        for (const [field, inner] of Object.entries(first)) {
          if (field.startsWith('_')) continue;
          if (isElementLike(inner)) found.push({ prop, container: 'array', field, path: `${prop}[].${field}` });
        }
      }
      continue;
    }

    if (isPlainObject(value) && !isElementLike(value)) {
      for (const [field, inner] of Object.entries(value)) {
        if (field.startsWith('_')) continue;
        if (isElementLike(inner)) found.push({ prop, container: 'object', field, path: `${prop}.${field}` });
      }
    }
  }

  return found;
}

/**
 * Build the container value that puts a candidate in one nested slot.
 *
 * The rest of the item comes from the preview, minus its other elements. Leaving those in place
 * reproduces the interference that made a batched top-level probe report a false rejection — a sibling
 * slot holding an unrenderable value can take the whole item down with it, and the result reads as the
 * target slot refusing the candidate.
 *
 * One item only. A list renders its items the same way, and one is enough to see whether the slot took.
 */
export function buildNestedProbeValue(previewValue: unknown, slot: NestedSlot, candidateValue: unknown): unknown {
  // Recursive, because an element can be one level further down than the sibling field itself:
  // `cards[].buttonSlots` is an *array* of elements, and leaving it in place threw React error #31 —
  // "object with keys {key, type, props, _owner, _store}" — for every candidate, so the target slot
  // read as rejecting everything. Depth is small and known (preview values are plain JSON), so a full
  // walk is cheaper than reasoning about which shapes can hide one.
  const stripElements = (v: unknown): unknown => {
    if (isElementLike(v)) return undefined;
    if (Array.isArray(v)) return v.map(stripElements).filter((x) => x !== undefined);
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, inner] of Object.entries(v)) out[k] = stripElements(inner);
      return out;
    }
    return v;
  };

  const stripSiblings = (item: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) {
      if (k === slot.field) continue;
      out[k] = stripElements(v);
    }
    return out;
  };

  if (slot.container === 'array') {
    if (slot.field === null) return [candidateValue];
    const template = Array.isArray(previewValue) && isPlainObject(previewValue[0]) ? previewValue[0] : {};
    return [{ ...stripSiblings(template), [slot.field]: candidateValue }];
  }

  const template = isPlainObject(previewValue) ? previewValue : {};
  return { ...stripSiblings(template), [slot.field!]: candidateValue };
}

/**
 * Whether a whole-container answer is worth recording.
 *
 * Probing a container as a unit found one true answer and five false ones across 8x8's catalog, and the
 * false ones are the dangerous kind — plausible, measured, and lossy:
 *
 *   image-gallery.images  → array-of-image-object   item is { alt, caption, thumbnailSlot }   ✔ describes it
 *   bento-lottie-grid.cards → array-of-labelhref    item is { eyebrow, heading, gridSpan, … }  ✘ discards all of it
 *   related-cards.cards   → array-of-urltext        item is { cardSlot } and nothing else      ✘ describes nothing
 *
 * All six rendered the sentinel. Rendering is not the question for a container — an item has many
 * fields, and matching one path through the component does not make the candidate the item's shape.
 *
 * So the test is coverage, not rendering: **the encoding must name at least one field the preview item
 * actually carries.** `{ src, alt }` overlaps the gallery item's `alt`; `{ label, href }` overlaps a
 * bento card in no way at all, and a card whose only field is a slot has nothing to overlap. Bookkeeping
 * keys do not count — every item has a `_key`, so counting it would admit everything.
 *
 * Deliberately conservative. A container we decline to record keeps its value-derived description, which
 * is imperfect but honest; a container recorded wrongly tells an authoring model to throw the item's
 * real fields away.
 */
export function containerAnswerIsUsable(candidateValue: unknown, previewItem: unknown): boolean {
  if (!isPlainObject(previewItem)) return false;

  const first = Array.isArray(candidateValue) ? candidateValue[0] : candidateValue;
  if (!isPlainObject(first)) return false;

  const authorable = Object.keys(previewItem).filter((k) => !k.startsWith('_') && !isElementLike(previewItem[k]));
  return Object.keys(first).some((k) => authorable.includes(k));
}
