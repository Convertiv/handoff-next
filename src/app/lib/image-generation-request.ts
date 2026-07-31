/**
 * Turning "a nurse using a tablet" into an image-model request.
 *
 * Shared by the two places that ask for one: the chat's `request_image` tool, and the block editor's
 * per-field Generate. Pure so both get the same guards and the same aspect-ratio choice, and so those
 * choices are testable without an API key.
 */

/** Sizes the image API accepts. Mirrors `ImageEditSize` in `server/ai-client`, minus `auto`. */
export type GeneratedImageSize = '1024x1024' | '1536x1024' | '1024x1536' | '2048x1152';

export interface ImageDimensionRules {
  min?: { width: number; height: number };
  max?: { width: number; height: number };
  recommended?: { width: number; height: number };
}

const SIZES: { size: GeneratedImageSize; ratio: number }[] = [
  { size: '1024x1024', ratio: 1 },
  { size: '1536x1024', ratio: 1536 / 1024 },
  { size: '1024x1536', ratio: 1024 / 1536 },
  { size: '2048x1152', ratio: 2048 / 1152 },
];

/**
 * Pick the generated size whose aspect ratio is closest to what the slot wants.
 *
 * Blocks declare their image dimensions in the property contract, so a hero that wants 16:9 should not
 * get a square photo cropped to fit. Only four sizes are available, so this is a nearest match rather
 * than an exact one — but nearest is enough to keep the subject from being cropped out.
 *
 * Compares log-ratios: without it, "twice as wide as wanted" and "half as wide" score differently,
 * and the picker skews landscape.
 */
export function sizeForDimensions(rules?: ImageDimensionRules | null): GeneratedImageSize {
  const dims = rules?.recommended ?? rules?.max ?? rules?.min;
  if (!dims?.width || !dims?.height || dims.width <= 0 || dims.height <= 0) return '1536x1024';

  const target = Math.log(dims.width / dims.height);
  let best = SIZES[0]!;
  for (const candidate of SIZES) {
    if (Math.abs(Math.log(candidate.ratio) - target) < Math.abs(Math.log(best.ratio) - target)) {
      best = candidate;
    }
  }
  return best.size;
}

/** `'1536x1024'` -> `[1536, 1024]`, for sizing the placeholder to match. */
export function parseSize(size: GeneratedImageSize): [number, number] {
  const [w, h] = size.split('x').map(Number);
  return [w!, h!];
}

/** Longest a caller-supplied brief may be. Well past any real one; a guard, not a limit to design to. */
export const MAX_IMAGE_PROMPT_CHARS = 1000;

/**
 * Compose the brief actually sent to the image model.
 *
 * Two things get added to whatever the user or the model wrote:
 *
 * **A no-text rule.** Generated lettering renders as convincing gibberish, and a marketing page is
 * exactly the context where a viewer reads it as a real word. This is the single highest-value line in
 * the prompt.
 *
 * **The workspace's design guidance**, clipped. The whole premise here is composing from an existing
 * system; a photo that ignores the house style is the same failure as copy that ignores the brand
 * voice. Clipped hard because it is paid for on every generation and the top of Design.MD is where the
 * visual direction lives.
 */
export function buildImagePrompt(brief: string, styleGuidance?: string | null): string {
  const clean = brief.trim().slice(0, MAX_IMAGE_PROMPT_CHARS);
  const style = (styleGuidance ?? '').trim().slice(0, 600);
  return [
    clean,
    style ? `\nHouse style to match:\n${style}` : '',
    '\nNo text, letterforms, words, numbers or logos anywhere in the image — generated lettering ' +
      'renders as gibberish. Photographic realism unless the brief says otherwise. No watermarks, ' +
      'no borders, no collage.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Rejects an unusable brief up front rather than paying for a generation that cannot succeed. */
export function validateImageBrief(brief: unknown): { ok: true; brief: string } | { ok: false; error: string } {
  if (typeof brief !== 'string' || !brief.trim()) {
    return { ok: false, error: 'Describe the image you want.' };
  }
  const trimmed = brief.trim();
  // Long enough to be a subject rather than a stray keystroke. "dog" is a legitimate brief; "d" is not.
  if (trimmed.length < 3) return { ok: false, error: 'That is too short to generate from.' };
  return { ok: true, brief: trimmed.slice(0, MAX_IMAGE_PROMPT_CHARS) };
}
