import { deriveLens } from './field-lens';

/**
 * `scaffold → render → assert`, in the parts that can actually be asserted — Phase F's `F.-1`.
 *
 * **What this is not.** It does not render React. `constructComponentPreview` emits a props script plus a
 * client-side mount for a React component, and `renderPreview` server-side returns that same mount rather than
 * DOM (established building E.10) — so there is no server-side render to assert against, and a harness that
 * claimed otherwise would be asserting over a `<script>` tag.
 *
 * **What it asserts instead**, each backed by a failure already observed in production rather than a rule
 * invented here:
 *
 * 1. **`unfeedable-preview`** — the stored preview value cannot be fed back into the component. The browser
 *    round-trip in `docs/FIELD-BRIDGE.md` (against the real `hero-background-client.mjs` module) established
 *    the three outcomes: the declared shape renders; an element with `props.src` is **silently ignored** and
 *    replaced by the component's own default; the stored value verbatim **throws**
 *    `(e || []).filter is not a function`. So an element-shaped value against a plain declared type is a known
 *    defect, not a guess. This is the 19%, made per-field and actionable.
 * 2. **`undeclared-reference`** — the template renders `properties.X` that the contract does not declare. The
 *    field is unsettable through any API (the validator rejects the key) and the element renders empty forever.
 *    Found on `blog_header.paragraph`, where `scaffold_args` reported `declared: 9, provided: 9, emptySlots: []`
 *    — the self-check cannot see a slot the contract does not know about, which is what makes it worth a check
 *    of its own.
 * 3. **`declared-unrendered`** — the mirror image: the contract declares a property the template never uses, so
 *    the API cheerfully accepts a value that changes nothing.
 *
 * Checks 2 and 3 need the template source; 1 needs only the contract and its previews. Callers pass whatever
 * they have, which is why this takes plain data rather than reaching for a provider — the same function runs
 * against the database and against a workspace on disk.
 */

export type RenderFindingCode = 'unfeedable-preview' | 'undeclared-reference' | 'declared-unrendered';

export interface RenderFinding {
  componentId: string;
  code: RenderFindingCode;
  path: string;
  message: string;
}

/**
 * Declared types that take a **plain serializable value**, so a serialized element in one is unfeedable.
 *
 * Classified here rather than through `resolveFieldType` on purpose: that lives in the field UI and exists to
 * pick a *widget*, and importing it would drag React components into a server-side audit. This only needs one
 * distinction — does the contract promise a plain value, or a slot that legitimately holds an element.
 */
const PLAIN_DECLARED = new Set([
  'text',
  'string',
  'richtext',
  'image',
  'image-url',
  'video_file',
  'button',
  'link',
  'number',
  'boolean',
  'select',
  'enum',
]);

/** A slot genuinely holds an element tree — flagging these would flag every correct React slot. */
const SLOT_DECLARED = new Set(['React.ReactNode', 'slot', 'any', 'object']);

function declaredType(prop: unknown): string {
  if (!prop || typeof prop !== 'object') return '';
  const p = prop as Record<string, unknown>;
  // An authored `editorType` states intent and wins, matching how the renderer chooses.
  const editor = typeof p.editorType === 'string' ? p.editorType : '';
  if (editor) return editor;
  return typeof p.type === 'string' ? p.type : '';
}

/** Longest-lived preview values per property key, across every preview a component ships. */
function previewValuesByKey(previews: unknown): Map<string, unknown[]> {
  const out = new Map<string, unknown[]>();
  if (!previews || typeof previews !== 'object') return out;
  for (const preview of Object.values(previews as Record<string, unknown>)) {
    const values = ((preview as Record<string, unknown>)?.values ?? preview) as Record<string, unknown>;
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
    for (const [key, value] of Object.entries(values)) {
      out.set(key, [...(out.get(key) ?? []), value]);
    }
  }
  return out;
}

/**
 * Property names a Handlebars template references.
 *
 * Matches `properties.foo` inside any mustache, which is the idiom these templates use
 * (`{{#field 'paragraph'}}{{properties.paragraph}}{{/field}}`). Only the first segment is taken: a reference to
 * `properties.authors.0.role` is a use of `authors`, and treating the whole path as a name would report a
 * declared `authors` as unrendered.
 */
