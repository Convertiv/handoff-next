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
 *  - **Preview values are a fallback for SHAPE, not for content.** Templates are seeded from real
 *    previews so the structure is right, but their values are somebody's sample. A field the model
 *    never mentions is reported as `unfilled` so it can be completed, rather than shipping lorem ipsum
 *    and calling the page done.
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

/**
 * A serialized React element, as component previews store slot values.
 *
 * `{ key, type, props, _owner, _store }` — a rendered tree, not authorable content. Treating one as a
 * normal object meant a supplied string found no matching key and was discarded, so the preview's own
 * copy survived: a page shipped with "Use Simple Copy for long-form content…" as its body text.
 */
function isReactElementish(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  return ('props' in v && 'type' in v) || '_owner' in v || '$$typeof' in v;
}

/**
 * Workspace-relative asset paths baked into previews (`../../images/content/card-image-1.webp`).
 *
 * They resolve on a local workspace build and 404 in registry mode, so passing one through produces a
 * broken image that reads as a bug in the page rather than a missing asset.
 */
function isUnusableAssetPath(v: unknown): boolean {
  return typeof v === 'string' && (v.startsWith('../') || v.startsWith('./'));
}

function coerceToShape(template: unknown, value: unknown): unknown {
  // Arrays: the template's first entry is the item shape. The model decides how many items there are —
  // three features or five — so length comes from the value, shape from the template.
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return template;
    const itemShape = template[0];
    return value.map((item) => (itemShape === undefined ? item : coerceToShape(itemShape, item)));
  }

  if (isPlainObject(template)) {
    // A rendered element cannot be merged into. Whatever the model authored replaces it outright.
    if (isReactElementish(template)) return value ?? '';

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
/** Editor types that hold content a person reads. Everything else is configuration. */
const CONTENT_EDITORS = ['text', 'richtext', 'string', 'slot', 'image', 'array'];

export interface MergeResult {
  args: Record<string, unknown>;
  /** Keys the model invented. Reported, never silently dropped. */
  unknownKeys: string[];
  /**
   * Content fields still holding preview sample data because the model never supplied them.
   *
   * This is the difference between "renders" and "is finished". Templates are seeded from real
   * previews so the shapes are right, but the *values* are somebody's sample: lorem ipsum in a stats
   * block, three press releases about Q3 results in a card row, a component's own documentation as
   * body copy. Passing those through produced a page that looked complete and was not.
   */
  unfilled: string[];
}

export function mergeBlockValues(
  scaffoldArgs: Record<string, unknown>,
  values: Record<string, unknown> | null | undefined,
  fields?: Record<string, unknown> | null
): MergeResult {
  const args: Record<string, unknown> = { ...scaffoldArgs };
  const unknownKeys: string[] = [];
  const supplied = new Set(Object.keys(values ?? {}));

  for (const [key, value] of Object.entries(values ?? {})) {
    if (!(key in scaffoldArgs)) {
      unknownKeys.push(key);
      continue;
    }
    args[key] = coerceToShape(scaffoldArgs[key], value);
  }

  const unfilled: string[] = [];
  for (const [key, meta] of Object.entries(fields ?? {})) {
    if (supplied.has(key)) continue;
    const info = isPlainObject(meta) ? meta : {};
    const editor = typeof info.editorType === 'string' ? info.editorType : '';
    // `fromBase` means the value came from a real preview — i.e. it is somebody's sample content, not
    // a neutral default. A placeholder from the scaffold is equally unfinished.
    if (!CONTENT_EDITORS.includes(editor)) continue;
    unfilled.push(key);

    // Clear an unusable asset path outright. A broken image is worse than an absent one: it reads as
    // a bug in the page rather than a gap we can still fill.
    const current = args[key];
    if (isPlainObject(current) && isUnusableAssetPath(current.src)) {
      args[key] = { ...current, src: '' };
    } else if (isUnusableAssetPath(current)) {
      args[key] = '';
    }
  }

  return { args, unknownKeys, unfilled };
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
