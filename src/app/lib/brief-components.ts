/**
 * When a content brief names the block it wants, use that block.
 *
 * Monica: "the copy doc suggested Split Content and Handoff provided Simple Copy." That is not a near
 * miss. `content-split` has the word set `{content, split}`; `simple-copy` has `{copy, simple}` — nothing
 * in common. The brief said which component it wanted and nothing was reading it.
 *
 * Her example also explains why naive matching fails: **"Split Content" and "Content Split" are the same
 * words in the opposite order.** A substring or prefix test misses it entirely, which is presumably why
 * the model fell back to guessing from the copy. Comparing *sets* of significant words catches it, and
 * catches "Content Split Section" and "content_split" for free.
 *
 * Resolution happens in code and the resolved ids are handed over, rather than asking the model to do
 * the matching. Everything today that worked took that shape; everything that was left to a prompt
 * instruction was ignored.
 *
 * Pure — the catalog is passed in.
 */

/** A component the workspace actually has. */
export interface CatalogEntry {
  id: string;
  title?: string;
}

/**
 * Words that describe *that* something is a component rather than *which* one.
 *
 * A brief writes "Split Content Block", "hero section", "Stats module". Stripping these lets those match
 * `content-split`, `hero-*` and `stats` instead of failing on a word the catalog never uses.
 */
const NOISE_WORDS = new Set([
  'block',
  'blocks',
  'section',
  'sections',
  'module',
  'modules',
  'component',
  'components',
  'layout',
  'template',
  'variant',
  'version',
  'the',
  'a',
  'an',
]);

/** Sorted significant words — order-insensitive, punctuation-insensitive, casing-insensitive. */
export function signatureOf(name: string): string {
  // Annotated rather than inferred — `match(…) ?? []` can collapse to `never[]` under some tsconfigs and
  // take `.filter`'s parameter with it. See `searchTerms` for the build this broke.
  const words: string[] = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words
    .filter((w) => !NOISE_WORDS.has(w))
    .sort()
    .join(' ');
}

/** Header cells that mean "the value below names a component". */
const COMPONENT_HEADER = /\b(component|block|module|layout|template|pattern)s?\b/i;

/**
 * The component names a brief mentions.
 *
 * Two shapes, because both turn up. A markdown table with a Component column — which is what
 * `docxToSourceCopy` emits from a Word table — and a `Component: Split Content` line, which is how a
 * brief written as prose says the same thing.
 *
 * Deliberately narrow. Scanning all prose for anything resembling a component name would match ordinary
 * words like "cards" and "hero" constantly, and a wrong match is worse than none: it would send the
 * model to a block the brief never asked for while looking authoritative.
 */
