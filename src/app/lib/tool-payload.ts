/**
 * Keep a tool result inside its budget without lying about it.
 *
 * `list_blocks` returned 32,270 characters against a 24,000-character cap, and the cap was applied as
 * `JSON.stringify(result).slice(0, 24_000)`. Two things followed, both silent:
 *
 * - **16 of 77 components never reached the model** — everything alphabetically after `simple-copy`,
 *   including `two-column-content`, `stats`, `timeline`, `simple-table` and `three-card-carousel`.
 * - The result was **invalid JSON**, cut mid-string.
 *
 * That is the whole of "the component matchup is a little off". A ten-section brief came back as six
 * consecutive `simple-copy` blocks because `simple-copy` is the last generic content block that survives
 * the cut, and the alternatives were not in the list to be chosen.
 *
 * Slicing a serialized payload is the wrong operation. A list has *entries*; drop whole entries, and say
 * how many went, so a model that needs the rest can ask rather than assume it has seen everything.
 *
 * Pure.
 */

export interface PackedPayload<T> {
  items: T[];
  /** How many were left out. Zero when everything fit. */
  dropped: number;
}

/**
 * Fit as many entries as the budget allows, whole.
 *
 * Measured against the serialized length of each entry plus its separator, so the result is the real
 * wire size rather than an estimate that drifts once a field grows.
 */
export function packToBudget<T>(items: T[], budgetChars: number): PackedPayload<T> {
  const kept: T[] = [];
  // The enclosing brackets, plus room for the note a caller appends when anything is dropped.
  let used = 2;

  for (const item of items) {
    const size = JSON.stringify(item).length + 1;
    if (used + size > budgetChars) break;
    used += size;
    kept.push(item);
  }

  return { items: kept, dropped: items.length - kept.length };
}

/**
 * What to tell the model when entries were left out.
 *
 * Named counts rather than "some results omitted": a model told the list is partial can narrow by group,
 * and one told nothing will compose from whatever it happens to have seen — which is exactly what
 * produced six identical blocks.
 */
export function truncationNote(dropped: number, total: number, narrowHint: string): string | null {
  if (dropped <= 0) return null;
  return (
    `${dropped} of ${total} entries were left out to fit the response. ${narrowHint} ` +
    'Do not assume the list is complete.'
  );
}

/** Abbreviations whose full stop does not end a sentence. */
const ABBREVIATIONS = /(?:\be\.g|\bi\.e|\betc|\bvs|\bapprox|\bNo|\b[A-Z])$/;

function firstSentence(text: string): string {
  const pattern = /\.\s/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const head = text.slice(0, match.index);
    // A sentence needs some substance, and must not end on an abbreviation.
    if (head.length > 20 && !ABBREVIATIONS.test(head)) return `${head}.`;
  }
  return text;
}

/**
 * One line saying what a component is *for*.
 *
 * The registry holds an authored description and should-do guidance for every block, and `list_blocks`
 * sent neither — so the model chose from ids and field names alone. `simple-copy`'s own guidance says
 * "use for simple copy blocks such as legal pages, terms, and informational text", which is precisely
 * not what it was being used for.
 *
 * First sentence only, markdown emphasis stripped. Full descriptions run to paragraphs and carry
 * field-level notes that belong in `describe_blocks`, not in a 77-entry list that is replayed on every
 * round of the loop.
 */
export function purposeLine(description: unknown, maxChars = 130): string {
  const clean = String(description ?? '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return '';

  // The first sentence end that is not an abbreviation. A plain `/\.\s/` cut `card-rows` at
  // "…in a scannable row format (e.g." — the guidance most worth reading is often the example after it.
  const sentence = firstSentence(clean);
  return sentence.length > maxChars ? `${sentence.slice(0, maxChars - 1).trimEnd()}…` : sentence;
}
