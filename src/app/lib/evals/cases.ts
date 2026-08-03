/**
 * The eval suite: fixed prompts, and structural assertions about what the turn did.
 *
 * Every case here is a bug that shipped. That is the only source worth having early — invented cases
 * measure imagined failures, and we have a supply of real ones.
 *
 * Three rules this file exists to enforce, all learned the hard way:
 *
 * **Assert on the trace, never on the prose.** "Called `propose_page`", "eight blocks", "zero images
 * left unplaced". Not "the copy is good". The turn that cost the most to diagnose read beautifully and
 * described a page it had never proposed — an LLM judge would have passed it.
 *
 * **A case does not pass or fail; it has a rate.** The model is stochastic. One green run proves very
 * little and one red run may be noise, so the runner samples and reports a fraction. That is the whole
 * practical difference from unit testing.
 *
 * **Invariants beat expectations.** "No generated image is left unplaced" holds for every case and
 * never needs updating. "Proposes exactly eight blocks" is brittle and will be edited until it passes,
 * which is how a suite stops meaning anything.
 *
 * Pure — no model, no network, no DB. The runner supplies observations; these only judge them. That
 * keeps the judgements unit-testable for free, which matters because a broken assertion reads exactly
 * like a broken agent.
 */

import type { TurnFacts } from '../turn-log';

/** A canvas block, as the chat receives it. */
export interface CanvasBlock {
  componentId: string;
  args?: Record<string, unknown>;
}

/**
 * What the runner saw. Deliberately narrow: everything here is machine-checkable, and the reply is
 * present only so a failure can be read by a human, never asserted on.
 */
export interface EvalObservation {
  facts: TurnFacts;
  blocks: { componentId: string; args?: Record<string, unknown> }[];
  ops: { op: string; blockId?: string; values?: Record<string, unknown> }[];
  rejected: { reason: string }[];
  /**
   * The placeholder src each queued generation is filling.
   *
   * Not a final URL — the real one arrives later by polling. A placeholder that appears nowhere in the
   * result is an image nothing will ever collect, which is the stranding failure exactly.
   */
  queuedImageSrcs: string[];
  reply: string;
}

/** Holds → null. Fails → a one-line reason, which is what gets printed. */
export interface EvalCheck {
  name: string;
  run: (o: EvalObservation) => string | null;
}

export interface EvalCase {
  id: string;
  /** Why this case exists — the bug it came from. Printed on failure. */
  origin: string;
  prompt: string;
  /** Blocks already on the canvas. Empty means composing a new page. */
  canvas: CanvasBlock[];
  checks: EvalCheck[];
  /** In the three-case smoke set, run before a prompt change. */
  smoke?: boolean;
  /**
   * Needs a real user id, because `request_image` is gated on one.
   *
   * Without it the tool returns "image generation is unavailable", the turn queues nothing, and every
   * imagery check passes by having nothing to check. That vacuous green is worse than a red — the first
   * smoke run reported 3/3 for a case where the agent did no work at all. The runner **skips** these
   * rather than running them, so the absence shows up as a gap instead of a pass.
   */
  requiresUser?: boolean;
  /**
   * A brief sent as framed source copy, the way the paste panel sends it.
   *
   * The runner does the framing with the real catalog, so the case exercises the whole path — name
   * resolution included — rather than a pre-framed string that would freeze today's wording and stop
   * catching framing regressions.
   */
  sourceCopy?: string;
}

// ── Invariants ───────────────────────────────────────────────────────────────
//
// Applied to every case, so a fix that breaks something unrelated is caught by the case that was
// already passing rather than by nobody.

export const INVARIANTS: EvalCheck[] = [
  {
    name: 'no-stranded-images',
    // Generated images that reached no block. They cost real money, and they wait forever for a slot
    // that never appears. Shipped twice.
    run: (o) => (o.facts.unplacedImages > 0 ? `${o.facts.unplacedImages} generated image(s) reached no block` : null),
  },
  {
    name: 'not-exhausted',
    // The round cap means a guard is looping or the composition outgrew the budget. Either way the user
    // gets nothing after 30 seconds.
    run: (o) => (o.facts.outcome === 'exhausted' ? `hit the round cap after ${o.facts.rounds} rounds` : null),
  },
  {
    name: 'guards-agree',
    // More than one retry means two instructions disagreeing. Every regression in the imagery work
    // looked like this first: the placement guard contradicted the canvas gate, and the turn produced
    // nothing while both were technically satisfied.
    run: (o) =>
      o.facts.retries.length > 1
        ? `${o.facts.retries.length} guards fired — ${o.facts.retries.map((r) => r.kind).join(', ')}`
        : null,
  },
];

