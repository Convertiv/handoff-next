import 'server-only';

import { getDataProvider } from '@/lib/data';
import { editorOf, placeholderValue, shapeNote } from '@/lib/mcp/scaffold-helpers';

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

  const args: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {};
  for (const [k, m] of Object.entries(props)) {
    const hasBase = k in baseValues;
    args[k] = hasBase ? baseValues[k] : placeholderValue(m);
    fields[k] = {
      editorType: editorOf(m),
      shape: shapeNote(m),
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
