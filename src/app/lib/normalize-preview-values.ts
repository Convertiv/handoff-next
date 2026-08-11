import { deriveLens, readPath } from './field-lens';

/**
 * Turn serialized render output back into the input props a component actually accepts — applied **at the sync
 * boundary**, where previews enter (Phase F `F.-1`, the capture-repair half).
 *
 * **The problem.** For React registries, stored preview values are serialized render *output*, not input props.
 * The browser round-trip in `docs/FIELD-BRIDGE.md` established what happens when they are fed back: the declared
 * shape renders, an element with `props.src` is **silently replaced** by the component's own default, and the
 * stored value verbatim **throws** `(e || []).filter is not a function`. Measured on 8x8: 86 fields across 37 of
 * 76 components, 23 of them the throwing kind.
 *
 * **Why here.** Nothing in this app serializes elements — they arrive already output-shaped from the component
 * build upstream, through `sync-queries.ts`. Fixing the build is the real repair and lives in another repo; this
 * is the boundary where the app can stop accepting contaminated data without waiting for it. Every write path
 * downstream (the editor, guests, MCP, guardrails, audits) reads what sync stored, so repairing once here fixes
 * all of them at the same time.
 *
 * **Four rules, because this rewrites data on ingest:**
 *
 * 1. **Never guess.** A value is replaced only when a faithful plain equivalent can be *read out of it*. Where
 *    it cannot — a declared `array` holding an element, whose real items are unrecoverable — the value is left
 *    exactly as it was and `contract-render-audit` keeps reporting it. A wrong repair is worse than a known gap.
 * 2. **Never touch slots.** `React.ReactNode` / `object` / `any` legitimately hold element trees. Normalising
 *    those would break every correct React slot.
 * 3. **Idempotent.** A normalised value is already plain, so a second pass finds nothing. Sync runs repeatedly.
 * 4. **Say what changed.** Every substitution is returned, so a sync can log it rather than silently rewriting
 *    somebody's registry.
 */

/** Declared types that take a plain serializable value — the only ones eligible for normalising. */
const PLAIN_DECLARED = new Set(['text', 'string', 'richtext', 'image', 'image-url', 'button', 'link', 'array']);

/** A slot genuinely holds an element tree. */
const SLOT_DECLARED = new Set(['React.ReactNode', 'slot', 'any', 'object']);

export interface NormalizedChange {
  previewKey: string;
  path: string;
  declaredType: string;
  /** What it became, for the log. The original is still in the sync payload's history. */
  to: unknown;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function declaredTypeOf(prop: unknown): string {
  if (!isPlainObject(prop)) return '';
  // An authored `editorType` states intent and wins, matching how the renderer chooses a widget.
  return (typeof prop.editorType === 'string' && prop.editorType) || (typeof prop.type === 'string' ? prop.type : '');
}

/**
 * Every string inside an element tree, in document order.
 *
 * Used only for `text`/`string` fields, where the authorable value is the copy the element renders. Keys that
 * hold structure rather than content are skipped so a class name never becomes the headline.
 */
function flattenText(node: unknown): string {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(flattenText).filter(Boolean).join(' ');
  if (!isPlainObject(node)) return '';
  const props = isPlainObject(node.props) ? node.props : {};
  return flattenText(props.children);
}

/**
 * Every `<a>` node in an element tree, outermost first.
 *
 * The anchors are where a button's real values live: `props.href` and the first string in `props.children`.
 */
function findAnchors(node: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const n of node) findAnchors(n, out);
    return out;
  }
  if (!isPlainObject(node)) return out;
  if (node.type === 'a') out.push(node);
  const props = isPlainObject(node.props) ? node.props : {};
  findAnchors(props.children, out);
  return out;
}

/**
 * `{ url, text }` read out of an `<a>` element — the shape `ButtonField` reads and writes.
 *
 * The label is the first *string* child: a rendered button is `["Get Started", null]` or
 * `["See all resources", <span><svg/></span>]`, where the trailing child is a chevron icon rather than copy.
 */
function anchorToButton(anchor: Record<string, unknown>): { url: string; text: string } | undefined {
  const props = isPlainObject(anchor.props) ? anchor.props : {};
  const href = typeof props.href === 'string' ? props.href : '';
  const children = Array.isArray(props.children) ? props.children : [props.children];
  const text = children.find((c): c is string => typeof c === 'string' && c.trim().length > 0)?.trim() ?? '';
  if (!href && !text) return undefined;
  return { url: href, text };
}

/**
 * A plain equivalent of an element-shaped value, or `undefined` when none can be read out faithfully.
 *
 * Extraction goes through `deriveLens`, which already knows where the writable leaves of a serialized element
 * are — so this cannot disagree with the rest of the field bridge about where a value lives.
 */