/**
 * Watched, not judged.
 *
 * A signal is a real quality property that is not a pass/fail: `content-gaps` firing means the model
 * left image slots empty on its first pass and the guard caught it. The system worked — but if that
 * goes from 3-in-10 to 9-in-10 after a prompt change, something got worse in a way no red run would
 * show. Asserting zero retries instead would fail every run today, and the response to a check that
 * always fails is to delete it.
 */
export const SIGNALS: EvalCheck[] = [
  {
    name: 'first-pass-incomplete',
    run: (o) => {
      const gaps = o.facts.retries.filter((r) => r.kind === 'content-gaps');
      return gaps.length ? 'content-gaps fired — fields left empty on the first pass' : null;
    },
  },
  {
    name: 'left-placeholders',
    run: (o) => (o.facts.placeholderImages > 0 ? `${o.facts.placeholderImages} image slot(s) still on a placeholder` : null),
  },
  {
    name: 'rejected-values',
    run: (o) => (o.rejected.length ? `${o.rejected.length} value(s) rejected` : null),
  },
];

// ── Checks ───────────────────────────────────────────────────────────────────

const proposed: EvalCheck = {
  name: 'proposed-a-page',
  run: (o) => (o.facts.outcome === 'proposal' ? null : `outcome was ${o.facts.outcome}, not a proposal`),
};

const atLeastBlocks = (n: number): EvalCheck => ({
  name: `at-least-${n}-blocks`,
  // A floor, not an exact count. The exact number is the model's judgement and would be edited until it
  // passed; "enough to be a page" is the property that actually matters.
  run: (o) => (o.blocks.length >= n ? null : `proposed ${o.blocks.length} block(s), wanted ${n}+`),
});

const didNotCall = (tool: string): EvalCheck => ({
  name: `did-not-call-${tool}`,
  run: (o) => (o.facts.toolsUsed.includes(tool) ? `called ${tool}` : null),
});

const changeset: EvalCheck = {
  name: 'produced-a-changeset',
  run: (o) => (o.facts.outcome === 'changeset' ? null : `outcome was ${o.facts.outcome}, not a changeset`),
};

const opsAreNonEmpty: EvalCheck = {
  name: 'ops-carry-values',
  // "Update block 2 — no fields", then "Applied". `buildBlocks` logged the unknown keys and dropped
  // them, so an empty update was emitted and the UI reported success for a no-op.
  run: (o) => {
    const empty = o.ops.filter((op) => op.op === 'update' && !Object.keys(op.values ?? {}).length);
    return empty.length ? `${empty.length} update op(s) with no values` : null;
  },
};

/**
 * A change to an existing page must not come back as a whole new page.
 *
 * The most destructive failure Monica found, reported four different ways: asking for "# for all links
 * and Learn More for all CTA labels" returned all-new blocks; asking to change one component's type
 * added a second one instead of swapping; asking to add a form section proposed replacing everything.
 * Her words on accepting it: "this eliminates all of your changes upstream and starts you from scratch
 * again (like image direction, link changes, etc.)".
 *
 * That is the cost that makes this worse than a wrong answer. A wrong edit is one undo. A re-proposed
 * page silently discards every earlier decision, and the user cannot tell until they look.
 */
const editedRatherThanRebuilt: EvalCheck = {
  name: 'edited-not-rebuilt',
  run: (o) =>
    o.facts.outcome === 'proposal'
      ? `re-proposed ${o.blocks.length} blocks instead of editing the ${o.facts.hasCanvas ? 'existing' : ''} page`
      : null,
};

/**
 * The blocks the brief asked for are the blocks that got used.
 *
 * "The copy doc suggested Split Content and Handoff provided Simple Copy" — two components with no words
 * in common. The brief named what it wanted and nothing read it.
 */
const usesComponents = (ids: string[]): EvalCheck => ({
  name: 'used-the-named-blocks',
  run: (o) => {
    const used = new Set([...o.blocks.map((b) => b.componentId), ...o.ops.map((op) => op.blockId ?? '')]);
    const missing = ids.filter((id) => !used.has(id));
    return missing.length ? `did not use ${missing.join(', ')} — got [${[...used].join(', ')}]` : null;
  },
});

/** At least one op of a given kind — a swap must swap, not append a second block. */
const usesOp = (kind: string): EvalCheck => ({
  name: `uses-${kind}`,
  run: (o) => {
    const kinds = o.ops.map((op) => op.op);
    return kinds.includes(kind) ? null : `ops were [${kinds.join(', ') || 'none'}], wanted a ${kind}`;
  },
});

