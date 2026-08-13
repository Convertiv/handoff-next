import { contractSlots, type Slot } from './component-thumbnail';
import { collectEditableText, collectImageSrcs, mergeBlockArgs, type PatternComponentEntry } from './guest-editable';

/**
 * A schematic thumbnail for a **page**, drawn from the blocks it is made of.
 *
 * The library card has always had a picture slot and patterns have always had a `thumbnail` column —
 * nothing on the save path ever wrote one, so every page saved from the playground showed "No preview"
 * on a grey box. That reads as a broken card rather than as an absent screenshot, which is what Brad
 * saw in QA.
 *
 * Same bargain as `componentThumbnailSvg`, and the same reasoning: a **diagram, not a render**. A
 * faithful capture needs a headless browser, and on a serverless deploy that is real cold-start and
 * bundle cost for a 320×180 image. What a card actually has to answer is "which page is this?" — and a
 * hero-then-three-cards-then-CTA silhouette answers it at a glance, while being honest about being an
 * abstraction rather than a screenshot that is subtly out of date.
 *
 * Where the component version draws one block's contract in full, this draws **one band per block**,
 * because a page is recognised by its rhythm: how many sections, which one is the big picture, where
 * the grid of cards sits. Blocks are read with the same `contractSlots` the component version uses, so
 * the two pictures agree about what a block contains.
 *
 * Pure and dependency-light, so the layout is testable without a DOM.
 */

const W = 320;
const H = 180;

const BG = '#f6f6f5';
const INK = '#c9c8c4';
const INK_STRONG = '#a6a5a0';

/** What a block looks like from a distance — the only distinction a band-high drawing can carry. */
type BandKind = 'media' | 'grid' | 'copy' | 'bar';

/**
 * The one shape a block reduces to.
 *
 * Order matters and encodes what dominates a section visually: a repeater is a grid whatever else it
 * holds, an image block reads as media, and everything else is copy. A block with no drawable slots at
 * all — a spacer, a divider, a config-only block — becomes a thin bar rather than disappearing, because
 * the *number* of sections is half of what makes a page recognisable.
 */
function bandKind(slots: Slot[]): BandKind {
  if (!slots.length) return 'bar';
  if (slots.includes('list')) return 'grid';
  if (slots.includes('image')) return 'media';
  return 'copy';
}

/** Relative height of each kind, before they are scaled to fit the frame. */
const WEIGHT: Record<BandKind, number> = { media: 2.2, grid: 1.8, copy: 1.4, bar: 0.5 };

export interface PatternThumbnailOptions {
  width?: number;
  height?: number;
}

/**
 * The slots a block occupies, read from **the content it actually holds**.
 *
 * ⚠️ **This exists to kill an N+1 I introduced.** The first version read each block's *contract*, which meant
 * the thumbnail route fetched every distinct component of every page — one `getComponent` query each. A library
 * grid of 50 cards, six distinct blocks apiece, fired ~450 queries plus 50 session reads against a pool of ten,
 * in parallel, every time the tab opened. That is why the library got slow.
 *
 * The page row already carries everything needed: the same collectors the audits and the manifest use tell us
 * how much copy a block holds and how many images. Zero extra queries — and arguably a truer picture, since it
 * reflects what is filled in rather than what the contract permits.
 */
export function argsSlots(args: unknown): Slot[] {
  const text = collectEditableText(args);
  const images = collectImageSrcs(args);

  const slots: Slot[] = [];
  // A repeater shows up as a numeric segment in a path — `items.0.title`. One `list` stands for the whole row.
  if (text.some((f) => f.path.some((seg) => typeof seg === 'number'))) slots.push('list');
  for (let i = 0; i < images.length && i < 3; i += 1) slots.push('image');

  // The first line of copy reads as the heading; the rest as body. Same convention the contract version uses.
  const copy = text.filter((f) => !f.path.some((seg) => typeof seg === 'number'));
  copy.slice(0, 5).forEach((_, i) => slots.push(i === 0 ? 'heading' : 'text'));

  return slots.slice(0, 8);
}

/**
 * @param blocks One entry per block on the page, each the block's property contract. Pass `null` for a
 *   block whose component could not be resolved — it still draws a band, because a page that has lost a
 *   component should look like a page with a gap in it, not like a shorter page.
 */
export function patternThumbnailSvg(
  blocks: (Record<string, unknown> | null | undefined)[],
  opts: PatternThumbnailOptions = {}
): string {
  // Contracts in, slots out — then the one drawing routine below. `patternThumbnailFromBlocks` enters at the
  // same place having read slots from content instead.
  return drawBands(blocks.map((b) => contractSlots(b ?? {})), opts);
}

