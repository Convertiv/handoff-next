/**
 * A structured record of one playground chat turn.
 *
 * Written because the iteration loop was the real problem. Four attempts at one behaviour in an evening,
 * three of which made it worse, because the only visible output was the assistant's prose — and prose is
 * exactly what goes wrong. The model narrated a page it never proposed; the reply gave no hint that
 * `propose_page` had been called, rejected by a retry, and abandoned.
 *
 * The tool sequence and the reason for every retry would have identified each of those in one run. So
 * this records what the turn *did*, not what it said, and derives flags for the failures already seen —
 * so a regression shows up as a count rather than as somebody noticing.
 *
 * Pure: the caller owns persistence.
 */

export type TurnOutcome = 'proposal' | 'changeset' | 'reply-only' | 'exhausted';

export interface TurnRetry {
  /** Which guard fired — `imagery`, `unplaced-images`, `content-gaps`, `no-proposal`, `bad-edits`. */
  kind: string;
  detail?: string;
}

export interface TurnFacts {
  prompt: string;
  rounds: number;
  toolsUsed: string[];
  retries: TurnRetry[];
  outcome: TurnOutcome;
  hasCanvas: boolean;
  blocks: number;
  /** Images the turn asked to generate. */
  queuedImages: number;
  /** Image slots left on a placeholder in the result. */
  placeholderImages: number;
  /** Generated images whose src never reached a block — the failure that stranded them. */
  unplacedImages: number;
  durationMs: number;
}

/**
 * Objective failures, computed rather than judged.
 *
 * Each one is a regression that actually shipped, and each is checkable without reading the reply.
 */
export interface TurnFlags {
  /** Read the catalog and produced nothing to apply. Cost three deploys to identify by hand. */
  noProposal: boolean;
  /** Generated images that reached no block — they wait forever for a slot that never appears. */
  strandedImages: boolean;
  /** Hit the round cap. Means a guard is looping or the composition is too big for the budget. */
  exhausted: boolean;
  /** More than one guard fired. Usually two instructions disagreeing, which is how the last one broke. */
  contested: boolean;
}

export function flagsFor(facts: TurnFacts): TurnFlags {
  return {
    noProposal: facts.outcome === 'reply-only' && facts.toolsUsed.includes('list_blocks'),
    strandedImages: facts.unplacedImages > 0,
    exhausted: facts.outcome === 'exhausted',
    contested: facts.retries.length > 1,
  };
}

/** One line for a log scan: what the turn did and whether anything is wrong with it. */
export function describeTurn(facts: TurnFacts): string {
  const flags = flagsFor(facts);
  const bad = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k);
  const retries = facts.retries.length ? ` retries=[${facts.retries.map((r) => r.kind).join(',')}]` : '';
  return (
    `${facts.outcome} rounds=${facts.rounds} tools=[${facts.toolsUsed.join(',')}]${retries} ` +
    `blocks=${facts.blocks} img(queued=${facts.queuedImages},placeholder=${facts.placeholderImages},` +
    `unplaced=${facts.unplacedImages})${bad.length ? ` ⚠️ ${bad.join(' ')}` : ''}`
  );
}
