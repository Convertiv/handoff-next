import 'server-only';

import { getDataProvider } from '@/lib/data';
import { editorOf, placeholderValue, shapeNote } from '@/lib/mcp/scaffold-helpers';
import { describeJsonShape } from '@/lib/json-shape';
import {
  describeEncoding,
  encodingForSlot,
  placeholderForEncoding,
  readCapabilities,
  widgetForEncoding,
} from '@/lib/slot-capabilities';

/**
 * A ready-to-fill `args` template for a component, annotated with each field's editor type and shape.
 *
 * The single biggest quality lever when a model authors a block. Without it the model guesses prop
 * shapes — a richtext field gets a bare string, an image field gets a URL instead of `{ src, alt }` —
 * and the block renders empty or broken while the conversation reads as if it worked.
 *
 * Seeded from a real preview wherever one exists, so the values are shapes that are known to render
 * rather than invented ones. Extracted from the MCP tool of the same name so the playground chat and
 * MCP share one implementation: two callers guessing prop shapes differently is exactly how they drift.
 */

export interface ScaffoldedArgs {
  componentId: string;
  /** Preview the values were seeded from, or null when the component has none. */
  basePreview: string | null;
  note: string;
  args: Record<string, unknown>;
  /** Per-field metadata: editorType, expected shape, whether it came from a real preview. */
  fields: Record<string, unknown>;
}

/** "desktopImageSlot" -> "Desktop image", for a placeholder caption. */
function humanLabel(name: string): string {
  return name
    .replace(/Slots?$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * Dimension rules a registry attached to the property, used to size an image placeholder.
 *
 * Read defensively because this is *intent*, authored per registry — 8x8 mines it out of the prose
 * description with a regex. Useful, and correctly kept out of the shape question.
 */
function dimensionsFor(meta: unknown): { width: number; height: number } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules = (meta as any)?.rules?.dimensions;
  const dims = rules?.recommended ?? rules?.max ?? rules?.min;
  const width = Number(dims?.width);
  const height = Number(dims?.height);
  return width > 0 && height > 0 ? { width, height } : null;
}

export async function scaffoldArgsForComponent(
  componentId: string,
  fromPreview?: string
): Promise<ScaffoldedArgs | { error: string }> {
  const id = componentId.trim();
  const comp = await getDataProvider().getComponent(id);
  if (!comp) return { error: `No component "${id}".` };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props = ((comp as any)?.properties ?? {}) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const previews = ((comp as any)?.previews ?? {}) as Record<string, any>;
  const keys = Object.keys(previews);
  const baseKey =
    fromPreview && keys.includes(fromPreview) ? fromPreview : keys.includes('generic') ? 'generic' : (keys[0] ?? null);

  // A preview entry is `{ values, … }`; tolerate a bare values object too.
  const baseValues: Record<string, unknown> = baseKey ? (previews[baseKey]?.values ?? previews[baseKey] ?? {}) : {};

  // What the build-time probe measured each ReactNode slot to accept. Null when the component predates
  // probing — in which case everything below falls through to the old declared-shape path unchanged, so
  // this is a no-op until a workspace rebuilds and pushes.
  const caps = readCapabilities(comp);

  const args: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {};
  for (const [k, m] of Object.entries(props)) {
    const hasBase = k in baseValues;
    const encoding = encodingForSlot(caps, k);

    if (encoding) {
      // **Measured beats seeded.** A preview value is not an input contract — across 8x8's catalog the
      // previews hold serialized React elements and *no slot accepts one*, so seeding from them handed
      // the model a shape the component discards. The probe says what actually renders.
      const dims = dimensionsFor(m);
      const placeholder = placeholderForEncoding(encoding, {
        label: humanLabel(k),
        ...(dims ?? {}),
      });
      args[k] = placeholder === undefined ? (hasBase ? baseValues[k] : placeholderValue(m)) : placeholder;
      fields[k] = {
        editorType: widgetForEncoding(encoding) ?? editorOf(m),
        shape: describeEncoding(encoding) ?? shapeNote(m),
        encoding,
        measured: true,
        fromBase: false,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...((m as any)?.options ? { options: (m as any).options } : {}),
      };
      continue;
    }

    // A slot the probe reached and found nothing for is not editable, and saying so is the point — a
    // form that reports success and changes nothing is the failure this replaces.
    if (caps && caps.slots[k] && caps.slots[k]!.unresolved) {
      args[k] = hasBase ? baseValues[k] : placeholderValue(m);
      fields[k] = {
        editorType: editorOf(m),
        shape: shapeNote(m),
        measured: true,
        editable: false,
        note: 'No encoding this component accepts was found for this slot — leave it alone.',
        fromBase: hasBase,
      };
      continue;
    }

    args[k] = hasBase ? baseValues[k] : placeholderValue(m);
    // A JSON-native array or object: describe it from the value a real preview holds, with examples.
    // `shapeNote` says "array of object", which names no keys — the model wrote gallery images into an
    // unreadable shape and inverted `stat`/`sub` on the stats block for exactly that reason. Only
    // applied where a preview value exists, and only where it teaches something.
    const jsonShape = hasBase ? describeJsonShape(baseValues[k]) : null;
    fields[k] = {
      editorType: editorOf(m),
      shape: jsonShape ?? shapeNote(m),
      ...(jsonShape ? { fromValue: true } : {}),
      fromBase: hasBase,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...((m as any)?.options ? { options: (m as any).options } : {}),
    };
  }

  return {
    componentId: id,
    basePreview: baseKey,
    note: baseKey
      ? `args seeded from preview "${baseKey}" (real values) — tweak and dispatch.`
      : 'no base preview available — args are typed placeholders; fill them in.',
    args,
    fields,
  };
}
