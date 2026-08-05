/**
 * What a guest may edit on a page, derived from the **actual values** in the blocks.
 *
 * Client-safe (the authoring UI imports it directly) and deliberately descriptor-free. The field
 * descriptors lie about shape often enough that it has cost three debugging sessions — an image slot
 * advertised as `{ src, alt }` is really a serialized React element with the src at `props.src`, a
 * plain-text slot arrives wrapped in a `<p>`, and a "single" slot can hold an array. See the DEVLOG
 * entries for 2026-07-31. So this walks real values and reports what it finds.
 *
 * Guest edits are written into the **override layer** (`data.previews.default.values[i]`), never into
 * `components[i].args`: the template's own args stay pristine, which is what makes the review diff
 * readable — it is literally the values array.
 */

export interface PatternComponentEntry {
  id: string;
  args?: unknown;
}

/** A text value a guest can change, addressed by its path inside the block's args. */
export interface EditableText {
  /** Path segments from the block args root, e.g. `['headline']` or `['cards', 0, 'props', 'children']`. */
  path: (string | number)[];
  /** Human label derived from the path — the last meaningful key, humanized. */
  label: string;
  value: string;
}

/** An image slot, identified by the src currently in it (which is how `swapImageSrc` addresses it). */
export interface EditableImage {
  path: (string | number)[];
  src: string;
  label: string;
  width: number | null;
  height: number | null;
}

/**
 * Keys whose string values are structure, not content.
 *
 * Presenting these as editable text is worse than useless — a guest editing `className` or `type`
 * silently breaks the block, and nothing downstream would flag it.
 */
const NON_CONTENT_KEYS = new Set([
  'className',
  'class',
  'style',
  'id',
  'key',
  'type',
  'src',
  'srcSet',
  'srcset',
  'sizes',
  'href',
  'target',
  'rel',
  'name',
  'slug',
  'variant',
  'size',
  'color',
  'theme',
  'icon',
  'iconName',
  'align',
  'width',
  'height',
  'loading',
  'decoding',
  'aspectRatio',
]);

/** Longest string still treated as an editable field rather than a blob. */
const MAX_TEXT = 2000;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A serialized React element: `{ key, type, props }`. Its content lives under `props`. */
function isElementNode(v: unknown): v is { type?: unknown; props?: Record<string, unknown> } {
  return isPlainObject(v) && 'props' in v && isPlainObject((v as { props?: unknown }).props);
}

export function humanizeKey(key: string | number): string {
  if (typeof key === 'number') return `Item ${key + 1}`;
  return key
    .replace(/Slot$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

/**
 * Label for an image slot.
 *
 * `src` is skipped as well as `props`, so `desktopImageSlot.props.src` reads "Desktop Image" rather than
 * "Src" — which is what it said until a guardrail message surfaced it ("Src has no alt text"). Kept
 * separate from `labelFor` so a text field genuinely named `alt` still labels as "Alt".
 */
function labelForImage(path: (string | number)[]): string {
  return labelFor(path.filter((seg) => seg !== 'src'));
}

/** Label from the nearest meaningful key, skipping structural hops like `props` and `children`. */
function labelFor(path: (string | number)[]): string {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const seg = path[i];
    if (seg === 'props' || seg === 'children') continue;
    return humanizeKey(seg);
  }
  return 'Text';
}

/**
 * Effective args for one block: the template's args with the guest's overrides on top.
 *
 * Same precedence the playground uses when it loads a saved pattern, so what a guest edits is what
 * anyone else would see rendered.
 */
export function mergeBlockArgs(entry: PatternComponentEntry, override: unknown): Record<string, unknown> {
  const base = isPlainObject(entry.args) ? entry.args : {};
  const over = isPlainObject(override) ? override : {};
  return { ...base, ...over };
}

/** Every editable string in a block's args, in document order. */
export function collectEditableText(args: unknown): EditableText[] {
  const found: EditableText[] = [];

  const walk = (node: unknown, path: (string | number)[]) => {
    if (typeof node === 'string') {
      const key = path[path.length - 1];
      if (typeof key === 'string' && NON_CONTENT_KEYS.has(key)) return;
      const trimmed = node.trim();
      // Empty strings are skipped: an empty slot has nothing to show and no way to label itself, and
      // showing hundreds of blanks buries the fields that matter.
      if (!trimmed || trimmed.length > MAX_TEXT) return;
      // A bare URL or data URI is plumbing that happens to be a string.
      if (/^(data:|blob:|https?:\/\/|\/\/)/i.test(trimmed)) return;
      found.push({ path, label: labelFor(path), value: node });
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, i]));
      return;
    }

    if (isElementNode(node)) {
      // Descend only into props: `type`/`key` are structure. This is the shape the descriptors hide.
      walk(node.props, [...path, 'props']);
      return;
    }

    if (isPlainObject(node)) {
      for (const [key, value] of Object.entries(node)) walk(value, [...path, key]);
    }
  };

  walk(args, []);
  return found;
}

/**
 * Every image slot in a block's args.
 *
 * Reported by the src currently in the slot because that is how the swap addresses it — see
 * `swapImageSrc`, which matches on value rather than path for exactly the reasons in the DEVLOG: the
 * declared path is not reliably where the src lives.
 */
