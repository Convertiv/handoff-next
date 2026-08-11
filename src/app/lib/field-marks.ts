import type Handlebars from 'handlebars';

/**
 * Where a field renders, marked in the output — the foundation inline editing stands on for Handlebars
 * (roadmap F.1).
 *
 * **One module because there are three participants**: the `{{#field}}` helper that *writes* the marks, the
 * editor that *reads* them to place an overlay, and the tests. Three copies of a wire format is how the format
 * drifts, and this one is load-bearing — a mismatch means the editor silently finds nothing.
 *
 * **Comment markers, not a wrapper element.** The build-time helper
 * (`src/transformers/utils/handlebars.ts`) wraps its block in `<span class="handoff-field" data-handoff-field=…>`,
 * which is fine for the `-inspect.html` debug artifacts it serves. It is not fine in the live canvas: measured
 * across SS&C's 83 templates, **26 of 292 field blocks wrap block-level content** — `footer.submenu` wraps `<li>`,
 * `hero_video.breadcrumb` wraps `<ul>` — and a `<span>` around those is invalid nesting the browser reparents,
 * breaking both the layout and the association the mark exists to create. (Also checked: `{{#field}}` never
 * appears inside an HTML attribute in those templates, where a comment would corrupt the value instead.)
 *
 * A comment pair is valid anywhere, invisible to layout and to CSS selectors, cannot be reparented, and gives an
 * exact **node range** rather than a guess at "the next sibling" — which is what `Range.getBoundingClientRect()`
 * needs to position an overlay.
 *
 * **Payload is the field name and the row index, nothing more** (Brad, 2026-08-10: "just the field name and index
 * seems like plenty"). The descriptor is already in the editor's hands, so carrying it here would be a second copy
 * to keep in sync.
 */

/** `title`, or `items.paragraph:2` for a row of a repeater. */
export function fieldMarkId(field: string, index?: unknown): string {
  return typeof index === 'number' ? `${field}:${index}` : field;
}

export function fieldMarkOpen(id: string): string {
  return `<!--hf:${id}-->`;
}

export function fieldMarkClose(id: string): string {
  return `<!--/hf:${id}-->`;
}

/**
 * Matches one marked field and captures `[id, body]`.
 *
 * The back-reference is what keeps nested marks honest — an inner field cannot be mistaken for the end of an
 * outer one. `[^->]+` on the id stops a malformed comment from swallowing the rest of the document.
 */
export const FIELD_MARK_RE = /<!--hf:([^->]+)-->([\s\S]*?)<!--\/hf:\1-->/g;

export interface ParsedFieldMark {
  /** `items.paragraph:2` — the raw id, as written. */
  id: string;
  /** `items.paragraph` — the field path, without the row index. */
  field: string;
  /** The row index, when the mark carried one. */
  index: number | null;
  /** The rendered content between the marks. Empty for a slot that rendered nothing. */
  body: string;
}

/**
 * Every marked field in a rendered template, outer before inner.
 *
 * **Recurses into each body, because marks nest**: `{{#field "items"}}` wraps `{{#field "items.title"}}` on
 * `accordion`, and a single pass returns only the outer one — `matchAll` consumes the whole outer body, so the
 * inner mark is never offered as its own match. That would have silently hidden every field inside a repeater.
 *
 * A note on scope: **this is the string-based reader**, for build-time checks and tests. In the browser the editor
 * walks comment *nodes* through a `TreeWalker`, where nesting is not a problem at all because the nodes are flat
 * siblings in document order. Both read the same format; only the traversal differs.
 */
export function parseFieldMarks(html: string): ParsedFieldMark[] {
  const out: ParsedFieldMark[] = [];
  // A fresh regex per call: `FIELD_MARK_RE` is global and therefore stateful, and recursion shares it otherwise.
  const re = new RegExp(FIELD_MARK_RE.source, 'g');
  for (const [, id, body] of html.matchAll(re)) {
    const match = /^(.*):(\d+)$/.exec(id);
    out.push({
      id,
      field: match ? match[1] : id,
      index: match ? Number(match[2]) : null,
      body,
    });
    if (body.includes('<!--hf:')) out.push(...parseFieldMarks(body));
  }
  return out;
}