export function templatePropertyRefs(template: string): Set<string> {
  const refs = new Set<string>();
  for (const m of template.matchAll(/properties\.([A-Za-z_$][\w$]*)/g)) refs.add(m[1]);
  // `{{#field 'name'}}` marks an editable region and names the property even when the body differs.
  for (const m of template.matchAll(/#field\s+['"]([^'"]+)['"]/g)) refs.add(m[1]);
  return refs;
}

/**
 * Every path the contract declares, dotted, including nested object and array-item fields.
 *
 * Templates address nested content the way they nest it — `{{#field "items.title"}}` inside an `{{#each}}` —
 * so comparing refs against top-level keys alone reported `items.title` as undeclared on any component with a
 * repeater. That was four false positives on `accordion` in the first run, which is exactly the noise that
 * makes a report ignorable, so nesting is resolved rather than approximated.
 *
 * Array items are emitted **without** an index segment, matching how a template inside `{{#each}}` writes them.
 */
export function declaredPaths(properties: unknown, prefix: string[] = []): Set<string> {
  const out = new Set<string>();
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return out;
  for (const [key, raw] of Object.entries(properties as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const prop = raw as Record<string, unknown>;
    const path = [...prefix, key];
    out.add(path.join('.'));
    if (prop.properties) for (const p of declaredPaths(prop.properties, path)) out.add(p);
    const items = prop.items as Record<string, unknown> | undefined;
    if (items?.properties) for (const p of declaredPaths(items.properties, path)) out.add(p);
  }
  return out;
}

export function auditContractRender(input: {
  componentId: string;
  properties: unknown;
  previews?: unknown;
  /** Handlebars template source, when the caller has it. Omit to skip checks 2 and 3. */
  template?: string | null;
}): RenderFinding[] {
  const { componentId, properties, previews, template } = input;
  const findings: RenderFinding[] = [];
  const props = (properties && typeof properties === 'object' && !Array.isArray(properties)
    ? (properties as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  // ── 1. Can the stored preview value be fed back in? ──────────────────────────
  const byKey = previewValuesByKey(previews);
  for (const [key, prop] of Object.entries(props)) {
    const type = declaredType(prop);
    if (!type || SLOT_DECLARED.has(type)) continue;

    for (const value of byKey.get(key) ?? []) {
      const lens = deriveLens(value);
      const elementish = lens.kind === 'element' || lens.kind === 'html';

      if (elementish && PLAIN_DECLARED.has(type)) {
        findings.push({
          componentId,
          code: 'unfeedable-preview',
          path: key,
          message: `${key} is declared \`${type}\` but its stored preview is a serialized element — fed back, the component ignores it and renders its own default.`,
        });
        break;
      }
      if (type === 'array' && elementish) {
        findings.push({
          componentId,
          code: 'unfeedable-preview',
          path: key,
          message: `${key} is declared \`array\` but its stored preview is a single serialized element — fed back, the component throws on \`.filter\`.`,
        });
        break;
      }
    }
  }

  // ── 2 & 3. Template references vs the declared contract ──────────────────────
  if (typeof template === 'string' && template.trim()) {
    const refs = templatePropertyRefs(template);
    const declared = declaredPaths(props);

    for (const ref of refs) {
      // Exact match, or a use of a declared parent (`properties.items` on its own is a use of `items`).
      if (declared.has(ref) || declared.has(ref.split('.')[0])) continue;
      findings.push({
        componentId,
        code: 'undeclared-reference',
        path: ref,
        message: `The template renders \`properties.${ref}\`, which the contract does not declare — unsettable through the API, so it renders empty on every page.`,
      });
    }

    /**
     * Compared at the top level only, against each ref's first segment: a nested field is exercised whenever
     * its parent is, so descending here would report every leaf of a rendered object as unrendered.
     */
    const usedRoots = new Set([...refs].map((r) => r.split('.')[0]));
    for (const key of Object.keys(props)) {
      if (usedRoots.has(key)) continue;
      findings.push({
        componentId,
        code: 'declared-unrendered',
        path: key,
        message: `${key} is declared but the template never renders it — the API accepts a value that changes nothing.`,
      });
    }
  }

  return findings;
}
