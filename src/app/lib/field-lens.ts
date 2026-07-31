/**
 * Where a field's editable value actually lives, derived from the value itself.
 *
 * The bridge between the UI/AI and a component's data model is currently a *label* — `shapeNote`
 * returns the string `'{ src, alt, width?, height? }'` for every field declared `image`, in every
 * component, in every registry. A label describes a shape; it does not say where to write. That gap
 * produced three production bugs (see `docs/FIELD-BRIDGE.md`), the worst of which reported success at
 * every step and changed nothing: the merge wrote a top-level `src`, the renderer read `props.src`.
 *
 * A lens is a location, and a location can be checked. This module derives one from a real preview
 * value and reports where the declared editor type disagrees with it.
 *
 * ⚠️ **The interpretation of those disagreements is inverted from what the verdict names suggest.**
 * A browser round-trip against the live `hero-background` module (see the CORRECTION at the top of
 * `docs/FIELD-BRIDGE.md`) showed the *declared* shape renders and the *derived* one is silently
 * ignored: stored preview values are serialized render output, not input props. So a `breaks-write`
 * finding means "this preview value cannot be fed back into the component", not "this descriptor is
 * wrong". The 176 findings are real; the remedy is repairing preview capture, not writing lenses.
 * The verdict names should be changed to say so.
 *
 * **React registries only.** Handlebars components take plain serializable JSON as template context, so
 * the value's shape is the declared shape and there is nothing to locate.
 */

export type LensPath = (string | number)[];

export type FieldLens =
  /** Plain data: `{ src, alt }`. Paths are top-level keys. */
  | { kind: 'object'; paths: Record<string, LensPath> }
  /** A serialized React element. The writable leaves live under `props`. */
  | { kind: 'element'; tag: string | null; paths: Record<string, LensPath> }
  /** An element rendering markup via `dangerouslySetInnerHTML`. */
  | { kind: 'html'; paths: Record<string, LensPath> }
  | { kind: 'string' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  /** Homogeneous list; `item` is the lens for one entry. */
  | { kind: 'array'; item: FieldLens | null }
  /** Nothing usable to derive from — no preview value, or null. */
  | { kind: 'unknown' };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isElementish = (v: unknown): v is Record<string, unknown> =>
  isPlainObject(v) && (('props' in v && 'type' in v) || '_owner' in v || '$$typeof' in v);

/** Leaf keys worth exposing to an editor, in the order an editor would show them. */
const WRITABLE_LEAVES = ['src', 'alt', 'srcSet', 'srcset', 'href', 'url', 'text', 'label', 'title', 'value'];

/**
 * Find a nested node and the path to it.
 *
 * Depth-first and first-match: a `picture` with several `source` elements is one image, not several
 * editable slots.
 */
function findNode(
  node: unknown,
  match: (n: Record<string, unknown>) => boolean,
  path: LensPath = []
): { node: Record<string, unknown>; path: LensPath } | null {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i += 1) {
      const hit = findNode(node[i], match, [...path, i]);
      if (hit) return hit;
    }
    return null;
  }
  if (!isPlainObject(node)) return null;
  if (match(node)) return { node, path };
  for (const [k, v] of Object.entries(node)) {
    const hit = findNode(v, match, [...path, k]);
    if (hit) return hit;
  }
  return null;
}

