/**
 * Where an image picker writes its result.
 *
 * One rule, three callers: the field's own remove button, its generate flow, and the media browser's
 * commit in `EditContext`. Each used to spell the paths out inline, and the shape they assumed —
 * `src`/`srcset`/`alt` nested *inside* the bound value — is right for an image-object prop and wrong for
 * an image item's `src`, which the measured `array-of-image-object` encoding defines as a bare URL string.
 * Aiming the object form at `src` wrote `src.src`, so the component received an object and rendered
 * `<img src="[object Object]">`.
 *
 * Extracted because three call sites implementing one convention is how that disagreement happened in the
 * first place, and because a rule in a pure function can be tested while the same rule inlined in a click
 * handler cannot.
 *
 * Pure. Returns the writes to apply in order; callers hand each to `handleInputChange`.
 */

/** A `[path, value]` pair for `handleInputChange`. */
export type FieldWrite = [string[], unknown];

export interface PickedImage {
  src: string;
  srcset?: string;
  /** Omit to leave any existing alt text alone — the generate flow does this. */
  alt?: string;
}

/**
 * @param scalar True when the value at `identifier` *is* the URL, rather than an object holding one.
 */
export function imageFieldWrites(identifier: string[], image: PickedImage, scalar: boolean): FieldWrite[] {
  // The target is the URL itself. Nothing else belongs here: `alt` is the item's own sibling field, and
  // writing one from this control would give an author two inputs pointing at different places.
  if (scalar) return [[identifier, image.src]];

  const writes: FieldWrite[] = [
    [[...identifier, 'src'], image.src],
    [[...identifier, 'srcset'], image.srcset ?? ''],
  ];
  if (image.alt !== undefined) writes.push([[...identifier, 'alt'], image.alt]);
  return writes;
}

/** Clearing the field, which has to match how it was written or it leaves half a value behind. */
export function clearImageFieldWrites(identifier: string[], scalar: boolean): FieldWrite[] {
  if (scalar) return [[identifier, '']];
  return [
    [[...identifier, 'src'], ''],
    [[...identifier, 'srcset'], ''],
  ];
}
