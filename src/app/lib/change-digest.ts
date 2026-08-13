import type { BlockDiff, FieldChange } from './guest-editable';

/**
 * What changed, in a sentence.
 *
 * The review diff answers the question one field at a time, which is right when you are deciding about a
 * specific field and useless when you are deciding whether to look at all. A reviewer opening a page wants
 * *"three headlines, both CTAs and the hero image — nothing structural"* first, and the field list second.
 *
 * **Derived from the same `BlockDiff[]` the field list renders**, so the summary can never disagree with what
 * is underneath it. A digest computed from its own second pass over the content would eventually say "3
 * headlines" above a list showing four, and the sentence is the part people quote.
 *
 * **Counts what a person counts.** Fields are grouped by their label — "Title" changed in three blocks is
 * *three titles*, not three unrelated edits — because that is how someone describes a page they just reviewed.
 */

export interface ChangeDigest {
  /** One line, ready to print. Empty string when nothing changed — the caller decides how to say "nothing". */
  sentence: string;
  /** Distinct blocks touched, out of how many the page has. */
  blocksChanged: number;
  blocksTotal: number;
  fieldsChanged: number;
  imagesChanged: number;
  /** `[label, count]`, biggest first — the raw material of the sentence, for a UI that wants chips. */
  byLabel: [string, number][];
  /** True when a block's content was emptied. Worth its own flag: deletion reads differently from editing. */
  hasRemovals: boolean;
}

/** Lowercase for prose, but leave an acronym alone — "3 CTAs", not "3 ctas". */
function forProse(label: string): string {
  return /^[A-Z0-9]{2,}$/.test(label) ? label : label.toLowerCase();
}

/**
 * "3 titles", "2 bodies", "1 image".
 *
 * Enough English to be right about the labels that actually occur — Body, Category, Address, Box. The first
 * version just appended an "s" and produced "2 bodys" in the very first sentence it generated, which is the
 * sort of thing that makes a reader discount everything after it.
 */
function plural(count: number, noun: string): string {
  if (count === 1) return `1 ${noun}`;
  // Consonant + y → ies ("body" → "bodies"), but not vowel + y ("day" → "days").
  if (/[^aeiou]y$/i.test(noun)) return `${count} ${noun.slice(0, -1)}ies`;
  // Sibilants take -es ("box" → "boxes", "address" → "addresses").
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${count} ${noun}es`;
  return `${count} ${noun}s`;
}

/** "a, b and c" — the serial comma left out on purpose; this is a sentence, not a list. */
function conjoin(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function changeDigest(diff: BlockDiff[]): ChangeDigest {
  const changes: FieldChange[] = diff.flatMap((b) => b.changes);
  const blocksChanged = diff.filter((b) => b.changes.length > 0).length;

  const counts = new Map<string, number>();
  for (const change of changes) {
    const label = change.label?.trim() || 'field';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  /**
   * Ties break alphabetically rather than by insertion order.
   *
   * Otherwise the same page produces a different sentence depending on the order blocks happen to sit in, and a
   * summary that moves when nothing moved is one people stop trusting.
   */
  const byLabel: [string, number][] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const digest: ChangeDigest = {
    sentence: '',
    blocksChanged,
    blocksTotal: diff.length,
    fieldsChanged: changes.filter((c) => c.kind !== 'image').length,
    imagesChanged: changes.filter((c) => c.kind === 'image').length,
    byLabel,
    // An emptied field: the "to" side is blank where the "from" side was not.
    hasRemovals: changes.some((c) => !String(c.to ?? '').trim() && String(c.from ?? '').trim()),
  };

  if (!changes.length) return digest;

  /**
   * Name the three biggest groups, then say how much is left.
   *
   * Three because a sentence that lists eight things is a list wearing a sentence's clothes — and the tail
   * matters less than knowing there *is* one.
   */
  const NAMED = 3;
  const named = byLabel.slice(0, NAMED).map(([label, n]) => plural(n, forProse(label)));
  const rest = byLabel.slice(NAMED).reduce((n, [, count]) => n + count, 0);
  if (rest) named.push(`${rest} more`);

  const where =
    digest.blocksChanged === digest.blocksTotal && digest.blocksTotal > 1
      ? 'across every block'
      : `across ${plural(digest.blocksChanged, 'block')}`;

  digest.sentence = `${conjoin(named)} changed, ${where}${digest.hasRemovals ? ' — including content removed' : ''}.`;
  return digest;
}