/** Derive a lens from a real preview value. */
export function deriveLens(value: unknown): FieldLens {
  if (value === null || value === undefined) return { kind: 'unknown' };
  if (typeof value === 'string') return { kind: 'string' };
  if (typeof value === 'number') return { kind: 'number' };
  if (typeof value === 'boolean') return { kind: 'boolean' };

  if (Array.isArray(value)) {
    return { kind: 'array', item: value.length ? deriveLens(value[0]) : null };
  }

  if (isElementish(value)) {
    // Markup first: an element carrying `dangerouslySetInnerHTML` is a richtext slot, and its editable
    // value is the HTML string, not the element.
    const html = findNode(value, (n) => isPlainObject(n.dangerouslySetInnerHTML));
    if (html) {
      return { kind: 'html', paths: { html: [...html.path, 'dangerouslySetInnerHTML', '__html'] } };
    }

    const img = findNode(value, (n) => n.type === 'img');
    if (img && isPlainObject(img.node.props)) {
      const paths: Record<string, LensPath> = {};
      for (const leaf of WRITABLE_LEAVES) {
        if (leaf in img.node.props) paths[leaf] = [...img.path, 'props', leaf];
      }
      // Even when the preview omits `src`, that is where a write belongs on an img.
      if (!paths.src) paths.src = [...img.path, 'props', 'src'];
      return { kind: 'element', tag: 'img', paths };
    }

    // A generic element: expose whatever writable leaves its own props carry.
    const props = isPlainObject(value.props) ? value.props : {};
    const paths: Record<string, LensPath> = {};
    for (const leaf of WRITABLE_LEAVES) {
      if (leaf in props) paths[leaf] = ['props', leaf];
    }
    return { kind: 'element', tag: typeof value.type === 'string' ? value.type : null, paths };
  }

  if (!isPlainObject(value)) return { kind: 'unknown' };

  const paths: Record<string, LensPath> = {};
  for (const leaf of WRITABLE_LEAVES) {
    if (leaf in value) paths[leaf] = [leaf];
  }
  return { kind: 'object', paths };
}

/** Read through a lens path. */
export function readPath(value: unknown, path: LensPath): unknown {
  let cur: unknown = value;
  for (const step of path) {
    if (Array.isArray(cur) && typeof step === 'number') cur = cur[step];
    else if (isPlainObject(cur) && typeof step === 'string') cur = cur[step];
    else return undefined;
  }
  return cur;
}

/**
 * Write through a lens path, immutably, creating nothing that does not already exist.
 *
 * Refusing to create missing intermediate nodes is deliberate: a path that does not resolve means the
 * lens does not describe this value, and inventing structure to make the write land is how you get a
 * write that "succeeds" into a shape the renderer never reads.
 */
export function writePath<T>(value: T, path: LensPath, next: unknown): { value: T; changed: boolean } {
  if (!path.length) return { value: next as T, changed: true };

  const [step, ...rest] = path;
  if (Array.isArray(value) && typeof step === 'number') {
    if (step < 0 || step >= value.length) return { value, changed: false };
    const inner = writePath(value[step], rest, next);
    if (!inner.changed) return { value, changed: false };
    const copy = [...value] as unknown as T & unknown[];
    copy[step] = inner.value;
    return { value: copy as T, changed: true };
  }
  if (isPlainObject(value) && typeof step === 'string') {
    if (!(step in value)) return { value, changed: false };
    const inner = writePath(value[step], rest, next);
    if (!inner.changed) return { value, changed: false };
    return { value: { ...value, [step]: inner.value } as T, changed: true };
  }
  return { value, changed: false };
}

// ── Conformance audit ────────────────────────────────────────────────────────

/**
 * `breaks-write` — a write through the declared shape lands somewhere the renderer does not read. This
 * is the silent class: it reports success and changes nothing.
 *
 * `misleads-author` — the declared shape describes the value wrongly, so whoever authors against it
 * produces bad content, but the write itself lands. Visible, and cheaper.
 */
export type FieldVerdict = 'ok' | 'breaks-write' | 'misleads-author' | 'no-preview';

export interface FieldAudit {
  componentId: string;
  preview: string;
  field: string;
  editorType: string;
  declaredShape: string;
  observed: string;
  verdict: FieldVerdict;
  note?: string;
}

/** One-line description of a derived lens, for the report. */
export function describeLens(lens: FieldLens): string {
  switch (lens.kind) {
    case 'element':
      return `React element <${lens.tag ?? '?'}> (writes at ${Object.entries(lens.paths)
        .map(([k, p]) => `${k}:${p.join('.')}`)
        .join(', ') || 'nothing writable'})`;
    case 'html':
      return `React element carrying HTML (writes at ${lens.paths.html!.join('.')})`;
    case 'object':
      return `plain object { ${Object.keys(lens.paths).join(', ') || '…' } }`;
    case 'array':
      return `array of ${lens.item ? describeLens(lens.item) : 'unknown'}`;
    default:
      return lens.kind;
  }
}

