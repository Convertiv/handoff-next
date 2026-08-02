/**
 * Find the image slots in a proposed page that are still holding a placeholder.
 *
 * Two jobs, and the second is the important one.
 *
 * A whole-page build asking for "good images of students" produced no images and no placeholders in the
 * body — and then reported "real student imagery". The model does not reach for `search_assets` or
 * `request_image` while composing ten blocks, and the existing gap retry lumps images in with copy and
 * tells it to "write real values", which is not something you can do for an image.
 *
 * **And it claimed the work anyway.** A model reporting output it did not produce is worse than one
 * leaving a visible gap: the gap is obvious, the claim is not. So this also feeds a factual correction
 * appended to the reply, which is deterministic and does not depend on the model cooperating.
 */

/** Placeholder images are `placehold.co` URLs — see `placeholderImageUrl` in `merge-block-values`. */
const PLACEHOLDER_HOST = 'placehold.co';

export interface PlaceholderImage {
  /** 1-based, matching how blocks are numbered everywhere the user sees them. */
  block: number;
  componentId: string;
  field: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Does this value hold a placeholder image anywhere inside it? */
function holdsPlaceholder(value: unknown): boolean {
  if (typeof value === 'string') return value.includes(PLACEHOLDER_HOST);
  if (Array.isArray(value)) return value.some(holdsPlaceholder);
  if (isRecord(value)) return Object.values(value).some(holdsPlaceholder);
  return false;
}

/**
 * Every top-level field still on a placeholder, across a proposed page.
 *
 * Top-level only: an unfilled image inside the third card of a grid is real but reporting it by path
 * would produce noise a user cannot act on, and the field name is enough to find it.
 */
export function findPlaceholderImages(blocks: { componentId: string; args: Record<string, unknown> }[]): PlaceholderImage[] {
  const out: PlaceholderImage[] = [];
  blocks.forEach((block, i) => {
    for (const [field, value] of Object.entries(block.args ?? {})) {
      if (holdsPlaceholder(value)) out.push({ block: i + 1, componentId: block.componentId, field });
    }
  });
  return out;
}

/**
 * A factual note about imagery that is still missing, or null when there is none.
 *
 * Appended to the assistant's reply rather than replacing it. The model's prose may be accurate, may be
 * vague, or may claim imagery outright — this makes the true state visible regardless, without trying
 * to police the wording.
 */
export function describeMissingImagery(placeholders: PlaceholderImage[]): string | null {
  if (!placeholders.length) return null;
  const fields = placeholders.slice(0, 6).map((p) => `block ${p.block} (${p.componentId})`);
  const more = placeholders.length > fields.length ? ` and ${placeholders.length - fields.length} more` : '';
  return (
    `⚠️ ${placeholders.length} image slot${placeholders.length === 1 ? '' : 's'} still ` +
    `${placeholders.length === 1 ? 'holds a placeholder' : 'hold placeholders'} — ${fields.join(', ')}${more}. ` +
    'Ask me to generate or find images for them, or set them in the block editor.'
  );
}

/** Instruction for the retry, phrased for images specifically. */
export function imageGapInstruction(placeholders: PlaceholderImage[]): string {
  const list = placeholders.map((p) => `block ${p.block} ${p.componentId}.${p.field}`).join(', ');
  return (
    `${placeholders.length} image slot(s) are still placeholders: ${list}. An image is not something you ` +
    'can write — call `search_assets` for each, and `request_image` where the store has nothing suitable. ' +
    'Then call propose_page again with the srcs those tools returned. If you genuinely cannot fill one, ' +
    'leave the placeholder and say so plainly in your reply — do not describe imagery you did not add.'
  );
}