/** No more ops than the request implies. A "change one block" that touches six is a rebuild in disguise. */
const atMostOps = (n: number): EvalCheck => ({
  name: `at-most-${n}-ops`,
  run: (o) => (o.ops.length <= n ? null : `${o.ops.length} ops for a change that needs at most ${n}`),
});

/**
 * The turn actually produced something.
 *
 * Guards against the vacuous pass. `fill-the-images` scored 3/3 on its first run while calling
 * `request_image` three times, queueing nothing and proposing nothing — every imagery check returned
 * null because there was no imagery to judge. A check that cannot fail reports a green rate for a
 * behaviour nobody is measuring.
 */
const didWork: EvalCheck = {
  name: 'turn-did-work',
  run: (o) => {
    if (o.facts.outcome === 'proposal' || o.facts.outcome === 'changeset') return null;
    if (o.queuedImageSrcs.length) return null;
    return `outcome ${o.facts.outcome} with nothing queued after [${o.facts.toolsUsed.join(', ')}]`;
  },
};

/** Every image the turn generated appears somewhere in the result. */
const everyQueuedImageIsPlaced: EvalCheck = {
  name: 'queued-images-are-placed',
  run: (o) => {
    if (!o.queuedImageSrcs.length) return null;
    const haystack = JSON.stringify([o.blocks, o.ops]);
    const missing = o.queuedImageSrcs.filter((src) => !haystack.includes(src));
    return missing.length ? `${missing.length} of ${o.queuedImageSrcs.length} queued image(s) not referenced` : null;
  },
};

/**
 * Every item of an array field is authored.
 *
 * A live page came back with four stat objects whose every field was blank, because "array" alone does
 * not say each item needs filling. Checked structurally: an object item with no non-empty scalar is
 * unauthored regardless of which keys it has, so this survives the item shape changing.
 */
const arrayItemsAreAuthored: EvalCheck = {
  name: 'array-items-authored',
  run: (o) => {
    // Recursive, because an item can be authored entirely through a nested object — `{ image: { src } }`
    // has no scalar of its own, and calling that blank is the false positive that gets a check deleted.
    const hasContent = (value: unknown): boolean => {
      if (value === null || value === undefined) return false;
      if (Array.isArray(value)) return value.some(hasContent);
      if (typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).some(([k, v]) => !k.startsWith('_') && hasContent(v));
      }
      return String(value).trim() !== '';
    };

    const blank: string[] = [];
    for (const block of o.blocks) {
      for (const [field, value] of Object.entries(block.args ?? {})) {
        if (!Array.isArray(value) || !value.length) continue;
        const empty = value.filter((item) => item !== null && typeof item === 'object' && !hasContent(item));
        if (empty.length) blank.push(`${block.componentId}.${field} (${empty.length})`);
      }
    }
    return blank.length ? `blank array items in ${blank.join(', ')}` : null;
  },
};

/**
 * The page reaches the asset store at least once when imagery was asked for.
 *
 * Page-level rather than per-block on purpose. Naming a component — `hero-background` must have a real
 * image — fails whenever the model picks a different hero, and the response to that failure is to edit
 * the case, which is how a suite stops meaning anything. "Asked for pictures, got at least one real
 * one" is the property that actually broke: a whole page of `placehold.co` while the reply claimed
 * every field was fully authored.
 */
const pageHasRealImagery: EvalCheck = {
  name: 'page-has-real-imagery',
  run: (o) => {
    const json = JSON.stringify(o.blocks);
    const srcs = json.match(/"src"\s*:\s*"[^"]+"/g) ?? [];
    if (!srcs.length) return 'no image src anywhere in the proposal';
    return srcs.some((s) => !/placehold\.co/.test(s)) ? null : `all ${srcs.length} image src(s) are placeholders`;
  },
};

// ── Fixtures ─────────────────────────────────────────────────────────────────
//
// Hand-written, not recorded. A recording pins today's model output and turns every case into a
// change-detector; these pin only the *shape* the chat has to read, which is the part under test.

const APPLIED_PAGE: CanvasBlock[] = [
  {
    componentId: 'hero-background',
    args: {
      anchor: 'hero',
      theme: 'dark',
      titleSlot: 'Phone systems built for campus scale',
      bodySlot: '<p>One platform for every building, department and dorm.</p>',
      desktopImageSlot: { src: 'https://placehold.co/1600x900?text=Campus', alt: 'Campus' },
    },
  },
  {
    componentId: 'image-gallery',
    args: {
      anchor: 'gallery',
      title: 'Life on campus',
      images: [
        { src: 'https://placehold.co/800x600?text=Lecture', alt: 'Lecture hall' },
        { src: 'https://placehold.co/800x600?text=Library', alt: 'Library' },
      ],
    },
  },
];

