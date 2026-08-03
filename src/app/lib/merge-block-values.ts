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

import { describeJsonShape } from './json-shape';
import { nestedEncodingLookup, type ComponentCapabilities } from './slot-capabilities';

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
 * Pull the URL out of an `src` the model wrapped in markup.
 *
 * The failure this exists for was misread for a week as the model *inventing* image URLs. It was not.
 * It searched the library, found the right asset, and then wrote the whole tag into the src:
 *
 *     src: "<img src=\"/api/handoff/assets/img_aeb067be0406/raw\" alt=\"Students on campus\" />"
 *
 * Understandable — most slots on these components take an HTML string, and this one takes `{ src, alt }`.
 * The object shape was right and the asset was real; only the packaging was wrong. Rejecting that
 * throws away a correct answer to punish formatting, and the page ships entirely on placeholders while
 * the reply says every field is authored. Measured 0 of 4.
 *
 * Extraction is **not** a relaxation of the guard: whatever comes out is checked against the same
 * allowlist as a bare string, so a tag pointing somewhere we cannot serve is still replaced.
 */
export function extractImageSrc(src: string): string {
  const trimmed = src.trim();
  if (!trimmed.startsWith('<') && !trimmed.startsWith('![')) return trimmed;

  const tag = trimmed.match(/<img\b[^>]*?\ssrc\s*=\s*("([^"]*)"|'([^']*)')/i);
  if (tag) return (tag[2] ?? tag[3] ?? '').trim();

  // `![alt](url)` — rarer, same mistake in a different notation.
  const markdown = trimmed.match(/^!\[[^\]]*\]\(([^)\s]+)/);
  if (markdown) return markdown[1]!.trim();

  return trimmed;
}

/** The alt text a wrapped tag carried, so recovering the src does not silently drop it. */
function extractImageAlt(src: string): string {
  const alt = src.trim().match(/<img\b[^>]*?\salt\s*=\s*("([^"]*)"|'([^']*)')/i);
  return (alt?.[2] ?? alt?.[3] ?? '').trim();
}

/**
 * Swap any image source we cannot serve back to the template's placeholder.
 *
 * Reported, not silent: the model needs to learn that inventing a CDN path does not work, and a
 * reviewer needs to know an image is a stand-in rather than a real asset.
 */
function rejectInventedImages(
  value: unknown,
  template: unknown,
  allowed: Set<string>
): { value: unknown; changed: boolean; rejectedSrcs: string[] } {
  let changed = false;
  /**
   * What was actually thrown away.
   *
   * The message said only "image src was not from the asset library", which is the same mistake the
   * unknown-key path made: a model told *that* it was wrong, with no idea *what* was wrong, guesses
   * again. A live run searched the library thirteen times, invented a src anyway, was asked to retry,
   * and produced the same thing. It is also the only way to see the offending value at all — nothing
   * logged it.
   */
  const rejectedSrcs: string[] = [];

  const walk = (v: unknown, t: unknown): unknown => {
    if (Array.isArray(v)) return v.map((item, i) => walk(item, Array.isArray(t) ? t[0] : undefined));
    if (!isPlainObject(v)) return v;

    const out: Record<string, unknown> = { ...v };
    if (typeof out.src === 'string') {
      // Unwrap before judging. A correct asset in the wrong packaging is a formatting mistake, not an
      // invented URL, and the two deserve opposite treatment.
      const unwrapped = extractImageSrc(out.src);
      if (unwrapped !== out.src && isAllowedImageSrc(unwrapped, allowed)) {
        const alt = extractImageAlt(out.src);
        if (alt && !String(out.alt ?? '').trim()) out.alt = alt;
        out.src = unwrapped;
      }
    }
    if (typeof out.src === 'string' && !isAllowedImageSrc(out.src, allowed)) {
      const fallback = isPlainObject(t) && typeof t.src === 'string' ? t.src : '';
      rejectedSrcs.push(out.src);
      out.src = fallback.includes('placehold.co') ? fallback : placeholderImageUrl(1200, 800);
      changed = true;
    }
    for (const [k, nested] of Object.entries(out)) {
      if (k === 'src') continue;
      out[k] = walk(nested, isPlainObject(t) ? t[k] : undefined);
    }
    return out;
  };

  return { value: walk(value, template), changed, rejectedSrcs };
}

/** Editor types that hold content a person reads. Everything else is configuration. */
const CONTENT_EDITORS = ['text', 'richtext', 'string', 'slot', 'image', 'array'];