/**
 * Compare what a field declares against what its preview value actually is.
 *
 * The rules are not general theory — each one is a bug that shipped.
 */
export function auditField(input: {
  componentId: string;
  preview: string;
  field: string;
  editorType: string;
  declaredShape: string;
  value: unknown;
  hasPreviewValue: boolean;
}): FieldAudit {
  const { editorType, value, hasPreviewValue } = input;
  const lens = deriveLens(value);
  const base = { ...input, observed: describeLens(lens) };
  delete (base as { value?: unknown }).value;
  delete (base as { hasPreviewValue?: unknown }).hasPreviewValue;

  if (!hasPreviewValue) {
    return { ...base, verdict: 'no-preview', note: 'No preview exercises this field — shape is unverified.' } as FieldAudit;
  }

  // The bug that reported success and changed nothing.
  if (editorType === 'image') {
    if (lens.kind === 'element') {
      const srcPath = lens.paths.src?.join('.') ?? '';
      if (srcPath !== 'src') {
        return {
          ...base,
          verdict: 'breaks-write',
          note: `Declared "{ src, alt }" but the src lives at ${srcPath || 'no locatable path'}. A top-level src is not rendered.`,
        } as FieldAudit;
      }
    } else if (lens.kind !== 'object' || !lens.paths.src) {
      return {
        ...base,
        verdict: 'breaks-write',
        note: `Declared "{ src, alt }" but the value is ${lens.kind} with no src to write.`,
      } as FieldAudit;
    }
  }

  // `buttonSlots` declared array while holding a single element — crashed the editor with
  // `items.map is not a function`.
  if (editorType === 'array' && lens.kind !== 'array') {
    return {
      ...base,
      verdict: 'breaks-write',
      note: `Declared an array but the value is ${lens.kind}. Array editors and per-item writes both fail.`,
    } as FieldAudit;
  }
  if (editorType !== 'array' && lens.kind === 'array') {
    return { ...base, verdict: 'misleads-author', note: `Value is an array but the field is declared ${editorType}.` } as FieldAudit;
  }

  // The `<p>` bug: a slot declared as HTML that actually takes bare text.
  if ((editorType === 'richtext' || editorType === 'slot') && lens.kind === 'string') {
    const looksLikeHtml = typeof value === 'string' && /<[a-z][\s\S]*>/i.test(value);
    if (!looksLikeHtml) {
      return {
        ...base,
        verdict: 'misleads-author',
        note: 'Declared an HTML string but the real value is bare text — markup renders as visible tags.',
      } as FieldAudit;
    }
  }

  if ((editorType === 'text' || editorType === 'string') && (lens.kind === 'element' || lens.kind === 'html')) {
    return {
      ...base,
      verdict: 'breaks-write',
      note: `Declared plain text but the value is a ${lens.kind}. A string write replaces the element.`,
    } as FieldAudit;
  }

  return { ...base, verdict: 'ok' } as FieldAudit;
}

export interface BridgeReport {
  components: number;
  fields: number;
  breaksWrite: number;
  misleadsAuthor: number;
  noPreview: number;
  ok: number;
  /** Everything that is not `ok`, worst first. */
  findings: FieldAudit[];
}

export function summarizeAudits(audits: FieldAudit[]): BridgeReport {
  const rank: Record<FieldVerdict, number> = { 'breaks-write': 0, 'misleads-author': 1, 'no-preview': 2, ok: 3 };
  const findings = audits.filter((a) => a.verdict !== 'ok').sort((a, b) => rank[a.verdict] - rank[b.verdict]);
  return {
    components: new Set(audits.map((a) => a.componentId)).size,
    fields: audits.length,
    breaksWrite: audits.filter((a) => a.verdict === 'breaks-write').length,
    misleadsAuthor: audits.filter((a) => a.verdict === 'misleads-author').length,
    noPreview: audits.filter((a) => a.verdict === 'no-preview').length,
    ok: audits.filter((a) => a.verdict === 'ok').length,
    findings,
  };
}
