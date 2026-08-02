/**
 * Summarise what is on the playground canvas, for the chat's follow-up context.
 *
 * Its own module because `playground-chat.ts` is `server-only` and cannot be imported by the test
 * runner — the same reason `pattern-merge.ts` and `url-safety.ts` were split out. Separation rather
 * than weakening the marker.
 */

export interface CanvasBlock {
  componentId: string;
  args: Record<string, unknown>;
}

/**
 * Read the canvas out of a request body.
 *
 * Lives here, beside the summariser it feeds, because the route had this field in the client payload
 * and nowhere in its parsing for a full release — the body type was `{ messages, attachedAssetIds }`,
 * so nothing failed to compile and the chat simply could not see the page it was editing. A named,
 * tested function is harder to forget than a property.
 *
 * Validating rather than casting: this is browser input that goes straight into a system prompt.
 */
export function parseCanvasBlocks(raw: unknown): CanvasBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((b) => {
    if (!b || typeof b !== 'object') return [];
    const { componentId, args } = b as { componentId?: unknown; args?: unknown };
    if (typeof componentId !== 'string' || !componentId) return [];
    const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
    return [{ componentId, args: safeArgs }];
  });
}

/**
 * One line per block on the canvas: what it is, and the first bit of copy in it.
 *
 * A summary rather than the blocks themselves. Full args would be re-sent on every round of the loop —
 * in an agentic conversation the transcript is replayed each time, so a fat context line is paid for
 * repeatedly, not once. Component id plus the leading text is enough for "make the hero shorter" or
 * "drop the pricing section" to resolve to the right block.
 */
export function summarizeComposition(
  blocks: { componentId: string; args?: Record<string, unknown>; imageFields?: string[] }[]
): string {
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
      // The image fields, named. Without them the model knew a block could hold a picture but not what
      // to call the slot, so it wrote `src` — which the component does not have — and the generated
      // image reached nothing. Measured 4 of 4 before this line existed.
      const slots = b.imageFields?.length ? `  [image fields: ${b.imageFields.join(', ')}]` : '';
      return `${i + 1}. ${b.componentId}${text ? ` — "${text}"` : ''}${slots}`;
    })
    .join('\n');
}