/**
 * Fields that are identifiers rather than copy, despite being typed as text.
 *
 * `anchor` appeared in all six entries of a live gap retry — the model was asked to "write real values"
 * for six HTML anchor ids, which cost a whole round and fixed nothing. Nobody reads an anchor; leaving
 * one empty is not an unfinished page.
 *
 * A name heuristic, and openly so: nothing in the declared metadata distinguishes an id from a heading,
 * and inferring it from the value would misfire on any short single-word heading. The list is the
 * conventional set rather than one registry's naming, and the cost of a wrong guess is small in both
 * directions — a missed identifier is one noisy line, a missed heading is one unprompted field.
 */
const IDENTIFIER_FIELDS = /^(anchor|id|slug|key|ref|name|uid|htmlId|elementId)$/i;

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
 * The `img` node inside a serialized element tree.
 *
 * Preview values are serialized React elements for some components — `desktopImageSlot` on
 * `hero-background` is `{ key, type: 'img', props: { src, alt, width, height }, _owner, _store }` —
 * even though the field descriptor advertises the shape as `{ src, alt }`. The src lives at
 * `props.src`, and anything written to a top-level `src` is invisible to the renderer.
 */
function findImageNode(node: unknown): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findImageNode(n);
      if (hit) return hit;
    }
    return null;
  }
  if (!isPlainObject(node)) return null;
  if (node.type === 'img') return node;
  for (const v of Object.values(node)) {
    const hit = findImageNode(v);
    if (hit) return hit;
  }
  return null;
}

/**
 * Write a src/alt into the first `img` in a serialized element tree, keeping it an element.
 *
 * This is the fix for a failure that reported success at every step: the merge wrote a top-level `src`
 * onto the element, the renderer went on reading `props.src`, and the later placeholder swap found and
 * replaced the key nobody renders. The changeset said "Applied", the image card said done, and the page
 * never changed.
 *
 * First image only — a `picture` with several sources is one image, not several slots.
 */
function setElementImage(node: unknown, src: string, alt: string): { value: unknown; changed: boolean } {
  let done = false;

  const walk = (n: unknown): unknown => {
    if (done) return n;
    if (Array.isArray(n)) {
      const next = n.map(walk);
      return next.some((v, i) => v !== n[i]) ? next : n;
    }
    if (!isPlainObject(n)) return n;

    if (n.type === 'img' && isPlainObject(n.props)) {
      done = true;
      const props: Record<string, unknown> = { ...n.props, src, alt };
      // A stale srcset outranks the src it was written for, so the browser would serve the old image.
      for (const k of ['srcSet', 'srcset']) if (k in props) props[k] = src;
      return { ...n, props };
    }

    const out: Record<string, unknown> = {};
    let dirty = false;
    for (const [k, v] of Object.entries(n)) {
      const w = walk(v);
      out[k] = w;
      if (w !== v) dirty = true;
    }
    return dirty ? out : n;
  };

  return { value: walk(node), changed: done };
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
export function placeholderImageUrl(w: number, h: number, label?: string): string {
  const base = `https://placehold.co/${w}x${h}`;
  if (!label) return base;
  // A labelled box says what belongs there. An unlabelled grey rectangle in a review only says
  // "something is missing", which is the least useful thing a placeholder can communicate.
  return `${base}?text=${encodeURIComponent(label.slice(0, 40))}`;
}

/** "desktopImageSlot" -> "Desktop image". Used as the placeholder's caption. */
export function humanizeFieldName(name: string): string {
  const words = name
    .replace(/Slot$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  const label = words || 'image';
  return label.charAt(0).toUpperCase() + label.slice(1);
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
    // A rendered element cannot be merged into, and it is not what the component wants back: whatever
    // was authored replaces it. Writing into the element's `props` instead — which an earlier fix did —
    // produces a value the component silently ignores in favour of its own default.
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
    out[key] = blankValue(args[key], editor, key);
  }

  return out;
}

/** Whether a serialized element tree renders an image somewhere inside it. */
function containsImage(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(containsImage);
  if (!isPlainObject(node)) return false;
  if (node.type === 'img') return true;
  return Object.values(node).some(containsImage);
}

function blankValue(value: unknown, editor: string, name = ''): unknown {
  const label = name ? humanizeFieldName(name) : '';

  if (editor === 'image' || (isPlainObject(value) && 'src' in value)) {
    // **A serialized element is render output, not an input prop.** Verified against the live
    // `hero-background` module: passing `{ src, alt }` renders; passing an element with `props.src`
    // is silently ignored and the component falls back to its own default image. So an element here is
    // not a shape to preserve — it is contaminated seed data, and the declared `{ src, alt }` contract
    // is what the component actually accepts. Dimensions are still worth lifting out of it.
    if (isReactElementish(value)) {
      const img = findImageNode(value);
      const dims = placeholderDimensions(isPlainObject(img?.props) ? (img!.props as Record<string, unknown>) : {});
      return { src: placeholderImageUrl(dims.w, dims.h, label), alt: label, width: dims.w, height: dims.h };
    }

    const template = isPlainObject(value) ? value : {};
    const { w, h } = placeholderDimensions(template);
    // Keep the template's other keys (srcset, className) so the shape still matches the component.
    // `srcset` must go with the src it described, or the browser serves the stale one.
    const out: Record<string, unknown> = { ...template, src: placeholderImageUrl(w, h, label), alt: label };
    if ('srcset' in out) out.srcset = out.src;
    return out;
  }

  // An image field whose preview carried no object at all still needs a stand-in, or the slot
  // collapses and the page loses its proportions.
  if (editor === 'image') {
    return { src: placeholderImageUrl(1200, 800, label), alt: label };
  }

  if (Array.isArray(value)) {
    // One item, blanked, as the shape to author against. Keeping all of them would hand back somebody
    // else's three press releases as a starting point.
    return value.length ? [blankValue(value[0], '', name)] : [];
  }

  // A slot whose preview renders an image is still an image slot — blanking it to "" was why
  // `mediaSlot` came through empty while `imageSlot` got a placeholder.
  if (typeof value === 'string' && /<img\b/i.test(value)) {
    return `<img src="${placeholderImageUrl(1200, 800, label)}" alt="${label}" />`;
  }
  if (isReactElementish(value) && containsImage(value)) {
    return `<img src="${placeholderImageUrl(1200, 800, label)}" alt="${label}" />`;
  }

  if (isReactElementish(value)) return '';

  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      // `_key`, `_type` and friends are bookkeeping the component may switch on — a live page came back
      // with `_type: ""` where the preview had `"statCard"`. They are not content and must survive.
      out[k] = k.startsWith('_') ? v : blankValue(v, '');
    }
    return out;
  }

  if (typeof value === 'string') return '';
  // Numbers and booleans inside a content structure are usually structural (width, isOpenByDefault).
  return value;
}

