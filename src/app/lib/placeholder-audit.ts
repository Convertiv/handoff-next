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
    'Apply the page and ask me to fill them, or set them yourself in the block editor.'
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

/** Does this block list reference the given src anywhere inside it? */
function referencesSrc(blocks: { args: Record<string, unknown> }[], src: string): boolean {
  const walk = (v: unknown): boolean => {
    if (typeof v === 'string') return v === src;
    if (Array.isArray(v)) return v.some(walk);
    if (isRecord(v)) return Object.values(v).some(walk);
    return false;
  };
  return blocks.some((b) => walk(b.args));
}

/**
 * Images the model asked for and then failed to put anywhere.
 *
 * The existing placement guard only fires when a turn ends *without* calling a placement tool. A turn
 * that calls `propose_page` but leaves the returned srcs out of the blocks slips straight past it — and
 * that is the common shape, not an edge case: three images generated, a page proposed, and the pictures
 * waiting forever for a placeholder that is not on the canvas.
 *
 * Checked against the built blocks rather than against the model's intent, because the intent is what
 * was wrong.
 */
export function findUnplacedImages<T extends { placeholderSrc: string }>(
  blocks: { args: Record<string, unknown> }[],
  queued: T[]
): T[] {
  return queued.filter((q) => q.placeholderSrc && !referencesSrc(blocks, q.placeholderSrc));
}

/** Retry instruction naming the exact srcs, so the model reuses them rather than generating again. */
export function unplacedImageInstruction(unplaced: { title: string; placeholderSrc: string }[]): string {
  const list = unplaced.map((u) => `"${u.title}" → ${u.placeholderSrc}`).join('\n');
  return (
    `You generated ${unplaced.length} image(s) but did not put ${unplaced.length === 1 ? 'it' : 'them'} ` +
    `on the page. Requesting an image does not place it. Call the proposal again with these exact srcs ` +
    `written into the image fields they were meant for:\n${list}\n` +
    'Do NOT request them again — they are already generating and re-requesting wastes the per-turn cap.'
  );
}

/**
 * Tell the *user* an image was replaced, and why.
 *
 * The counterpart to `invalidValues`, which says the same thing to the model and ends with an
 * instruction ("use the exact `src` a search_assets result gave you, verbatim") that means nothing to a
 * person. Two audiences, two phrasings, one underlying fact.
 *
 * This is the fifth rejection today that was recorded and never surfaced. The others were surfaced to
 * the model and not the user, or logged and not returned. The rule this keeps arriving at: **a value
 * that was refused has to be visible to whoever can act on it** — and for an image the model picked
 * badly, that is the person looking at the page, because they can go and choose one.
 */
export function describeReplacedImages(
  replaced: { componentId: string; field: string }[]
): string[] {
  return replaced.map(
    ({ componentId, field }) =>
      `${humanField(field)} on ${componentId} is a placeholder — the image chosen was not in the asset ` +
      `library, so it was not used. Pick one from the library, or ask for it to be generated.`
  );
}

/** `desktopImageSlot` → `Desktop image`. Field names are code; this is read by a person. */
function humanField(field: string): string {
  const words = field
    .replace(/Slots?$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : field;
}

/**
 * Optional fields left blank, as a note for the user.
 *
 * The gap guard used to *retry* on these, which fired on every page ever composed — measured at 2 of 2
 * on every fresh-page eval case. What it asked for was decoration: an intro paragraph on a stats band, a
 * decorative background image, an optional CTA image. Pressing a model to fill those costs a round and
 * produces copy nobody wrote, which is the filler the source-copy framing explicitly forbids.
 *
 * Knowing which fields are blank is still useful — it is the difference between "the page is done" and
 * "the page is done and here is what you might still add". So it is said once, plainly, and nothing is
 * asked of the model.
 */
export function describeOptionalGaps(
  gaps: { componentId: string; fields: string[] }[],
  maxBlocks = 4
): string | null {
  const listed = gaps.filter((g) => g.fields.length);
  if (!listed.length) return null;

  const shown = listed
    .slice(0, maxBlocks)
    .map((g) => `${g.componentId} (${g.fields.join(', ')})`)
    .join('; ');
  const rest = listed.length - Math.min(listed.length, maxBlocks);
  return `Optional fields left empty, if you want them: ${shown}${rest ? `, and ${rest} more block${rest === 1 ? '' : 's'}` : ''}.`;
}