export function plainEquivalent(value: unknown, declaredType: string): unknown {
  /**
   * A rendered button, back to `{ url, text }` — and an `array` of them back to a real array.
   *
   * All 23 of the declared-`array`-holding-an-element cases measured on 8x8 are this one shape, in two variants:
   * a wrapper element whose `props.children` are `<a>` nodes (`buttonSlots`), or a single `<a>` (`footerButtonSlot`).
   * Both invert mechanically by reading the anchors, so this is still "read it out", not a guess — which is why
   * the array case moved out of the leave-alone set once the data was actually looked at.
   *
   * A wrapper containing no anchors yields nothing rather than an empty array: an empty array would look like a
   * deliberate "no buttons" and quietly drop whatever was really there.
   */
  if (declaredType === 'button' || declaredType === 'link' || declaredType === 'array') {
    const buttons = findAnchors(value).map(anchorToButton).filter((b): b is { url: string; text: string } => Boolean(b));
    if (!buttons.length) return undefined;
    // A single-valued field takes the button itself; an array field takes all of them.
    return declaredType === 'array' ? buttons : buttons[0];
  }


  /**
   * Everything below needs the lens to have recognised an element.
   *
   * The button case above deliberately does not: `isElementish` requires a `type` key, and a rendered
   * `buttonSlots` wrapper is `{ key, props, _owner }` with no `type` at all — so gating it on the lens made it
   * depend on React internals happening to be present. Finding an anchor is the evidence instead.
   */
  const lens = deriveLens(value);
  if (lens.kind !== 'element' && lens.kind !== 'html') return undefined;

  if (declaredType === 'richtext') {
    // An element carrying `dangerouslySetInnerHTML`: the authorable value is the markup string itself.
    if (lens.kind === 'html') {
      const html = readPath(value, lens.paths.html);
      return typeof html === 'string' && html.trim() ? html : undefined;
    }
    const text = flattenText(value).trim();
    return text || undefined;
  }

  if (declaredType === 'text' || declaredType === 'string') {
    const text = flattenText(value).trim();
    return text || undefined;
  }

  if (declaredType === 'image' || declaredType === 'image-url') {
    if (lens.kind !== 'element') return undefined;
    const src = readPath(value, lens.paths.src ?? []);
    if (typeof src !== 'string' || !src.trim()) return undefined;
    // `image-url` is bound to the URL string itself, not an object around it.
    if (declaredType === 'image-url') return src;

    const out: Record<string, unknown> = { src };
    for (const leaf of ['alt', 'srcSet', 'srcset'] as const) {
      const path = lens.paths[leaf];
      if (!path) continue;
      const read = readPath(value, path);
      if (read !== undefined && read !== null && read !== '') out[leaf] = read;
    }

    /**
     * Dimensions come from the img's own props, not from the lens.
     *
     * `WRITABLE_LEAVES` deliberately excludes `width`/`height` — they are not things an author edits — but they
     * are worth carrying across, because a slot that loses them collapses and the page loses its proportions
     * (the same reason `blankValue` lifts them out). The lens still supplies the *location*: `paths.src` ends at
     * `props.src`, so its parent is the props object.
     */
    const propsPath = (lens.paths.src ?? []).slice(0, -1);
    const imgProps = propsPath.length ? readPath(value, propsPath) : undefined;
    if (isPlainObject(imgProps)) {
      for (const dim of ['width', 'height'] as const) {
        const read = imgProps[dim];
        if (typeof read === 'number' && Number.isFinite(read)) out[dim] = read;
        else if (typeof read === 'string' && read.trim()) out[dim] = read;
      }
    }
    // Alt is part of the declared shape; an empty string is a real answer, a missing key is not.
    if (!('alt' in out)) out.alt = '';
    return out;
  }

  return undefined;
}

/**
 * Normalise a component's previews against its contract.
 *
 * Returns the previews to store plus the substitutions made. When nothing changed the **original object is
 * returned by identity**, so a caller can skip a write entirely.
 */
export function normalizePreviewValues(
  properties: unknown,
  previews: unknown
): { previews: unknown; changes: NormalizedChange[] } {
  const changes: NormalizedChange[] = [];
  if (!isPlainObject(properties) || !isPlainObject(previews)) return { previews, changes };

  const nextPreviews: Record<string, unknown> = {};
  let touched = false;

  for (const [previewKey, preview] of Object.entries(previews)) {
    // A preview is `{ values, … }`; tolerate a bare values object, as `scaffold-args` does.
    const hasWrapper = isPlainObject(preview) && isPlainObject(preview.values);
    const values = hasWrapper ? (preview.values as Record<string, unknown>) : preview;
    if (!isPlainObject(values)) {
      nextPreviews[previewKey] = preview;
      continue;
    }

    const nextValues: Record<string, unknown> = { ...values };
    let changedHere = false;

    for (const [key, value] of Object.entries(values)) {
      const type = declaredTypeOf((properties as Record<string, unknown>)[key]);
      if (!type || SLOT_DECLARED.has(type) || !PLAIN_DECLARED.has(type)) continue;

      const plain = plainEquivalent(value, type);
      if (plain === undefined) continue;

      nextValues[key] = plain;
      changedHere = true;
      changes.push({ previewKey, path: key, declaredType: type, to: plain });
    }

    if (!changedHere) {
      nextPreviews[previewKey] = preview;
      continue;
    }
    touched = true;
    nextPreviews[previewKey] = hasWrapper
      ? { ...(preview as Record<string, unknown>), values: nextValues }
      : nextValues;
  }

  // Identity when untouched, so an unchanged sync writes nothing new.
  return { previews: touched ? nextPreviews : previews, changes };
}
