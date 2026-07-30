import { editorOf } from './mcp/scaffold-helpers';

/**
 * A schematic thumbnail for a component, derived from its property contract.
 *
 * Not a render — a **diagram**. It shows the block's shape: where the heading sits, how many lines of
 * copy, whether there is an image and which side it is on, how many buttons. That is what someone
 * scanning a picker actually needs, and it is honest about being an abstraction rather than a
 * screenshot that is subtly wrong.
 *
 * Deliberately generated from props rather than captured. Faithful screenshots need a headless browser,
 * which on a serverless deploy means real cold-start and bundle cost. This costs a few hundred bytes of
 * SVG and no dependency at all — `satori`/`resvg` aren't needed because nothing is being rasterized.
 *
 * **The swap boundary is the URL, not this function.** Callers ask
 * `/api/handoff/components/<id>/thumbnail.svg`; replacing this with real captures changes what that
 * route serves and touches no caller.
 *
 * Pure and dependency-light so the layout logic is testable.
 */

export interface ThumbnailOptions {
  width?: number;
  height?: number;
}

const W = 320;
const H = 180;

/** Property kinds that occupy visual space. Everything else is configuration and draws nothing. */
type Slot = 'heading' | 'text' | 'image' | 'button' | 'list';

const TEXTUAL = ['richtext', 'text', 'string', 'slot'];
const HEADING_NAME = /^(title|heading|headline|h1|h2)/;

/**
 * Which visual slot a property occupies.
 *
 * `nameWins` disables the positional fallback. Without it, ordering decided the headline and a
 * `subtitle` declared before `title` was drawn as the heading while `title` was drawn as one too —
 * two headings and no body. Name beats position when a name is explicit; position only decides when
 * nothing is.
 */
function slotFor(key: string, meta: unknown, isFirstText: boolean, nameWins: boolean): Slot | null {
  const editor = editorOf(meta);
  const name = key.toLowerCase();

  if (editor === 'image') return 'image';
  if (editor === 'button' || editor === 'link') return 'button';
  if (editor === 'array') return 'list';
  if (TEXTUAL.includes(editor)) {
    if (HEADING_NAME.test(name)) return 'heading';
    if (/^(eyebrow|kicker|label|badge)/.test(name)) return 'text';
    return !nameWins && isFirstText ? 'heading' : 'text';
  }
  // boolean / number / select / object: configuration, not content.
  return null;
}

export function componentThumbnailSvg(
  properties: Record<string, unknown> | null | undefined,
  opts: ThumbnailOptions = {}
): string {
  const width = opts.width ?? W;
  const height = opts.height ?? H;

  const entries = Object.entries(properties ?? {});
  // Decided up front so ordering cannot override an explicit name anywhere in the pass.
  const nameWins = entries.some(([k, m]) => TEXTUAL.includes(editorOf(m)) && HEADING_NAME.test(k.toLowerCase()));

  const slots: Slot[] = [];
  let seenText = false;
  for (const [key, meta] of entries) {
    const slot = slotFor(key, meta, !seenText, nameWins);
    if (!slot) continue;
    if (slot === 'heading' || slot === 'text') seenText = true;
    slots.push(slot);
    if (slots.length >= 8) break;
  }

  const textSlots = slots.filter((s) => s !== 'image');

  // One image alongside copy is the split-hero shape, and drawing it as such is far more recognisable
  // than a stack. Multiple images, or an image with no copy, read better stacked.
  const imageCount = slots.filter((s) => s === 'image').length;
  const split = imageCount === 1 && textSlots.length >= 2;

  const bg = '#f6f6f5';
  const ink = '#c9c8c4';
  const inkStrong = '#a6a5a0';
  const shapes: string[] = [`<rect width="${width}" height="${height}" fill="${bg}"/>`];

  const pad = 18;
  const colW = split ? (width - pad * 3) / 2 : width - pad * 2;

  let y = pad + 6;
  const bar = (w: number, h: number, fill: string, x = pad, r = 3) =>
    `<rect x="${x}" y="${y}" width="${Math.max(4, w)}" height="${h}" rx="${r}" fill="${fill}"/>`;

  for (const slot of split ? textSlots : slots) {
    if (y > height - pad) break;
    if (slot === 'heading') {
      shapes.push(bar(colW * 0.82, 13, inkStrong));
      y += 18;
      shapes.push(bar(colW * 0.55, 13, inkStrong));
      y += 22;
    } else if (slot === 'text') {
      shapes.push(bar(colW * 0.92, 6, ink));
      y += 10;
      shapes.push(bar(colW * 0.7, 6, ink));
      y += 16;
    } else if (slot === 'button') {
      shapes.push(bar(72, 20, inkStrong, pad, 10));
      y += 28;
    } else if (slot === 'list') {
      for (let i = 0; i < 3; i += 1) {
        shapes.push(bar(colW * 0.28, 26, ink, pad + i * (colW * 0.32), 4));
      }
      y += 34;
    } else if (slot === 'image') {
      const h = Math.min(72, height - y - pad);
      if (h > 16) {
        shapes.push(bar(colW, h, ink, pad, 5));
        y += h + 12;
      }
    }
  }

  if (split) {
    const x = pad * 2 + colW;
    const h = height - pad * 2;
    shapes.push(`<rect x="${x}" y="${pad}" width="${colW}" height="${h}" rx="5" fill="${ink}"/>`);
    // A mark that reads as "picture" without pretending to be one.
    const cx = x + colW / 2;
    const cy = pad + h / 2;
    shapes.push(`<circle cx="${cx - 14}" cy="${cy - 8}" r="7" fill="${bg}" opacity="0.7"/>`);
    shapes.push(`<path d="M${cx - 30} ${cy + 18} L${cx - 6} ${cy - 6} L${cx + 14} ${cy + 18} Z" fill="${bg}" opacity="0.7"/>`);
  }

  // An empty contract would otherwise render a blank rectangle that looks like a loading failure.
  if (shapes.length === 1) {
    shapes.push(
      `<rect x="${pad}" y="${pad}" width="${width - pad * 2}" height="${height - pad * 2}" rx="6" fill="none" stroke="${ink}" stroke-width="2" stroke-dasharray="6 5"/>`
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Block layout preview">${shapes.join('')}</svg>`;
}

/** Where a caller should point an `<img src>`. The swap boundary — keep this stable. */
export function componentThumbnailUrl(componentId: string, basePath = ''): string {
  return `${basePath}/api/handoff/components/${encodeURIComponent(componentId)}/thumbnail.svg`;
}