/** The drawing, shared by both readings of a page. */
function drawBands(bands: Slot[][], opts: PatternThumbnailOptions = {}): string {
  const blocks = bands;
  const width = opts.width ?? W;
  const height = opts.height ?? H;

  const frame = `<rect width="${width}" height="${height}" fill="${BG}"/>`;

  /**
   * An empty page draws the same dashed placeholder a contract-less component does.
   *
   * Consistency is the point: "nothing to show" should look identical everywhere it happens, so it
   * reads as a state rather than as a different failure each time.
   */
  if (!blocks.length) {
    const pad = 18;
    return svg(
      width,
      height,
      frame +
        `<rect x="${pad}" y="${pad}" width="${width - pad * 2}" height="${height - pad * 2}" rx="6" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="6 5"/>`
    );
  }

  /**
   * Only the first several blocks are drawn.
   *
   * A twenty-block page compressed into 180px is a grey smear that distinguishes nothing — past about
   * six bands every page looks like every other page, which defeats the whole purpose of the picture.
   * The remainder is shown as a fade band, so a long page still reads as *long*.
   */
  const MAX_BANDS = 6;
  const shown = blocks.slice(0, MAX_BANDS);
  const truncated = blocks.length > MAX_BANDS;

  const kinds = shown.map((slots) => bandKind(slots));
  const gap = 5;
  const pad = 10;
  const totalWeight = kinds.reduce((sum, k) => sum + WEIGHT[k], 0) + (truncated ? WEIGHT.bar : 0);
  const available = height - pad * 2 - gap * (kinds.length - (truncated ? 0 : 1));
  const unit = available / totalWeight;

  const shapes: string[] = [frame];
  let y = pad;
  const x = pad;
  const w = width - pad * 2;

  for (const kind of kinds) {
    const h = Math.max(4, unit * WEIGHT[kind]);
    shapes.push(band(kind, x, y, w, h));
    y += h + gap;
  }

  if (truncated) {
    // Half-height and half-opacity: "there is more page below this" without pretending to draw it.
    const h = Math.max(4, unit * WEIGHT.bar);
    shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${INK}" opacity="0.45"/>`);
  }

  return svg(width, height, shapes.join(''));
}

/** One block, drawn as the shape its dominant slot makes. */
function band(kind: BandKind, x: number, y: number, w: number, h: number): string {
  const rect = (rx: number, ry: number, rw: number, rh: number, fill: string, r = 3) =>
    `<rect x="${round(rx)}" y="${round(ry)}" width="${round(Math.max(2, rw))}" height="${round(Math.max(2, rh))}" rx="${r}" fill="${fill}"/>`;

  if (kind === 'bar') return rect(x, y, w, h, INK);

  if (kind === 'media') {
    // A filled panel with the picture mark on it — the same mark the component thumbnail uses for its
    // image column, so "there is a photo here" looks the same at both sizes.
    const cx = x + w / 2;
    const cy = y + h / 2;
    const s = Math.min(h / 3, 14);
    return (
      rect(x, y, w, h, INK, 4) +
      `<circle cx="${round(cx - s)}" cy="${round(cy - s * 0.5)}" r="${round(s * 0.45)}" fill="${BG}" opacity="0.75"/>` +
      `<path d="M${round(cx - s * 1.7)} ${round(cy + s)} L${round(cx - s * 0.2)} ${round(cy - s * 0.5)} L${round(cx + s * 1.2)} ${round(cy + s)} Z" fill="${BG}" opacity="0.75"/>`
    );
  }

  if (kind === 'grid') {
    // Three columns under a short heading — the shape of every card row ever built.
    const headH = Math.min(6, h * 0.18);
    const cardsY = y + headH + 4;
    const cardsH = Math.max(4, h - headH - 4);
    const colGap = 6;
    const colW = (w - colGap * 2) / 3;
    let out = rect(x, y, w * 0.34, headH, INK_STRONG, 2);
    for (let i = 0; i < 3; i += 1) out += rect(x + i * (colW + colGap), cardsY, colW, cardsH, INK, 3);
    return out;
  }

  // copy: a heading bar over two shorter lines, centre-left like the section it stands for.
  const headH = Math.min(8, h * 0.32);
  let out = rect(x, y, w * 0.5, headH, INK_STRONG, 2);
  const lineH = Math.min(5, (h - headH) * 0.3);
  const lineGap = 4;
  let ly = y + headH + lineGap;
  for (const frac of [0.8, 0.62]) {
    if (ly + lineH > y + h) break;
    out += rect(x, ly, w * frac, lineH, INK, 2);
    ly += lineH + lineGap;
  }
  return out;
}

const round = (n: number) => Math.round(n * 10) / 10;

const svg = (width: number, height: number, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Page layout preview">${inner}</svg>`;

/**
 * The page's silhouette, from the page's own stored blocks.
 *
 * The entry point the route uses: no component catalog, no per-block query. `patternThumbnailSvg` stays for
 * callers that genuinely hold contracts.
 */
export function patternThumbnailFromBlocks(
  entries: PatternComponentEntry[],
  overrides: unknown[] = [],
  opts: PatternThumbnailOptions = {}
): string {
  return drawBands(
    entries.map((entry, i) => argsSlots(mergeBlockArgs(entry, overrides[i]))),
    opts
  );
}

/** Where a caller should point an `<img src>`. The swap boundary — keep this stable. */
export function patternThumbnailUrl(patternId: string, basePath = ''): string {
  return `${basePath}/api/handoff/patterns/${encodeURIComponent(patternId)}/thumbnail.svg`;
}
