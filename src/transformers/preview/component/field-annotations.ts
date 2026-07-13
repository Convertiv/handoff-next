import { SlotMetadata, SlotType, RuleObject } from '../slots';

/**
 * Serializable subset of a `fields` annotation (COMPONENT_PREVIEW_SCHEMA §12a).
 * The authored `FieldAnnotation` also carries a `render` function — that is
 * CODE and is deliberately absent here: it never enters the PropertySpec map
 * and never serializes. This helper merges only the data.
 */
export interface SerializableFieldAnnotation {
  editorType?: string;
  label?: string;
  description?: string;
  options?: Array<string | { value: string; label?: string }>;
  of?: string;
  rules?: RuleObject;
  default?: SlotMetadata['default'];
  hidden?: boolean;
}

/**
 * Apply each field's `render` (the Storybook `mapping` step) to the matching
 * prop value: serializable editor value → real prop value (often a React node).
 * Only fields whose annotation carries a function `render` transform anything;
 * all other props pass through untouched. Pure; returns a new object.
 *
 * Used at SSR (build, in-process) and mirrored inline in the client bundle so
 * the static render and the live/hydrated render agree.
 */
export function applyRenderFns(
  props: Record<string, unknown> | null | undefined,
  fields: Record<string, { render?: unknown } | undefined> | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(props ?? {}) };
  if (!fields) return out;
  for (const [key, ann] of Object.entries(fields)) {
    const render = ann && typeof ann === 'object' ? (ann as { render?: unknown }).render : undefined;
    if (typeof render === 'function' && key in out) {
      out[key] = (render as (v: unknown) => unknown)(out[key]);
    }
  }
  return out;
}

/** Editor → closed value type. The editor asserts intent, so it wins on `type`. */
const EDITOR_TO_SLOTTYPE: Record<string, SlotType> = {
  text: SlotType.TEXT,
  richtext: SlotType.TEXT,
  number: SlotType.NUMBER,
  boolean: SlotType.BOOLEAN,
  select: SlotType.ENUM,
  image: SlotType.IMAGE,
  link: SlotType.TEXT,
  button: SlotType.BUTTON,
  icon: SlotType.TEXT,
  object: SlotType.OBJECT,
  array: SlotType.ARRAY,
  slot: SlotType.TEXT,
};

function normalizeOptions(
  raw: Array<string | { value: string; label?: string }>
): Array<{ value: string; label?: string }> {
  return raw.map((o) => (typeof o === 'string' ? { value: o } : { value: String(o.value), label: o.label }));
}

/**
 * Merge `fields` annotations onto the resolved PropertySpec map — the build-time
 * extraction that makes the authoring layer real. Only the *serializable* meta
 * lands (editorType/options/label/rules/default, `hidden` removes, `of` shapes
 * arrays); the annotation's `render` function is ignored here (it stays in the
 * preview bundle). A field annotation for a prop the inference didn't surface
 * creates a minimal property so the builder still shows it.
 *
 * Pure: returns a new map, does not mutate the input.
 */
export function applyFieldAnnotations(
  properties: Record<string, SlotMetadata> | null | undefined,
  fields: Record<string, (SerializableFieldAnnotation & { render?: unknown }) | undefined> | undefined
): Record<string, SlotMetadata> {
  const out: Record<string, SlotMetadata> = { ...(properties ?? {}) };
  if (!fields) return out;

  for (const [key, ann] of Object.entries(fields)) {
    if (!ann || typeof ann !== 'object') continue;

    if (ann.hidden) {
      delete out[key];
      continue;
    }

    const existing = out[key];
    const base: SlotMetadata = existing ?? { name: key, description: '', generic: '', type: SlotType.ANY };
    const next: SlotMetadata = { ...base };

    if (ann.editorType) {
      next.editorType = ann.editorType;
      const mapped = EDITOR_TO_SLOTTYPE[ann.editorType];
      if (mapped) next.type = mapped;
    }
    if (ann.label) next.name = ann.label;
    if (ann.description) next.description = ann.description;
    if (ann.options) next.options = normalizeOptions(ann.options);
    if (ann.rules) next.rules = { ...(base.rules ?? {}), ...ann.rules };
    if (ann.default !== undefined) next.default = ann.default;
    if (ann.of) {
      const itemType = EDITOR_TO_SLOTTYPE[ann.of] ?? SlotType.ANY;
      next.type = SlotType.ARRAY;
      next.items = { ...(base.items ?? {}), type: itemType, editorType: ann.of };
    }

    out[key] = next;
  }

  return out;
}
