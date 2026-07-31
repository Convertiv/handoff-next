/**
 * Replace one image src with another, wherever it sits in a block's args.
 *
 * A generated image arrives a minute or two after the page does, and the placeholder it replaces could
 * be anywhere: a top-level `src`, an `image: { src }`, or the third item of a `cards` array. Walking
 * the whole structure is simpler and more reliable than tracking a path from the point the placeholder
 * was written — the user may have edited, reordered or deleted blocks in between.
 *
 * Matching by **value** rather than by position is what makes it safe against that editing. If the
 * placeholder is gone, nothing matches and nothing changes.
 */

/** How many blocks changed, and the new args. `changed: false` means the placeholder was not found. */
export interface SwapResult<T> {
  value: T;
  changed: boolean;
}

/**
 * Deep, immutable replace of every occurrence of `fromSrc` with `toSrc`.
 *
 * Returns the original object identity when nothing matched, so a caller can skip a re-render — and so
 * a swap that finds nothing is distinguishable from one that did no work.
 */
export function swapImageSrc<T>(value: T, fromSrc: string, toSrc: string): SwapResult<T> {
  if (!fromSrc || fromSrc === toSrc) return { value, changed: false };
  let changed = false;

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      if (node === fromSrc) {
        changed = true;
        return toSrc;
      }
      return node;
    }
    if (Array.isArray(node)) {
      const next = node.map(walk);
      return next.some((v, i) => v !== node[i]) ? next : node;
    }
    if (node && typeof node === 'object') {
      // React elements are stored in preview values as plain objects with a `props` tree. They are
      // walked like anything else — the src inside one is as real as any other — but the object
      // identity is preserved when nothing under it changed, so untouched trees are not rebuilt.
      const entries = Object.entries(node as Record<string, unknown>);
      const next: Record<string, unknown> = {};
      let dirty = false;
      for (const [k, v] of entries) {
        const w = walk(v);
        next[k] = w;
        if (w !== v) dirty = true;
      }
      return dirty ? next : node;
    }
    return node;
  };

  const out = walk(value) as T;
  return { value: out, changed };
}

/**
 * Does this structure still contain the placeholder?
 *
 * The pre-swap check: the user may have deleted the block, replaced its image by hand, or removed the
 * whole page while generation was running. Swapping into a block that no longer expects it is the same
 * class of mistake the edit operations' `expect` check prevents, so it gets the same treatment.
 */
export function containsImageSrc(value: unknown, src: string): boolean {
  if (!src) return false;
  if (typeof value === 'string') return value === src;
  if (Array.isArray(value)) return value.some((v) => containsImageSrc(v, src));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((v) => containsImageSrc(v, src));
  }
  return false;
}

/** A generated image that has finished, and the placeholder it is meant to replace. */
export interface ResolvedImage {
  placeholderSrc: string;
  url: string;
}

/**
 * Fold every finished image into a block list, reporting which ones found a home.
 *
 * Exists because generation and applying are independent: an image can finish before the user has
 * clicked Apply, in which case its placeholder is not on the canvas yet and a swap at that moment
 * finds nothing. Discarding the image there was wrong — it had been generated and paid for, and the
 * slot was about to exist. Instead the apply itself carries the finished images in, so the order the
 * two happen in stops mattering.
 *
 * One write rather than a swap-after-apply: reading canvas state straight after an async apply races
 * the state update, and a second write would clobber whatever else the first one settled.
 */
export function applyResolvedImages<T extends { args: Record<string, unknown> }>(
  blocks: T[],
  resolved: ResolvedImage[]
): { blocks: T[]; applied: string[] } {
  if (!resolved.length) return { blocks, applied: [] };

  const applied: string[] = [];
  let next = blocks;

  for (const image of resolved) {
    let hit = false;
    const swapped = next.map((b) => {
      const { value, changed } = swapImageSrc(b.args, image.placeholderSrc, image.url);
      if (!changed) return b;
      hit = true;
      return { ...b, args: value };
    });
    if (hit) {
      applied.push(image.placeholderSrc);
      next = swapped;
    }
  }

  return { blocks: next, applied };
}