/**
 * Six blocks with decisions already made in them — chosen imagery, authored copy, a real link.
 *
 * Bigger than `APPLIED_PAGE` on purpose. The failure being measured is destructive rather than merely
 * wrong, and its cost scales with how much work is already on the canvas: a two-block fixture makes
 * "re-proposed the page" look like a rounding error instead of the loss it is.
 */
const WORKED_PAGE: CanvasBlock[] = [
  {
    componentId: 'hero-background',
    args: {
      anchor: 'hero',
      theme: 'dark',
      titleSlot: 'Partner with 8x8',
      bodySlot: '<p>Grow your business with our partner programme.</p>',
      desktopImageSlot: { src: '/api/handoff/assets/img_bc532c785605/raw', alt: 'Partners in a meeting' },
      buttonSlots: [{ url: '/partners/apply', text: 'Become a partner' }],
    },
  },
  { componentId: 'content-split', args: { anchor: 'why', title: 'Why partner with us', theme: 'light' } },
  { componentId: 'card-rows', args: { anchor: 'tiers', title: 'Programme tiers' } },
  { componentId: 'grid-columns', args: { anchor: 'support', title: 'What you get' } },
  { componentId: 'faq', args: { anchor: 'faq', title: 'Partner questions' } },
  { componentId: 'callout-cta', args: { anchor: 'cta', title: 'Ready to apply?' } },
];

// ── The suite ────────────────────────────────────────────────────────────────

export const EVAL_CASES: EvalCase[] = [
  {
    id: 'fresh-page-with-imagery',
    origin:
      'Four attempts, three regressions. Asking for imagery first stopped proposals entirely; the fix ' +
      'was to compose the page and offer images after.',
    prompt: 'Build a landing page selling our phone systems to university clients, with good imagery.',
    canvas: [],
    smoke: true,
    checks: [proposed, atLeastBlocks(6), arrayItemsAreAuthored, didNotCall('request_image'), pageHasRealImagery],
  },
  {
    id: 'fresh-page-plain',
    origin: 'Retries mean two guards disagreeing. A plain request should fire none.',
    prompt: 'Build a short product page for our contact centre software.',
    canvas: [],
    // Dropped from the smoke set when `bulk-field-edit` joined it: fresh-page composition is already
    // covered by `fresh-page-with-imagery`, and a smoke set that grows stops being one.
    checks: [proposed, atLeastBlocks(4), arrayItemsAreAuthored],
  },
  {
    id: 'fill-the-images',
    origin: 'Generated images landed in the asset library and never reached the page.',
    prompt: 'Generate real images for this page and put them in.',
    canvas: APPLIED_PAGE,
    smoke: true,
    requiresUser: true,
    checks: [didWork, everyQueuedImageIsPlaced],
  },
  {
    id: 'edit-the-headline',
    origin: '"Update block 2 — no fields", then "Applied". An empty update reported as success.',
    prompt: 'Make the hero headline shorter.',
    canvas: APPLIED_PAGE,
    checks: [changeset, opsAreNonEmpty],
  },
  {
    id: 'gallery-four-images',
    origin:
      'image-gallery generated three images and placed none — nothing had measured images[].thumbnailSlot, ' +
      'and the authorable shape is [{ src, alt }] on the container.',
    prompt: 'Add four images of students on campus to the gallery.',
    canvas: APPLIED_PAGE,
    requiresUser: true,
    checks: [didWork, everyQueuedImageIsPlaced, arrayItemsAreAuthored],
  },
  {
    id: 'bulk-field-edit',
    origin:
      'Monica asked for "# for all links and Learn More for all CTA labels" on a finished page. It ' +
      'returned all-new blocks; accepting them discarded every earlier decision — imagery, link changes, ' +
      'copy corrections.',
    prompt: 'Use # for all the links on this page, and "Learn More" for every CTA label.',
    canvas: WORKED_PAGE,
    smoke: true,
    checks: [editedRatherThanRebuilt, changeset, opsAreNonEmpty],
  },
  {
    id: 'swap-a-component',
    origin: 'Asked to change a block to a different component type, it added the new one instead of swapping.',
    prompt: 'Change the "Why partner with us" section to a stats block instead.',
    canvas: WORKED_PAGE,
    checks: [editedRatherThanRebuilt, usesOp('replace'), atMostOps(2)],
  },
  {
    id: 'add-one-section',
    origin:
      'Asked to add a partner form, it proposed replacing the whole page. "Doing this eliminates all of ' +
      'your changes upstream and starts you from scratch again."',
    prompt: 'Add a form section after the hero so partners can register their interest.',
    canvas: WORKED_PAGE,
    checks: [editedRatherThanRebuilt, usesOp('insert'), atMostOps(2)],
  },
  {
    id: 'brief-names-components',
    origin:
      'A brief with a Component column asked for Split Content and got Simple Copy — two blocks with no ' +
      'words in common. "Split Content" and "Content Split" are the same words reversed, so nothing that ' +
      'compares strings in order would ever have matched them.\n\n' +
      'The copy here reads like a card grid while the brief asks for a two-column block, so the model\'s ' +
      'instinct and the brief disagree — the only way to tell whether the brief is being read at all. ' +
      'Measured without name resolution: 0 of 3, substituting content-split every time. A brief whose ' +
      'named blocks are also the obvious ones passed 3 of 3 either way and measured nothing.',
    prompt: 'Build this page.',
    sourceCopy: [
      '# Partner benefits',
      '',
      '| Section | Component | New Copy |',
      '| --- | --- | --- |',
      '| Benefits | Two Column Content | Higher margins. Faster deal registration. Dedicated support. |',
      '| Tiers | Simple Table | Silver, Gold, Platinum |',
    ].join('\n'),
    canvas: [],
    checks: [proposed, usesComponents(['two-column-content', 'simple-table'])],
  },
  {
    id: 'stats-not-inverted',
    origin: 'The model put "Uptime Guarantee" in `stat` and "99.999%" in `sub`, exactly inverted.',
    prompt: 'Add a stats band with four impressive numbers about our uptime and global reach.',
    canvas: APPLIED_PAGE,
    checks: [
      arrayItemsAreAuthored,
      {
        name: 'stat-holds-the-number',
        // The key names alone do not say which is the number, which is exactly why this inverted. A
        // digit in `stat` is the property; the label's wording is not asserted.
        run: (o) => {
          const items = [...o.blocks, ...o.ops.map((op) => ({ componentId: op.blockId ?? '?', args: op.values }))]
            .flatMap((b) => Object.values(b.args ?? {}))
            .filter(Array.isArray)
            .flat()
            .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && 'stat' in i);
          if (!items.length) return null;
          const inverted = items.filter((i) => !/\d/.test(String(i.stat ?? '')));
          return inverted.length ? `${inverted.length} stat item(s) with no digit in \`stat\`` : null;
        },
      },
    ],
  },
];

