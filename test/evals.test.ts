import assert from 'node:assert';
import { describe, it } from 'node:test';
import { EVAL_CASES, INVARIANTS, SMOKE_CASES, judge, summarize } from '../src/app/lib/evals/cases';
import type { EvalCase, EvalObservation } from '../src/app/lib/evals/cases';
import type { TurnFacts } from '../src/app/lib/turn-log';

/**
 * The judgements are pure, so they cost nothing to test — and they need it more than most code.
 *
 * **A broken assertion reads exactly like a broken agent.** A check that never fires reports a green
 * rate for a behaviour nobody is measuring, and a check that always fires gets loosened until it
 * passes. Both end with a suite that means nothing, and neither is visible from the runner's output.
 * So every check here is exercised against an observation that should fail it *and* one that should
 * not.
 */

const facts = (over: Partial<TurnFacts> = {}): TurnFacts => ({
  prompt: 'p',
  rounds: 3,
  toolsUsed: ['list_blocks', 'propose_page'],
  retries: [],
  outcome: 'proposal',
  hasCanvas: false,
  blocks: 8,
  queuedImages: 0,
  placeholderImages: 0,
  unplacedImages: 0,
  durationMs: 20_000,
  ...over,
});

const observe = (over: Partial<EvalObservation> = {}): EvalObservation => ({
  facts: facts(),
  blocks: [],
  ops: [],
  rejected: [],
  queuedImageSrcs: [],
  reply: '',
  ...over,
});

const check = (name: string) =>
  INVARIANTS.concat(EVAL_CASES.flatMap((c) => c.checks)).find((c) => c.name === name)!;

describe('invariants', () => {
  it('catches stranded images — generated, paid for, and reaching no block', () => {
    assert.match(check('no-stranded-images').run(observe({ facts: facts({ unplacedImages: 2 }) }))!, /2 generated/);
    assert.equal(check('no-stranded-images').run(observe()), null);
  });

  it('catches an exhausted turn, which is a looping guard or a composition over budget', () => {
    assert.ok(check('not-exhausted').run(observe({ facts: facts({ outcome: 'exhausted', rounds: 8 }) })));
    assert.equal(check('not-exhausted').run(observe()), null);
  });

  it('catches two guards firing, which is how every imagery regression started', () => {
    const contested = facts({ retries: [{ kind: 'imagery' }, { kind: 'content-gaps' }] });
    assert.match(check('guards-agree').run(observe({ facts: contested }))!, /imagery, content-gaps/);
    // One retry is normal — a single guard doing its job, not two disagreeing.
    assert.equal(check('guards-agree').run(observe({ facts: facts({ retries: [{ kind: 'content-gaps' }] }) })), null);
  });
});