/**
 * Whether a value carries no authored content.
 *
 * Structure without content is the failure this catches: `[{stat: "", eyebrow: ""}]` is shaped
 * correctly and says nothing, which renders as an empty row rather than an obvious gap.
 */
function isEmptyContent(value: unknown): boolean {
  if (typeof value === 'string' && value.includes('placehold.co')) return false;
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'boolean' || typeof value === 'number') return false;
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmptyContent);
  if (isPlainObject(value)) {
    // Placeholder images count as filled — they are a deliberate stand-in, not a gap.
    if (typeof value.src === 'string' && value.src.includes('placehold.co')) return false;
    // Keys beginning `_` are bookkeeping (`_key`, `_type`) and say nothing about content.
    return Object.entries(value)
      .filter(([k]) => !k.startsWith('_'))
      .every(([, v]) => isEmptyContent(v));
  }
  return false;
}

/**
 * Whether an image source is one we can actually serve.
 *
 * A live page came back with `https://assets.8x8.com/images/healthcare-contact-center.jpg` — invented,
 * plausible, and a 404. That is worse than the workspace-relative paths it replaced, because it looks
 * real enough that nobody checks. An image may only be a placeholder or something the asset store
 * actually returned this turn.
 */
function isAllowedImageSrc(src: string, allowed: Set<string>): boolean {
  if (!src) return true;
  if (src.includes('placehold.co')) return true;
  if (allowed.has(src)) return true;
  // Proxy paths the app itself serves.
  return src.startsWith('/api/');
}

