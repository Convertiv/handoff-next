/**
 * Summarise what is on the playground canvas, for the chat's follow-up context.
 *
 * Its own module because `playground-chat.ts` is `server-only` and cannot be imported by the test
 * runner — the same reason `pattern-merge.ts` and `url-safety.ts` were split out. Separation rather
 * than weakening the marker.
 */

/**
 * One line per block on the canvas: what it is, and the first bit of copy in it.
 *
 * A summary rather than the blocks themselves. Full args would be re-sent on every round of the loop —
 * in an agentic conversation the transcript is replayed each time, so a fat context line is paid for
 * repeatedly, not once. Component id plus the leading text is enough for "make the hero shorter" or
 * "drop the pricing section" to resolve to the right block.
 */
export function summarizeComposition(blocks: { componentId: string; args?: Record<string, unknown> }[]): string {
  if (!blocks.length) return '';
  const firstText = (args: Record<string, unknown> | undefined): string => {
    for (const v of Object.values(args ?? {})) {
      if (typeof v === 'string' && v.trim()) {
        // Args carry richtext, so strip tags before quoting them back.
        const text = v.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text) return text.slice(0, 70);
      }
    }
    return '';
  };
  return blocks
    .map((b, i) => {
      const text = firstText(b.args);
      return `${i + 1}. ${b.componentId}${text ? ` — "${text}"` : ''}`;
    })
    .join('\n');
}
