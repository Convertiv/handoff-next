/**
 * Naming a page or template — the decisions, separated from the writing.
 *
 * Same split as `decidePatternMetaChange` and `authz/notes.ts`: what should happen is a pure function that can
 * be tested without a database or a DOM, and the component and the context both call it rather than each
 * carrying their own copy of the rule. The bug this file exists because of was precisely a rule with no home —
 * see `PageTitle`.
 */

/** The names the app gives a record it created for you, before you have called it anything. */
const PLACEHOLDER = /^untitled (page|template)$/i;

/**
 * Whether this title is the app's placeholder rather than something a person chose.
 *
 * Used to style it as a prompt instead of as a name. Deliberately a match on the exact placeholders and not
 * "starts with untitled" — someone who names a page "Untitled Draft Notes" has named it.
 */
export function isPlaceholderTitle(title: string): boolean {
  return PLACEHOLDER.test(title.trim());
}

export type RenameDecision =
  | { rename: false; reason: 'empty' | 'unchanged' | 'no-record' }
  | { rename: true; title: string };

/**
 * Should this draft be written, and as what?
 *
 * Trims first, so trailing whitespace never counts as a change and never reaches the database. Refuses an
 * empty name outright: the alternative is a library of blank cards, which is worse than the placeholder it
 * would replace.
 */
export function decideRename(args: {
  recordId: string | null;
  current: string;
  draft: string;
}): RenameDecision {
  if (!args.recordId) return { rename: false, reason: 'no-record' };
  const title = args.draft.trim();
  if (!title) return { rename: false, reason: 'empty' };
  if (title === args.current.trim()) return { rename: false, reason: 'unchanged' };
  return { rename: true, title };
}