export interface MergeResult {
  args: Record<string, unknown>;
  /** Keys the model invented. Reported, never silently dropped. */
  unknownKeys: string[];
  /** Enum values outside the allowed set. The template's value is kept. */
  invalidValues: string[];
  /**
   * Images swapped back to a placeholder, per field.
   *
   * Separate from `invalidValues` because the two have different audiences and must say different
   * things. `invalidValues` is model-facing and ends "use the exact `src` a search_assets result gave
   * you, verbatim" — an instruction, useless to a person. The user needs to know their hero image is a
   * stand-in and why, and until now they were told nothing: the swap was silent, the op applied, the
   * card said Applied, and the reply claimed the image had been added.
   */
  replacedImages: { field: string; src: string }[];
  /**
   * Field names accepted after correcting case or a trailing plural.
   *
   * Logged rather than surfaced: nothing was refused and the user's change landed, so a warning would be
   * noise. A model that keeps needing the same correction is a prompt problem, and the log is where that
   * shows up.
   */
  correctedFields: { from: string; to: string }[];
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

/**
 * A field name that differs from a real one only by case or a trailing plural.
 *
 * `content-split` has `buttonSlots`; `card-rows` has `buttonSlot`. Two components, opposite conventions,
 * and a model that has just written one confidently writes the other. The whole update was then dropped
 * — "some components weren't edited that it listed out as being edited" — so a one-letter slip cost the
 * block its change while the reply said it had been made.
 *
 * Corrected only when **exactly one** field matches. A component holding both `image` and `images` is
 * genuinely ambiguous, and guessing between them is the confident-wrong answer this codebase keeps
 * removing; that case is still reported as unknown.
 *
 * Deliberately narrow. This is not fuzzy matching — no edit distance, no synonyms. `title` must not
 * resolve to `titleSlot`, because those are different fields with different shapes on components that
 * have both.
 */
export function resolveFieldName(key: string, available: string[]): string | null {
  if (available.includes(key)) return key;

  const normalise = (name: string) => name.toLowerCase().replace(/s$/, '');
  const target = normalise(key);
  const matches = available.filter((name) => normalise(name) === target);
  return matches.length === 1 ? matches[0]! : null;
}

export function mergeBlockValues(
  scaffoldArgs: Record<string, unknown>,
  values: Record<string, unknown> | null | undefined,
  fields?: Record<string, unknown> | null,
  /** Image sources the asset store returned this turn. Anything else is invented. */
  knownAssetSrcs?: Set<string>
): MergeResult {
  const args: Record<string, unknown> = { ...scaffoldArgs };
  const unknownKeys: string[] = [];
  const invalidValues: string[] = [];
  const replacedImages: { field: string; src: string }[] = [];
  /** Names corrected from a near-miss, for the log — an acceptance, not a rejection. */
  const correctedFields: { from: string; to: string }[] = [];
  const supplied = new Set(Object.keys(values ?? {}));
  const available = Object.keys(scaffoldArgs);

  for (const [rawKey, value] of Object.entries(values ?? {})) {
    // A near-miss on case or a trailing plural is corrected rather than dropped; anything else is
    // reported. See `resolveFieldName`.
    const key = resolveFieldName(rawKey, available);
    if (!key) {
      unknownKeys.push(rawKey);
      continue;
    }
    if (key !== rawKey) correctedFields.push({ from: rawKey, to: key });

    // An invalid enum value renders as the component's default, so the page looks like the model's
    // choice was ignored rather than rejected. Keep the template's value and report it.
    const allowed = optionValues((fields ?? {})[key]);
    if (allowed.length && typeof value === 'string' && !allowed.includes(value)) {
      invalidValues.push(`${key}="${value}" (expected one of ${allowed.join(', ')})`);
      continue;
    }

    const merged = coerceToShape(scaffoldArgs[key], value);
    const rejected = rejectInventedImages(merged, scaffoldArgs[key], knownAssetSrcs ?? new Set());
    if (rejected.changed) {
      for (const src of rejected.rejectedSrcs) replacedImages.push({ field: key, src });
      const shown = rejected.rejectedSrcs.slice(0, 2).map((s) => `"${s.slice(0, 80)}"`).join(', ');
      invalidValues.push(
        `${key}: ${shown} is not an asset-store src — replaced with a placeholder. Use the exact \`src\` ` +
          `string a search_assets result gave you, verbatim.`
      );
    }
    args[key] = rejected.value;
  }

  const unfilled: string[] = [];
  for (const [key, meta] of Object.entries(fields ?? {})) {
    // Supplied-but-empty counts as unfilled. A live page came back with four stat objects whose every
    // field was blank: the model had understood "four stats" and written none of them, and a
    // presence-only check called that done.
    if (supplied.has(key) && !isEmptyContent(args[key])) continue;
    const info = isPlainObject(meta) ? meta : {};
    const editor = typeof info.editorType === 'string' ? info.editorType : '';
    // `fromBase` means the value came from a real preview — i.e. it is somebody's sample content, not
    // a neutral default. A placeholder from the scaffold is equally unfinished.
    if (!CONTENT_EDITORS.includes(editor)) continue;
    if (IDENTIFIER_FIELDS.test(key)) continue;
    unfilled.push(key);

    // Clear an unusable asset path outright. A broken image is worse than an absent one: it reads as
    // a bug in the page rather than a gap we can still fill.
    const current = args[key];
    // A leftover element form can still reach here when nothing was authored for the field. Clearing
    // its src is the safe move: an unresolvable `../../images/...` path renders as a broken image.
    const elementImg = isReactElementish(current) ? findImageNode(current) : null;
    if (elementImg && isPlainObject(elementImg.props) && isUnusableAssetPath(elementImg.props.src)) {
      args[key] = setElementImage(current, '', '').value;
    } else if (isPlainObject(current) && isUnusableAssetPath(current.src)) {
      args[key] = { ...current, src: '' };
    } else if (isUnusableAssetPath(current)) {
      args[key] = '';
    }
  }

  return { args, unknownKeys, invalidValues, replacedImages, correctedFields, unfilled };
}

/**
 * One-line description of a component's editable fields, for the catalog listing.
 *
 * Compact on purpose: this is returned for every component in the catalog, so it has to be cheap enough
 * that the model can see all of them in a single call and stop searching one section at a time.
 */
/**
 * Describe a field by what its real preview value looks like, not by its declared editor type.
 *
 * Guessing from `editorType` produced two live bugs. Mapping every `slot` to "HTML string" made the
 * model wrap plain-text fields in `<p>` — `stats.bodySlot` and `overlineSlot` take bare text. And
 * "array — write every item" never said what an item *contains*, so it dutifully returned four stat
 * objects with every field blank.
 *
 * The preview value is the ground truth: it is what the component actually renders. `buttonSlots` is
 * `{ url, text }` here and `{ label, href }` elsewhere, and only the value knows which.
 */
/** Allowed values for a select/enum field, from the component contract. */
export function optionValues(meta: unknown): string[] {
  if (!isPlainObject(meta) || !Array.isArray(meta.options)) return [];
  return meta.options
    .map((o) => (isPlainObject(o) ? o.value : o))
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function describeValue(value: unknown, depth = 0): string {
  if (typeof value === 'string') {
    const tag = /<([a-z][a-z0-9]*)\b/i.exec(value);
    return tag ? `HTML, e.g. <${tag[1].toLowerCase()}>…` : 'plain text';
  }
  if (typeof value === 'boolean') return 'true/false';
  if (typeof value === 'number') return 'number';

  if (Array.isArray(value)) {
    if (!value.length) return 'array';
    return `array of ${describeValue(value[0], depth + 1)} — write EVERY item`;
  }

  if (isPlainObject(value)) {
    // A rendered element is markup the component draws; the authorable form is an HTML string.
    if (isReactElementish(value)) return 'HTML string';
    const keys = Object.keys(value).filter((k) => !k.startsWith('_'));
    if (!keys.length) return 'object';
    // One level deep only. Nesting the full tree would bloat a listing that covers every block.
    return depth > 0 ? `{ ${keys.join(', ')} }` : `{ ${keys.join(', ')} }`;
  }

  return 'value';
}

/**
 * One line per component field: its name and the shape its preview actually uses.
 *
 * Compact on purpose — this is returned for every block in the catalog, so the model can see all of
 * them in one call and never has to inspect a block before using it.
 */
export function summarizeFields(
  fields: Record<string, unknown> | null | undefined,
  values?: Record<string, unknown> | null,
  max = 12,
  caps?: ComponentCapabilities | null
): string {
  const entries = Object.entries(fields ?? {});
  if (!entries.length) return '';

  const parts = entries.slice(0, max).map(([name, meta]) => {
    // Enums first: a live page set `theme: "off-white"` on every block, which is not in the enum, so
    // every theme silently fell back to a default and the page came out one flat colour. The model
    // cannot vary what it cannot see the values for.
    const opts = optionValues(meta);
    if (opts.length) return `${name}: one of ${opts.slice(0, 14).join(' | ')}`;

    const seeded = values?.[name];
    if (seeded !== undefined) {
      // Examples where the value carries them. `{ stat, sub }` is ambiguous and got authored backwards;
      // `{ stat: "100", sub: "Countries" }` is not.
      // With the measured encodings for slots inside the container, where the probe found them —
      // otherwise the item shape reads `thumbnailSlot: HTML string`, which is a guess, and the wrong
      // one for every image slot in 8x8's catalog.
      const withExamples = describeJsonShape(seeded, nestedEncodingLookup(caps ?? null, name));
      return `${name}: ${withExamples ?? describeValue(seeded)}`;
    }
    const editor = isPlainObject(meta) && typeof meta.editorType === 'string' ? meta.editorType : 'any';
    return `${name}: ${editor}`;
  });
  if (entries.length > max) parts.push(`+${entries.length - max} more`);
  return parts.join(', ');
}
