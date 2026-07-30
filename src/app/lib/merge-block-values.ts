/**
 * Merge authored content onto a component's scaffolded argument template.
 *
 * This is what lets the model stop transcribing shapes. Previously it had to call `scaffold_args` per
 * block, receive the whole template, and echo it back into the proposal with copy substituted in — a
 * round-trip and a large output payload per block, spent restating structure it had just been handed.
 * A live run burned 17 tool calls that way and never proposed anything.
 *
 * Now the model supplies **content only** — `{ headline: "…", cta: { label, href } }` — and the server
 * merges it onto the template it scaffolds itself. Two consequences worth stating:
 *
 *  - **Shape correctness is structural.** The template owns the shape, so a richtext field cannot
 *    receive a bare string and an image field cannot receive a URL. The scaffolding enforcement existed
 *    only because the model might skip a step it no longer takes.
 *  - **Preview values are the fallback.** Templates are seeded from real previews, so any field the
 *    model doesn't mention keeps a value that is known to render, rather than an empty slot.
 *
 * Pure, so the merge rules are testable without a model or a database.
 */

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Keys that a bare string means, per shape.
 *
 * The model is told to supply objects, but it will sometimes hand back a plain string for a button or
 * an image. Dropping that would silently lose authored copy; guessing wrong would put a label in a URL.
 * These are the unambiguous cases.
 */
const STRING_TARGET = ['text', 'label', 'title', 'src', 'value'];

function coerceToShape(template: unknown, value: unknown): unknown {
  // Arrays: the template's first entry is the item shape. The model decides how many items there are —
  // three features or five — so length comes from the value, shape from the template.
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return template;
    const itemShape = template[0];
    return value.map((item) => (itemShape === undefined ? item : coerceToShape(itemShape, item)));
  }

  if (isPlainObject(template)) {
    if (isPlainObject(value)) {
      const out: Record<string, unknown> = { ...template };
      for (const [k, v] of Object.entries(value)) {
        // Only keys the template knows about. An invented key would travel into the component's props
        // and be ignored at best, or collide at worst.
        if (k in template) out[k] = coerceToShape(template[k], v);
      }
      return out;
    }
    if (typeof value === 'string') {
      const key = STRING_TARGET.find((k) => k in template);
      return key ? { ...template, [key]: value } : template;
    }
    return template;
  }

  // Scalars: take the authored value. A template scalar is a placeholder, not a constraint.
  return value ?? template;
}

/**
 * Apply authored values to a scaffolded template.
 *
 * Unknown keys are reported rather than dropped silently — a model that consistently invents a field
 * name is a prompt problem, and it is invisible if the merge just discards it.
 */
export function mergeBlockValues(
  scaffoldArgs: Record<string, unknown>,
  values: Record<string, unknown> | null | undefined
): { args: Record<string, unknown>; unknownKeys: string[] } {
  const args: Record<string, unknown> = { ...scaffoldArgs };
  const unknownKeys: string[] = [];

  for (const [key, value] of Object.entries(values ?? {})) {
    if (!(key in scaffoldArgs)) {
      unknownKeys.push(key);
      continue;
    }
    args[key] = coerceToShape(scaffoldArgs[key], value);
  }

  return { args, unknownKeys };
}

/**
 * One-line description of a component's editable fields, for the catalog listing.
 *
 * Compact on purpose: this is returned for every component in the catalog, so it has to be cheap enough
 * that the model can see all of them in a single call and stop searching one section at a time.
 */
export function summarizeFields(fields: Record<string, unknown> | null | undefined, max = 10): string {
  const entries = Object.entries(fields ?? {});
  if (!entries.length) return '';
  const parts = entries.slice(0, max).map(([name, meta]) => {
    const editor = isPlainObject(meta) && typeof meta.editorType === 'string' ? meta.editorType : 'any';
    return `${name} (${editor})`;
  });
  if (entries.length > max) parts.push(`+${entries.length - max} more`);
  return parts.join(', ');
}