export function findNamedComponents(text: string): string[] {
  const found: string[] = [];
  const lines = (text ?? '').split('\n');

  // `Component: Split Content`, one per line.
  for (const line of lines) {
    const labelled = line.match(/^\s*(?:[-*]\s*)?(component|block|module|layout|template|pattern)\s*:\s*(.+)$/i);
    if (labelled) found.push(labelled[2]!.trim());
  }

  // A table column whose header names components.
  let column: number | null = null;
  for (const line of lines) {
    const cells = splitRow(line);
    if (!cells) {
      // A blank line or prose ends the table; the next table gets its own header.
      if (!line.trim()) column = null;
      continue;
    }
    if (isSeparatorRow(cells)) continue;

    if (column === null) {
      const at = cells.findIndex((c) => COMPONENT_HEADER.test(c));
      if (at >= 0) column = at;
      continue;
    }
    const value = cells[column]?.trim();
    if (value) found.push(value);
  }

  // Deduplicated by signature, keeping the first spelling — a brief repeats a component per row.
  const seen = new Set<string>();
  return found.filter((name) => {
    const key = signatureOf(name);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) return null;
  return trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|');
}

const isSeparatorRow = (cells: string[]) => cells.every((c) => /^[\s:-]*$/.test(c) && c.includes('-'));

export interface ResolvedBriefComponents {
  matched: { name: string; id: string; title: string }[];
  /** Names that matched nothing. Reported rather than dropped — see `describeBriefComponents`. */
  unmatched: string[];
}

/**
 * Match brief names against the catalog by word set.
 *
 * Set **equality**, not subset. `{split}` is a subset of `hero-split`, `split-card-carousel` and
 * `content-split`, so subset matching would confidently pick whichever came first — the same
 * plausible-and-wrong answer this whole line of work keeps removing. Equality either matches or does
 * not, and a miss is reported honestly.
 *
 * Both the id and the title are tried, because a brief is written from what a person sees in the picker
 * and the two can differ — `card` is titled "Simple Card".
 */
export function resolveBriefComponents(names: string[], catalog: CatalogEntry[]): ResolvedBriefComponents {
  /**
   * Two tiers, because titles are not unique and ids are.
   *
   * The 8x8 registry has `content-split` and `feature` both titled "Content Split". A single map with
   * first-writer-wins resolved "Split Content" to whichever happened to come first — correctly, as it
   * turned out, and for no better reason than insertion order. That is the confident-wrong answer this
   * codebase keeps removing, just one that got lucky.
   *
   * An id match is stronger evidence than a title match: `content-split`'s id signature *is* "content
   * split" while `feature`'s is "feature", so the tie breaks on a real distinction rather than on order.
   * Within a tier, a genuine clash is reported as ambiguous rather than guessed — see `resolveFieldName`
   * for the same rule applied to fields.
   *
   * (I claimed zero collisions when this was written. That was measured against 70 built files on disk,
   * not the 77 components in the registry. One collision, found by running the deployed MCP tool.)
   */
  const byId = new Map<string, CatalogEntry[]>();
  const byTitle = new Map<string, CatalogEntry[]>();
  for (const entry of catalog ?? []) {
    for (const [candidate, map] of [
      [entry.id, byId],
      [entry.title, byTitle],
    ] as const) {
      const key = candidate ? signatureOf(candidate) : '';
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      const list = map.get(key)!;
      if (!list.some((e) => e.id === entry.id)) list.push(entry);
    }
  }

  const matched: ResolvedBriefComponents['matched'] = [];
  const unmatched: string[] = [];

  for (const name of names) {
    const key = signatureOf(name);
    const candidates = byId.get(key)?.length ? byId.get(key)! : (byTitle.get(key) ?? []);
    // Exactly one, or nothing. Two components with an equal claim to a name is a question, not an answer.
    if (candidates.length === 1) {
      const hit = candidates[0]!;
      matched.push({ name, id: hit.id, title: hit.title || hit.id });
    } else {
      unmatched.push(name);
    }
  }

  return { matched, unmatched };
}

/**
 * What to tell the model about the components the brief asked for.
 *
 * Names the resolved ids, and is explicit about the ones that resolved to nothing — "say which you used
 * instead and why" rather than letting it substitute silently. That silent substitution is the reported
 * bug: a brief asked for Split Content, got Simple Copy, and nothing in the reply mentioned the swap.
 */
export function describeBriefComponents(resolved: ResolvedBriefComponents): string | null {
  if (!resolved.matched.length && !resolved.unmatched.length) return null;

  const lines: string[] = ['', 'The brief names the blocks it wants. Use these:'];
  for (const { name, id, title } of resolved.matched) {
    lines.push(`- "${name}" is the \`${id}\` block (${title}). Use it where the brief asks for it.`);
  }
  if (resolved.unmatched.length) {
    lines.push(
      `- No block in this system matches ${resolved.unmatched.map((n) => `"${n}"`).join(', ')}. ` +
        'Pick the closest one, and say in your reply which you chose and what it replaced — do not ' +
        'substitute silently.'
    );
  }
  return lines.join('\n');
}
