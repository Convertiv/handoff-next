/**
 * Where a generated image is going, decided before it is generated.
 *
 * `request_image` used to return a bare `{ src, alt }` and a note saying "write it into the block". The
 * model then guessed the field — `src` on a `hero-background`, or `image` — the edit was rejected for
 * naming no field the component has, and the image it had already paid for reached nothing. Measured at
 * 4 of 4 runs across two eval cases; previously visible only as "the images land in the library but not
 * on the page".
 *
 * The fix is not a better note. It is making the target an **argument**, so a wrong one is caught by
 * code instead of hoped away: name the block and the field, get told the real field names if it is
 * wrong, and get back a value already shaped by what that slot was measured to accept.
 *
 * Pure — the field metadata is passed in. `playground-chat.ts` is `server-only` and cannot be imported
 * by the test runner, and the interesting part is the resolution, not the lookup.
 */

/** The scaffold's per-field metadata, narrowed to what target resolution needs. */
export interface FieldMeta {
  editorType?: string;
  /** Measured encoding, where the component was probed. See `slot-capabilities.ts`. */
  encoding?: string;
  editable?: boolean;
}

/** Encodings a picture can actually be written into. */
const IMAGE_ENCODINGS = new Set(['image-object', 'array-of-image-object']);

/**
 * The fields on a component that can hold an image.
 *
 * Measured encoding first, declared editor type only as a fallback. That order is the whole point of
 * the probe: `shapeNote` asserted `{ src, alt }` for anything whose name matched /image/, which is what
 * made this class of bug possible. A field the probe reached and found nothing for is excluded — it is
 * not editable, and offering it produces an edit that reports success and changes nothing.
 */
export function imageFieldsFor(fields: Record<string, FieldMeta> | undefined): string[] {
  return Object.entries(fields ?? {})
    .filter(([, meta]) => {
      if (meta?.editable === false) return false;
      if (meta?.encoding) return IMAGE_ENCODINGS.has(meta.encoding);
      return meta?.editorType === 'image';
    })
    .map(([name]) => name);
}

export type ImageTarget =
  | { ok: true; componentId: string; index: number; field: string; encoding: string | null }
  | { ok: false; error: string };

/**
 * Resolve "put this in block 2's hero image" to a checked component, index and field.
 *
 * Every failure returns the choices rather than just the complaint. A model told "no such field" and
 * nothing else guesses a second time — that is exactly what the rejected-edits path did before it
 * started listing the real names.
 */
export function resolveImageTarget(input: {
  blocks: { componentId: string }[];
  /** 1-based, matching the numbering the composition summary shows the model. */
  block: unknown;
  field: unknown;
  fields: Record<string, FieldMeta> | undefined;
}): ImageTarget {
  const { blocks } = input;
  if (!blocks.length) return { ok: false, error: 'There are no blocks on the canvas to put an image in.' };

  const index = Number(input.block);
  if (!Number.isInteger(index) || index < 1 || index > blocks.length) {
    return {
      ok: false,
      error:
        `\`block\` must be one of 1–${blocks.length}, numbered as in the composition. ` +
        `Got ${JSON.stringify(input.block)}.`,
    };
  }

  const componentId = blocks[index - 1]!.componentId;
  const candidates = imageFieldsFor(input.fields);
  if (!candidates.length) {
    return { ok: false, error: `Block ${index} (${componentId}) has no image field. Pick a different block.` };
  }

  const field = typeof input.field === 'string' ? input.field.trim() : '';
  if (!field || !candidates.includes(field)) {
    return {
      ok: false,
      error:
        `${componentId} has no image field called ${field ? `\`${field}\`` : '(none given)'}. ` +
        `Its image fields are: ${candidates.join(', ')}.`,
    };
  }

  return { ok: true, componentId, index, field, encoding: input.fields?.[field]?.encoding ?? null };
}

/**
 * The value to write into the target, in the encoding that slot was measured to accept.
 *
 * `array-of-image-object` returns a one-item array rather than a bare object — `image-gallery.images`
 * is exactly this, and writing an object where an array belongs is the same silent no-op in a different
 * costume.
 */
export function valueForImageTarget(encoding: string | null, image: { src: string; alt: string }): unknown {
  if (encoding === 'array-of-image-object') return [{ ...image }];
  return { ...image };
}

/**
 * The instruction handed back with a queued image.
 *
 * Spells out the whole edit — op, index, expect and values — because "use this src" is what the model
 * was given before, and it responded by inventing a field name.
 */
export function describeImagePlacement(target: {
  componentId: string;
  index: number;
  field: string;
  encoding: string | null;
}): string {
  return (
    `Write this into block ${target.index} (${target.componentId}) field \`${target.field}\`, using ` +
    `propose_edits: { op: "update", index: ${target.index}, expect: "${target.componentId}", values: ` +
    `{ "${target.field}": <the value below> } }. Requesting the image does NOT place it.`
  );
}
