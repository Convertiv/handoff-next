import type { AssetRequirement, ComponentSpec } from '../server/design-spec-types';

/**
 * Turn a specification's declared imagery into concrete image-generation jobs.
 *
 * This is the step that makes assets **web-ready by construction** rather than recovered from a
 * composite. The old path generated one flat image and then asked a model to re-draw sub-regions out
 * of it, which cannot produce faithful, correctly-sized output at any budget: everything came back
 * forced to 1024×1024 and repainted rather than extracted.
 *
 * Here each declared asset becomes its own generation at its own aspect ratio. The resulting images
 * are the real assets — the composite is then assembled *from* them, so the photo in the comp and
 * the photo a developer downloads are the same bytes.
 *
 * Pure and dependency-free so the mapping is unit-testable without touching a model.
 */

/** Sizes the image API accepts. Mirrors `ImageEditSize` without importing server-only code. */
export type PlannedSize = '1024x1024' | '1536x1024' | '1024x1536' | '2048x1152';

export interface AssetJob {
  slot: string;
  kind: AssetRequirement['kind'];
  size: PlannedSize;
  /** Content-only prompt: no layout, no UI chrome, no text. */
  prompt: string;
  /** Filename used when the asset is attached to the composite generation. */
  filename: string;
  /** Label shown to the composite generation so it places rather than redraws. */
  attachmentLabel: string;
  /** Carried through for provenance and for validating what came back. */
  requirement: AssetRequirement;
}

/**
 * Aspect → the nearest size the API actually offers.
 *
 * `2048x1152` is the only true 16:9 option and is also the largest, so wide heroes get it. There is
 * no 3:2 size, so landscape maps to 1536×1024 (3:2 exactly) — which is why 3:2 and 16:9 differ here
 * rather than collapsing together.
 */
export function sizeForAspect(aspect: AssetRequirement['aspect'], minWidth: number): PlannedSize {
  switch (aspect) {
    case '16:9':
      return '2048x1152';
    case '3:2':
      // 1536 is the widest 3:2 available; anything needing more falls back to the 16:9 canvas since
      // over-delivering pixels is recoverable by cropping, under-delivering is not.
      return minWidth > 1536 ? '2048x1152' : '1536x1024';
    case '2:3':
      return '1024x1536';
    case '1:1':
    default:
      return '1024x1024';
  }
}

/**
 * Content-only prompt for a single asset.
 *
 * The hard constraints exist because an image model asked for "a hero photo" will happily return a
 * *mockup of a hero section* — text, buttons and layout included — which is useless as an asset.
 * Everything structural must be excluded explicitly.
 */
export function buildAssetPrompt(req: AssetRequirement, opts: { palette?: string[]; styleNote?: string } = {}): string {
  // The palette is guidance, not instruction to paint with: a photograph forced to literal hex values
  // looks tinted and fake. Naming the colours the design system actually uses is enough to keep the
  // imagery in the same family as the component it will sit inside — which is the whole reason an
  // asset generated in isolation can still look like it belongs.
  const palette = (opts.palette ?? []).filter(Boolean).slice(0, 6);

  const lines = [
    req.kind === 'photo'
      ? `A single photograph: ${req.subject}`
      : `A single illustration: ${req.subject}`,
    '',
    'Requirements:',
    `- Fill the entire frame at ${req.aspect}. No borders, letterboxing, or padding.`,
    req.focalPoint ? `- Place the main subject ${req.focalPoint}, leaving the rest usable as quiet background.` : '',
    palette.length
      ? `- Colour direction: sit naturally alongside ${palette.join(', ')}. Let these inform the ambient palette — do not paint literal swatches or tint the whole image.`
      : '',
    opts.styleNote?.trim() ? `- ${opts.styleNote.trim()}` : '',
    '- NO text, letters, numbers, words, watermarks, logos or captions anywhere in the image.',
    '- NO user-interface elements: no buttons, cards, forms, panels, browser chrome, or device frames.',
    '- NO collage, grid, split-screen, or multiple panels — one continuous image.',
    req.kind === 'photo'
      ? '- Photographic and natural. Real lighting, believable depth of field, no illustration or 3D-render look.'
      : '- Consistent illustration style throughout, flat or lightly shaded, no photographic elements.',
  ].filter(Boolean);
  return lines.join('\n');
}

/** Extension implied by the requirement's preferred format, defaulting to png for transparency safety. */
function extensionFor(req: AssetRequirement): string {
  const first = (req.formats ?? [])[0]?.toLowerCase();
  if (first === 'jpeg' || first === 'jpg') return 'jpg';
  if (first === 'webp') return 'webp';
  return 'png';
}

/** Slug safe for a filename and for matching an attachment label back to its slot. */
function slugify(slot: string): string {
  return slot.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'asset';
}

/**
 * Plan every asset generation a spec calls for.
 *
 * Returns [] when the spec declares no imagery — a component with no photographs needs no asset
 * generation, and that is the common case for atoms and forms.
 */
export function planAssetsFromSpec(
  spec: ComponentSpec,
  opts: { max?: number; palette?: string[]; styleNote?: string } = {}
): AssetJob[] {
  const max = opts.max ?? 4;
  const reqs = (spec.assetRequirements ?? []).filter((r) => r && r.slot && r.subject);
  const seen = new Set<string>();
  const jobs: AssetJob[] = [];

  for (const req of reqs) {
    const slug = slugify(req.slot);
    if (seen.has(slug)) continue;
    seen.add(slug);

    const filename = `${slug}.${extensionFor(req)}`;
    jobs.push({
      slot: req.slot,
      kind: req.kind ?? 'photo',
      size: sizeForAspect(req.aspect ?? '3:2', req.minWidth ?? 0),
      prompt: buildAssetPrompt(req, { palette: opts.palette, styleNote: opts.styleNote }),
      filename,
      // Tells the composite generation to PLACE this image rather than reinterpret it — the whole
      // point is that the comp and the downloadable asset are the same bytes.
      attachmentLabel:
        `${filename}: the final ${req.kind ?? 'photo'} for the "${req.slot}" slot. ` +
        `Place it as-is in that position, cropping only if the layout demands it. Do NOT redraw, ` +
        `restyle, or replace its content.`,
      requirement: req,
    });

    if (jobs.length >= max) break;
  }

  return jobs;
}
