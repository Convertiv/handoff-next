import assert from 'node:assert';
import { describe, it } from 'node:test';
import { describeTurn, flagsFor, type TurnFacts } from '../src/app/lib/turn-log';

const facts = (over: Partial<TurnFacts> = {}): TurnFacts => ({
  prompt: 'sell our phone systems to university clients',
  rounds: 3,
  toolsUsed: ['list_blocks', 'propose_page'],
  retries: [],
  outcome: 'proposal',
  hasCanvas: false,
  blocks: 8,
  queuedImages: 0,
  placeholderImages: 0,
  unplacedImages: 0,
  durationMs: 12000,
  ...over,
});

/** Each flag is a regression that actually shipped, and each is checkable without reading the reply. */
describe('flagsFor', () => {
  it('catches the turn that read the catalog and proposed nothing', () => {
    // Three deploys to identify by hand, because the reply confidently described the page.
    const f = flagsFor(facts({ outcome: 'reply-only', toolsUsed: ['list_blocks', 'request_image'] }));
    assert.equal(f.noProposal, true);
  });

  it('does not flag a plain conversational reply as a failed composition', () => {
    const f = flagsFor(facts({ outcome: 'reply-only', toolsUsed: [] }));
    assert.equal(f.noProposal, false);
  });

  it('catches images generated but never placed', () => {
    assert.equal(flagsFor(facts({ queuedImages: 3, unplacedImages: 3 })).strandedImages, true);
    assert.equal(flagsFor(facts({ queuedImages: 3, unplacedImages: 0 })).strandedImages, false);
  });

  it('flags more than one retry as contested', () => {
    // Two guards firing usually means two instructions disagreeing — how the last regression happened.
    assert.equal(flagsFor(facts({ retries: [{ kind: 'imagery' }, { kind: 'no-proposal' }] })).contested, true);
    assert.equal(flagsFor(facts({ retries: [{ kind: 'imagery' }] })).contested, false);
  });

  it('flags the round cap', () => {
    assert.equal(flagsFor(facts({ outcome: 'exhausted' })).exhausted, true);
  });

  it('reports nothing wrong with a clean proposal', () => {
    assert.deepEqual(Object.values(flagsFor(facts())).filter(Boolean), []);
  });
});

describe('describeTurn', () => {
  it('puts the tool sequence and retries on one scannable line', () => {
    const line = describeTurn(facts({ retries: [{ kind: 'content-gaps' }], queuedImages: 2 }));
    assert.match(line, /tools=\[list_blocks,propose_page\]/);
    assert.match(line, /retries=\[content-gaps\]/);
    assert.match(line, /queued=2/);
  });

  it('marks a bad turn visibly', () => {
    const line = describeTurn(facts({ outcome: 'reply-only', unplacedImages: 2 }));
    assert.match(line, /⚠️/);
    assert.match(line, /noProposal/);
    assert.match(line, /strandedImages/);
  });

  it('leaves a clean turn unmarked', () => {
    assert.ok(!describeTurn(facts()).includes('⚠️'));
  });
});