describe('checks', () => {
  it('fails a turn that replied instead of proposing — the bug that cost three deploys', () => {
    // The reply read beautifully and described a page that had never been proposed.
    assert.match(check('proposed-a-page').run(observe({ facts: facts({ outcome: 'reply-only' }) }))!, /reply-only/);
    assert.equal(check('proposed-a-page').run(observe()), null);
  });

  it('fails an update op with no values, which the UI reported as "Applied"', () => {
    const empty = observe({ ops: [{ op: 'update', blockId: 'b2', values: {} }] });
    assert.match(check('ops-carry-values').run(empty)!, /1 update op/);
    assert.equal(check('ops-carry-values').run(observe({ ops: [{ op: 'update', values: { titleSlot: 'x' } }] })), null);
  });

  it('fails a queued image whose placeholder is nowhere in the result', () => {
    const stranded = observe({ queuedImageSrcs: ['https://placehold.co/a'], blocks: [{ componentId: 'hero' }] });
    assert.match(check('queued-images-are-placed').run(stranded)!, /1 of 1/);

    const placed = observe({
      queuedImageSrcs: ['https://placehold.co/a'],
      blocks: [{ componentId: 'hero', args: { desktopImageSlot: { src: 'https://placehold.co/a' } } }],
    });
    assert.equal(check('queued-images-are-placed').run(placed), null);
  });

  it('finds a placeholder placed by an edit op, not only by a proposal', () => {
    // The changeset path is the one `facts.unplacedImages` does not cover, which is why this check
    // exists alongside the invariant rather than duplicating it.
    const viaOps = observe({
      queuedImageSrcs: ['https://placehold.co/a'],
      ops: [{ op: 'update', blockId: 'b1', values: { imageSlot: { src: 'https://placehold.co/a' } } }],
    });
    assert.equal(check('queued-images-are-placed').run(viaOps), null);
  });

  it('fails blank array items — four stat objects with every field empty shipped', () => {
    const blank = observe({ blocks: [{ componentId: 'stats', args: { stats: [{ stat: '', sub: '' }, { stat: '99.9%' }] } }] });
    assert.match(check('array-items-authored').run(blank)!, /stats\.stats \(1\)/);
  });

  it('does not fail an item authored only through a nested object', () => {
    // `images: [{ src, alt }]` has no top-level scalar beyond the strings themselves; an item whose only
    // content is a nested object is still authored, and failing it would be the false positive that
    // gets the check deleted.
    const nested = observe({ blocks: [{ componentId: 'g', args: { images: [{ image: { src: 'a' }, alt: 'A' }] } }] });
    assert.equal(check('array-items-authored').run(nested), null);

    // No scalar of its own at all — still authored. This is the shape a measured `image-object` slot
    // produces, so getting it wrong would fail every gallery the new capability records fix.
    const onlyNested = observe({ blocks: [{ componentId: 'g', args: { images: [{ thumbnailSlot: { src: 'a' } }] } }] });
    assert.equal(check('array-items-authored').run(onlyNested), null);
  });

  it('ignores bookkeeping when deciding an item is blank', () => {
    const onlyKey = observe({ blocks: [{ componentId: 'g', args: { cards: [{ _key: 'c1', _type: 'card' }] } }] });
    assert.match(check('array-items-authored').run(onlyKey)!, /cards \(1\)/);
  });

  it('fails a page of nothing but placeholders when imagery was asked for', () => {
    const allFake = observe({
      blocks: [{ componentId: 'hero', args: { desktopImageSlot: { src: 'https://placehold.co/1600x900' } } }],
    });
    assert.match(check('page-has-real-imagery').run(allFake)!, /all 1 image src/);

    const real = observe({
      blocks: [
        { componentId: 'hero', args: { desktopImageSlot: { src: '/api/handoff/assets/img_abc/raw' } } },
        { componentId: 'g', args: { images: [{ src: 'https://placehold.co/x' }] } },
      ],
    });
    assert.equal(check('page-has-real-imagery').run(real), null);
  });

  it('fails a stat item with no digit in `stat` — the inversion that shipped', () => {
    const inverted = observe({ blocks: [{ componentId: 's', args: { stats: [{ stat: 'Uptime Guarantee', sub: '99.999%' }] } }] });
    const c = EVAL_CASES.find((k) => k.id === 'stats-not-inverted')!.checks.find((x) => x.name === 'stat-holds-the-number')!;
    assert.match(c.run(inverted)!, /1 stat item/);
    assert.equal(c.run(observe({ blocks: [{ componentId: 's', args: { stats: [{ stat: '99.999%', sub: 'Uptime' }] } }] })), null);
  });
});

describe('judge', () => {
  it('applies the invariants on top of a case’s own checks', () => {
    const kase: EvalCase = { id: 'k', origin: 'test', prompt: 'p', canvas: [], checks: [] };
    const failures = judge(kase, observe({ facts: facts({ unplacedImages: 1, outcome: 'exhausted' }) }));
    assert.equal(failures.length, 2);
    assert.ok(failures.every((f) => f.includes(': ')), 'each failure names the check that produced it');
  });

  it('returns nothing for a clean turn', () => {
    assert.deepEqual(judge({ id: 'k', origin: '', prompt: '', canvas: [], checks: [] }, observe()), []);
  });
});

describe('summarize', () => {
  it('reports a rate rather than a verdict, because the model is stochastic', () => {
    const r = summarize('c', [{ failures: [], seconds: 20 }, { failures: ['x: y'], seconds: 30 }, { failures: [], seconds: 25 }]);
    assert.equal(r.passed, 2);
    assert.equal(r.runs, 3);
    assert.equal(r.medianSeconds, 25);
  });

  it('counts how often each failure occurred — the distribution is the diagnosis', () => {
    // "Failed twice for the same reason" and "failed twice for different reasons" want different fixes.
    const r = summarize('c', [{ failures: ['a: 1'], seconds: 1 }, { failures: ['a: 1', 'b: 2'], seconds: 1 }]);
    assert.deepEqual(r.failures, { 'a: 1': 2, 'b: 2': 1 });
  });

  it('handles zero runs without dividing by nothing', () => {
    assert.deepEqual(summarize('c', []), { caseId: 'c', runs: 0, passed: 0, failures: {}, medianSeconds: 0 });
  });
});

describe('the suite itself', () => {
  it('has a smoke set small enough to actually run', () => {
    assert.ok(SMOKE_CASES.length >= 2 && SMOKE_CASES.length <= 3, `${SMOKE_CASES.length} smoke cases`);
  });

  it('gives every case a unique id, since results are keyed by it', () => {
    assert.equal(new Set(EVAL_CASES.map((c) => c.id)).size, EVAL_CASES.length);
  });

  it('records where every case came from — an invented case measures an imagined failure', () => {
    for (const c of EVAL_CASES) {
      assert.ok(c.origin.length > 20, `${c.id} has no origin`);
      assert.ok(c.checks.length, `${c.id} asserts nothing`);
    }
  });
});