/**
 * Register the playground's `{{#field}}` helper on a Handlebars instance.
 *
 * `options.data.index` is Handlebars' `@index` for the enclosing `{{#each}}` frame, which is what disambiguates
 * `items.title` across rows — the ambiguity that made an annotation-only mapping look unworkable.
 */
export function registerFieldMarkHelper(hb: typeof Handlebars): void {
  hb.registerHelper('field', function (this: unknown, field: string, options: Handlebars.HelperOptions) {
    const body = options.fn(this);
    // A missing or non-string name means the helper was called oddly: render the body, mark nothing.
    if (typeof field !== 'string' || !field) return body;
    const id = fieldMarkId(field, (options.data as { index?: unknown } | undefined)?.index);
    return new hb.SafeString(`${fieldMarkOpen(id)}${body}${fieldMarkClose(id)}`);
  });
}

/**
 * A mark id → the path into a block's args, as `handleInputChange` takes it.
 *
 * `title` → `['title']`; `author.linked_in` → `['author','linked_in']`; `items.paragraph:1` →
 * `['items', 1, 'paragraph']`.
 *
 * **The index is placed after the first segment**, because that is where templates put it: the helper is written
 * `{{#field "items.paragraph"}}` *inside* `{{#each properties.items}}`, so the row belongs to `items`. A deeper
 * repeater (`a.b.c` inside an each over `a.b`) would need the frame to say which segment the index belongs to —
 * the mark carries only one index today, and no template in the catalog nests repeaters that way. If one appears,
 * the mark format is where to fix it, not this function.
 */
export function fieldIdToArgsPath(id: string): (string | number)[] {
  const match = /^(.*):(\d+)$/.exec(id);
  const field = match ? match[1] : id;
  const segments: (string | number)[] = field.split('.').filter(Boolean);
  if (!match) return segments;
  const index = Number(match[2]);
  // A bare `items:0` addresses the row itself; otherwise the row sits between the array and the leaf.
  return segments.length <= 1 ? [...segments, index] : [segments[0], index, ...segments.slice(1)];
}

/**
 * Field paths a **text overlay** may safely edit — `text` and `string`, nothing else.
 *
 * Inline editing seeds its overlay from the marked range's *text*, so it is only correct where the value really is
 * a plain string. Two shapes proved that the hard way when the F.2 harness ran over real template output:
 *
 * - **A field wrapping a repeater.** `footer.menu` wraps `<li>Privacy</li><li>Terms</li>`, and the range's text is
 *   `"PrivacyTerms"`. Committing that writes a string over an *array of objects* — silent corruption of exactly the
 *   kind this phase exists to prevent.
 * - **Richtext.** `<strong>One</strong> unified system.` reads back as `One unified system.`, so committing it
 *   quietly strips the markup. Richtext stays in the rail, which has the formatting controls, until the overlay can
 *   carry markup rather than text.
 *
 * Everything not listed gets **no hit area at all** in the canvas — no affordance rather than a lossy one, the same
 * degrade-to-nothing rule the rest of the phase follows.
 */
export function textEditableFieldPaths(properties: unknown, prefix: string[] = []): string[] {
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const out: string[] = [];
  for (const [key, raw] of Object.entries(properties as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const prop = raw as Record<string, unknown>;
    const path = [...prefix, key];
    const declared =
      (typeof prop.editorType === 'string' && prop.editorType) || (typeof prop.type === 'string' ? prop.type : '');
    if (declared === 'text' || declared === 'string') out.push(path.join('.'));
    if (prop.properties) out.push(...textEditableFieldPaths(prop.properties, path));
    const items = prop.items as Record<string, unknown> | undefined;
    // Array items keep the parent's path, matching how a template inside `{{#each}}` names them.
    if (items?.properties) out.push(...textEditableFieldPaths(items.properties, path));
  }
  return out;
}