/** The set worth running before a prompt change. A suite that takes twenty minutes gets skipped. */
export const SMOKE_CASES = EVAL_CASES.filter((c) => c.smoke);

/** Run one case's checks plus the universal invariants. Returns the failures, empty when it passed. */
export function judge(kase: EvalCase, observation: EvalObservation): string[] {
  return [...kase.checks, ...INVARIANTS]
    .map((check) => {
      const failure = check.run(observation);
      return failure ? `${check.name}: ${failure}` : null;
    })
    .filter((f): f is string => f !== null);
}

/**
 * A case's result over n runs.
 *
 * Reported as a fraction because that is what the number means. A single run is not evidence, and
 * rounding it to pass/fail throws away the only signal that distinguishes a real regression from the
 * model having a bad afternoon.
 */
export interface CaseResult {
  caseId: string;
  runs: number;
  passed: number;
  /** Failure text → how many runs hit it. The distribution is the diagnosis. */
  failures: Record<string, number>;
  /** Signal name → how many runs showed it. Watched over time, never a verdict. */
  signals: Record<string, number>;
  /** True when the case could not be run at all — reported as a gap, never as a pass. */
  skipped?: boolean;
  medianSeconds: number;
}

export function observeSignals(o: EvalObservation): string[] {
  return SIGNALS.map((s) => (s.run(o) ? s.name : null)).filter((n): n is string => n !== null);
}

export function summarize(
  caseId: string,
  runs: { failures: string[]; signals?: string[]; seconds: number }[]
): CaseResult {
  const failures: Record<string, number> = {};
  const signals: Record<string, number> = {};
  for (const run of runs) {
    for (const f of run.failures) failures[f] = (failures[f] ?? 0) + 1;
    for (const g of run.signals ?? []) signals[g] = (signals[g] ?? 0) + 1;
  }
  const seconds = runs.map((r) => r.seconds).sort((a, b) => a - b);
  return {
    caseId,
    runs: runs.length,
    passed: runs.filter((r) => !r.failures.length).length,
    failures,
    signals,
    medianSeconds: seconds.length ? seconds[Math.floor(seconds.length / 2)]! : 0,
  };
}
