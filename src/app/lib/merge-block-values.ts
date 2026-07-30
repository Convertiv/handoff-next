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

/** Editor types that hold content a person reads. Everything else is configuration. */
const CONTENT_EDITORS = ['text', 'richtext', 'string', 'slot', 'image', 'array'];

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

/**
 * Dimensions for a placeholder, read from whatever the template happens to carry.
 *
 * Previews express size inconsistently — explicit `width`/`height`, or baked into an existing
 * placehold.co URL, or not at all. Getting the aspect ratio right matters more than the exact numbers:
 * a placeholder at the slot's real proportions shows the page's rhythm, and a square one in a wide
 * slot makes a good layout look broken.
 */
function placeholderDimensions(template: Record<string, unknown>): { w: number; h: number } {
  const w = Number(template.width);
  const h = Number(template.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };

  const src = typeof template.src === 'string' ? template.src : '';
  const fromUrl = /(\d{2,5})x(\d{2,5})/.exec(src);
  if (fromUrl) return { w: Number(fromUrl[1]), h: Number(fromUrl[2]) };

  return { w: 1200, h: 800 };
}

/**
 * A visible, honest stand-in for an image we cannot supply yet.
 *
 * Better than an empty slot, which collapses the layout, and far better than a workspace path that
 * 404s. It renders as a grey box labelled with its size, so the page reads as "image goes here at this
 * ratio" rather than "something is broken" — and it is the natural socket for a generated asset later.
 */
export function placeholderImageUrl(w: number, h: number): string {
  return `https://placehold.co/${w}x${h}`;
}

function coerceToShape(template: unknown, value: unknown): unknown {
  // Arrays: the template's first entry is the item shape. The model decides how many items there are —
  // three features or five — so length comes from the value, shape from the template.
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return template;
    const itemShape = template[0];
    return value.map((item, i) => {
      const merged = itemShape === undefined ? item : coerceToShape(itemShape, item);
      // Item shapes carry the template item's `_key`, so N generated items would all inherit the same
      // one — duplicate React keys, and the list misbehaves on reorder. Only synthesised when the
      // template uses keys and the model didn't supply one.
      if (isPlainObject(merged) && '_key' in merged) {
        const supplied = isPlainObject(item) ? item._key : undefined;
        return { ...merged, _key: supplied ?? `item-${i + 1}` };
      }
      return merged;
    });
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
/**
 * Strip a scaffolded template down to shape, keeping configuration.
 *
 * The single biggest quality lever found so far. Templates are seeded from real previews so the shapes
 * are right, but the *values* are somebody's sample. Leaving them in place meant a field the model
 * skipped still rendered — lorem ipsum in a stats block, press releases about Q3 results in a card
 * row — so incompleteness was invisible and cheap, and the model took the discount. A page built by
 * the older system, which had no such fallback, authored every array in full.
 *
 * So content comes through empty and the model must write it. Configuration keeps its preview value,
 * because a default theme or alignment genuinely is a default. Images get a dimensioned placeholder
 * rather than nothing, so an unfilled slot still shows the page's proportions.
 */
export function blankContentValues(
  args: Record<string, unknown>,
  fields: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args };

  for (const [key, meta] of Object.entries(fields ?? {})) {
    const info = isPlainObject(meta) ? meta : {};
    const editor = typeof info.editorType === 'string' ? info.editorType : '';
    if (!CONTENT_EDITORS.includes(editor)) continue;
    out[key] = blankValue(args[key], editor);
  }

  return out;
}

function blankValue(value: unknown, editor: string): unknown {
  if (editor === 'image' || (isPlainObject(value) && 'src' in value)) {
    const template = isPlainObject(value) ? value : {};
    const { w, h } = placeholderDimensions(template);
    // Keep the template's other keys (srcset, className) so the shape still matches the component.
    return { ...template, src: placeholderImageUrl(w, h), alt: '' };
  }

  if (Array.isArray(value)) {
    // One item, blanked, as the shape to author against. Keeping all of them would hand back somebody
    // else's three press releases as a starting point.
    return value.length ? [blankValue(value[0], '')] : [];
  }

  if (isReactElementish(value)) return '';

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = blankValue(v, '');
    return out;
  }

  if (typeof value === 'string') return '';
  // Numbers and booleans inside a content structure are usually structural (width, isOpenByDefault).
  return value;
}

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
const EDITOR_HINT: Record<string, string> = {
  slot: 'HTML string',
  richtext: 'HTML string',
  text: 'plain string',
  string: 'plain string',
  image: '{ src, alt }',
  button: '{ label, url }',
  link: '{ label, url }',
  array: 'array — write every item',
};

export function summarizeFields(fields: Record<string, unknown> | null | undefined, max = 10): string {
  const entries = Object.entries(fields ?? {});
  if (!entries.length) return '';
  const parts = entries.slice(0, max).map(([name, meta]) => {
    const editor = isPlainObject(meta) && typeof meta.editorType === 'string' ? meta.editorType : 'any';
    // Naming the JS shape, not just the editor type. "slot" told the model nothing, so it guessed:
    // a plain string sometimes, nothing at all other times.
    return `${name} (${EDITOR_HINT[editor] ?? editor})`;
  });
  if (entries.length > max) parts.push(`+${entries.length - max} more`);
  return parts.join(', ');
}