export function collectImageSrcs(args: unknown): EditableImage[] {
  const found: EditableImage[] = [];
  const seen = new Set<string>();

  const push = (path: (string | number)[], src: unknown, node: Record<string, unknown>) => {
    if (typeof src !== 'string' || !src.trim()) return;
    // One image per src: a `picture` with several `source` children is one slot, and offering the guest
    // three pickers for it would let them set two of the three and see no change.
    if (seen.has(src)) return;
    seen.add(src);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    found.push({ path, src, label: labelForImage(path), width: num(node.width), height: num(node.height) });
  };

  const walk = (node: unknown, path: (string | number)[]) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, [...path, i]));
      return;
    }
    if (isElementNode(node)) {
      const props = node.props as Record<string, unknown>;
      if (typeof props.src === 'string') push([...path, 'props', 'src'], props.src, props);
      walk(props, [...path, 'props']);
      return;
    }
    if (isPlainObject(node)) {
      if (typeof node.src === 'string') push([...path, 'src'], node.src, node);
      for (const [key, value] of Object.entries(node)) walk(value, [...path, key]);
    }
  };

  walk(args, []);
  return found;
}

/**
 * Set one path in a block's args, returning a new object.
 *
 * Structurally cloned along the path only — a full deep clone would turn serialized element nodes into
 * plain objects in ways that have already broken rendering once.
 */
export function setAtPath<T>(target: T, path: (string | number)[], value: unknown): T {
  if (!path.length) return value as T;

  const [head, ...rest] = path;

  if (typeof head === 'number') {
    const arr = Array.isArray(target) ? [...(target as unknown[])] : [];
    arr[head] = setAtPath(arr[head], rest, value);
    return arr as unknown as T;
  }

  const obj = isPlainObject(target) ? { ...target } : {};
  obj[head] = setAtPath(obj[head], rest, value);
  return obj as unknown as T;
}

/**
 * Apply one edit to the override layer for a block.
 *
 * **Why this isn't just `setAtPath` on the override.** `mergeBlockArgs` is a *shallow* merge, so an
 * override holding a partial `{ desktopImageSlot: { props: { src } } }` would replace the template's
 * whole element node — losing `type`, `key`, `width`, `className` — and the block would stop rendering.
 * That is precisely the failure documented on 2026-07-31, arrived at from the other direction.
 *
 * So the edit is applied to the *merged* args and the affected **top-level key is written whole**. The
 * override stays a set of complete top-level values, which is the only shape a shallow merge can carry
 * safely.
 */
export function applyOverride(
  entry: PatternComponentEntry,
  override: unknown,
  path: (string | number)[],
  value: unknown
): Record<string, unknown> {
  const current = isPlainObject(override) ? override : {};
  if (!path.length) return current;

  const merged = mergeBlockArgs(entry, current);
  const next = setAtPath(merged, path, value);
  const topKey = path[0];
  if (typeof topKey !== 'string') return current;

  return { ...current, [topKey]: next[topKey] };
}

/* -------------------------------------------------------------------------- */
/* Review diff (docs/GUEST-AUTHORING.md, Slice 2)                             */
/* -------------------------------------------------------------------------- */

export interface FieldChange {
  label: string;
  path: string;
  from: unknown;
  to: unknown;
  kind: 'text' | 'image';
}

export interface BlockDiff {
  componentId: string;
  index: number;
  changes: FieldChange[];
}

/**
 * What did the author change, relative to the template?
 *
 * The payoff of storing edits in the override layer: the diff needs no stored history, just the template's
 * args and the submission's overrides. A reviewer sees three edited strings instead of a wall of blocks
 * identical to the template.
 *
 * Compared against the **template's** block rather than the submission's own `components[i].args`. They are
 * normally identical (the draft is seeded from the template), but if the template has moved on since, the
 * difference a reviewer cares about is from the template as it stands now.
 *
 * Only fields a guest could actually edit are compared, using the same derivation that offered them — so
 * the diff can never claim a change in something that was never editable.
 */
export function diffSubmissionAgainstTemplate(
  submissionBlocks: PatternComponentEntry[],
  templateBlocks: PatternComponentEntry[],
  overrides: unknown[]
): BlockDiff[] {
  return submissionBlocks.map((entry, index) => {
    const submitted = mergeBlockArgs(entry, overrides[index]);
    const original = mergeBlockArgs(templateBlocks[index] ?? entry, null);

    const changes: FieldChange[] = [];
    for (const field of collectEditableText(submitted)) {
      const before = getAtPath(original, field.path);
      if (before !== field.value) {
        changes.push({ label: field.label, path: field.path.join('.'), from: before ?? null, to: field.value, kind: 'text' });
      }
    }
    for (const image of collectImageSrcs(submitted)) {
      const before = getAtPath(original, image.path);
      if (before !== image.src) {
        changes.push({ label: image.label, path: image.path.join('.'), from: before ?? null, to: image.src, kind: 'image' });
      }
    }
    return { componentId: entry.id, index, changes };
  });
}

/** Read one path back, for verifying a write landed where it was aimed. */
export function getAtPath(target: unknown, path: (string | number)[]): unknown {
  let cur: unknown = target;
  for (const seg of path) {
    if (typeof seg === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (!isPlainObject(cur)) return undefined;
      cur = cur[seg];
    }
  }
  return cur;
}
