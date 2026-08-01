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
