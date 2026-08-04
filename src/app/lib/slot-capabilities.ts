/**
 * Read the slot capability record a component was pushed with.
 *
 * The record is produced at build time by rendering the component with sentinel values (see
 * `transformers/plugins/slot-probe.ts`) and says which encodings each `React.ReactNode` slot actually
 * accepts. It is the measured replacement for `shapeNote`, which asserted `{ src, alt }` for anything
 * whose field name matched /image/ and was wrong often enough to cost a month.
 *
 * Stored inside the component's `data` jsonb rather than its own column: adding a column to a hot table
 * breaks every read of it on any deployment where the migration has not landed, which took the
 * generation queue down on 2026-07-31.
 */

export interface SlotCapability {
  /** Accepted encodings, most specific first. `accepts[0]` is what a consumer should write. */
  accepts: string[];
  rejects: string[];
  threw: string[];
  unresolved: boolean;
}

export interface ComponentCapabilities {
  componentId: string;
  candidates: string[];
  slots: Record<string, SlotCapability>;
  unresolved: string[];
  error?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Pull the record off a component row.
 *
 * Returns null rather than an empty record when there is none, because **"not probed" and "probed and
 * found nothing" must stay distinguishable.** Treating an unprobed component as having no capabilities
 * would silently mark every one of its slots uneditable, which is the same class of confident-wrong
 * answer this whole mechanism exists to remove.
 */
export function readCapabilities(component: unknown): ComponentCapabilities | null {
  if (!isRecord(component)) return null;
  const data = isRecord(component.data) ? component.data : null;
  const raw = (isRecord(component.capabilities) ? component.capabilities : null) ?? (data && isRecord(data.capabilities) ? data.capabilities : null);
  if (!raw) return null;

  const slotsRaw = isRecord(raw.slots) ? raw.slots : {};
  const slots: Record<string, SlotCapability> = {};
  for (const [name, value] of Object.entries(slotsRaw)) {
    if (!isRecord(value)) continue;
    const accepts = Array.isArray(value.accepts) ? value.accepts.filter((a): a is string => typeof a === 'string') : [];
    slots[name] = {
      accepts,
      rejects: Array.isArray(value.rejects) ? value.rejects.filter((a): a is string => typeof a === 'string') : [],
      threw: Array.isArray(value.threw) ? value.threw.filter((a): a is string => typeof a === 'string') : [],
      unresolved: accepts.length === 0,
    };
  }

  return {
    componentId: typeof raw.componentId === 'string' ? raw.componentId : '',
    candidates: Array.isArray(raw.candidates) ? raw.candidates.filter((c): c is string => typeof c === 'string') : [],
    slots,
    unresolved: Object.entries(slots).filter(([, c]) => c.unresolved).map(([n]) => n),
    ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
  };
}

/**
 * The encoding a consumer should write into this slot, or null when there is no measured answer.
 *
 * Null covers three different situations on purpose — never probed, probed and nothing worked, or the
 * slot is not a slot at all — because every one of them means the same thing to a caller: **do not
 * guess a shape.** The failure mode being avoided is a form that reports success and changes nothing.
 */
export function encodingForSlot(caps: ComponentCapabilities | null, slot: string): string | null {
  return caps?.slots?.[slot]?.accepts?.[0] ?? null;
}

/** Whether a slot has any measured encoding. A slot without one should not be offered as editable. */
export function isSlotEditable(caps: ComponentCapabilities | null, slot: string): boolean {
  return !!encodingForSlot(caps, slot);
}

// ── The encoding library ─────────────────────────────────────────────────────
//
// The other half of the bridge. Probing says *which* encoding a slot takes; this says what a value in
// that encoding looks like. Together they are the whole thing — a fixed, shared set of encodings plus a
// measured per-slot lookup. Neither half is written per client.

/** Placeholder dimensions, so a slot keeps its proportions before real content arrives. */
export interface PlaceholderHints {
  label?: string;
  width?: number;
  height?: number;
}

const placeholderImage = (w: number, h: number, label?: string) =>
  `https://placehold.co/${w}x${h}${label ? `?text=${encodeURIComponent(label.slice(0, 40))}` : ''}`;

/**
 * A shape-correct empty value for an encoding.
 *
 * Empty rather than sample: a scaffold seeded with somebody's sample copy renders as finished when it is
 * not, which is how pages shipped with lorem ipsum in the stats block. Images are the exception — a
 * dimensioned placeholder shows the page's proportions, where nothing at all collapses the layout.
 *
 * Returns `undefined` for an unknown encoding rather than guessing. A caller with no answer must leave
 * the field alone, not invent one.
 */
export function placeholderForEncoding(encoding: string | null, hints: PlaceholderHints = {}): unknown {
  const { label = '', width = 1200, height = 800 } = hints;
  switch (encoding) {
    case 'plain-text':
      return '';
    case 'html-string':
      return '';
    case 'array-of-text':
      return [];
    case 'image-object':
      return { src: placeholderImage(width, height, label), alt: label };
    case 'array-of-image-object':
      return [];
    case 'link-object':
      return { label: '', url: '' };
    case 'array-of-urltext':
      return [];
    case 'array-of-labelhref':
      return [];
    case 'serialized-element':
      // Measured as accepted by nothing across 8x8's catalog. If a component ever does accept it, an
      // editor still has no sane way to author one, so it is not offered as a placeholder.
      return undefined;
    default:
      return undefined;
  }
}

/**
 * What to tell an authoring model to write for this encoding.
 *
 * Replaces `shapeNote`, which mapped a *declared* editor type to a prose shape and asserted
 * `{ src, alt }` for anything whose field name matched /image/. The difference is not the wording — it
 * is that this describes an encoding the component was observed to accept.
 */
export function describeEncoding(encoding: string | null): string | null {
  switch (encoding) {
    case 'plain-text':
      return 'plain text, no markup';
    case 'html-string':
      return 'HTML string, e.g. "<p>Copy with <b>bold</b></p>"';
    case 'array-of-text':
      return 'array of plain strings';
    case 'image-object':
      return '{ src, alt } — src must come from the asset store';
    case 'array-of-image-object':
      return 'array of { src, alt } — every src from the asset store';
    case 'link-object':
      return '{ label, url }';
    case 'array-of-urltext':
      return 'array of { url, text } — write every item';
    case 'array-of-labelhref':
      return 'array of { label, href } — write every item';
    default:
      return null;
  }
}

/** Which editor widget suits an encoding. Null means no widget is safe — show raw JSON with a warning. */
export function widgetForEncoding(encoding: string | null): 'text' | 'richtext' | 'image' | 'link' | 'list' | null {
  switch (encoding) {
    case 'plain-text':
      return 'text';
    case 'html-string':
      return 'richtext';
    case 'image-object':
      return 'image';
    case 'link-object':
      return 'link';
    case 'array-of-text':
    case 'array-of-image-object':
    case 'array-of-urltext':
    case 'array-of-labelhref':
      return 'list';
    default:
      return null;
  }
}

/**
 * The fields one item of a container takes, for a measured container encoding.
 *
 * `image-gallery.images` measured `array-of-image-object`, meaning an item is `{ src, alt }` — and the
 * declared item type `ImageGalleryImage` has **no `src` at all**. Its fields are `alt`, `caption`,
 * `thumbnailSlot` and `lightboxSlot`, the last two of which the probe found accept nothing. So the block
 * editor offered two slots that cannot be authored and no way to set the picture, which is exactly the
 * report: "thumbnailSlot and lightboxSlot aren't getting converted to image fields".
 *
 * They never can be. The component's own field annotation rebuilds each item from `src` unless the slot
 * already holds a React element, so `src` is the authorable field and it is undeclared. Measurement found
 * the truth the type does not carry; this is how it reaches the form.
 */
export function itemFieldsForEncoding(encoding: string | null): Record<string, { editorType: string; encoding?: string }> | null {
  switch (encoding) {
    case 'array-of-image-object':
      return { src: { editorType: 'image', encoding: 'image-object' }, alt: { editorType: 'text' } };
    case 'array-of-urltext':
      return { url: { editorType: 'text' }, text: { editorType: 'text' } };
    case 'array-of-labelhref':
      return { label: { editorType: 'text' }, href: { editorType: 'text' } };
    default:
      // `array-of-text` items are bare strings and have no fields; anything else is unmapped.
      return null;
  }
}

/**
 * Overlay measured encodings onto a component's declared properties, for the block editor.
 *
 * The editor renders from `properties` (the raw schema) while the scaffold renders from the capability
 * record — so wiring only the scaffold left MCP and the chat showing measured shapes while the editor
 * still showed a slot editor for a field the component takes as `{ src, alt }`. Two consumers
 * disagreeing about one field is the failure mode that has cost the most time on this work; this closes
 * the last instance of it.
 *
 * Declared metadata is preserved except for `editorType` — dimension rules, descriptions and enum
 * options are intent, authored per registry, and remain useful.
 */
export function applyCapabilitiesToProperties<T extends Record<string, unknown>>(
  properties: T,
  caps: ComponentCapabilities | null
): T {
  if (!caps || !properties) return properties;

  let changed = false;
  const out: Record<string, unknown> = {};

  for (const [name, meta] of Object.entries(properties)) {
    const slot = caps.slots?.[name];
    if (!slot || !isRecord(meta)) {
      out[name] = meta;
      continue;
    }

    // Nothing accepted: the slot is not editable. Flagged rather than silently re-typed — a form that
    // reports success and changes nothing is the thing this whole mechanism exists to stop. Left on its
    // declared editor for now so nothing regresses; the UI can act on the flag.
    if (slot.unresolved) {
      out[name] = { ...meta, measured: true, editable: false };
      changed = true;
      continue;
    }

    const widget = widgetForEncoding(slot.accepts[0] ?? null);
    if (!widget) {
      out[name] = meta;
      continue;
    }

    out[name] = { ...meta, editorType: widget, encoding: slot.accepts[0], measured: true };
    changed = true;
  }

  /**
   * Item fields for a measured container, which is where the gallery went wrong.
   *
   * Done as a second pass because the container's own record and its nested slots' records are separate
   * entries — `images`, `images[].thumbnailSlot`, `images[].lightboxSlot` — and the item overlay needs
   * all of them.
   *
   * **Augmenting, not replacing.** `caption` is a plain string the component passes through and an author
   * writes; wiping the declared item shape to the measured one would take it with them. What changes is
   * that the measured fields appear, and item slots the probe found nothing for stop being offered.
   */
  for (const [name, meta] of Object.entries(out)) {
    const encoding = caps.slots?.[name]?.accepts?.[0] ?? null;
    const measuredItems = itemFieldsForEncoding(encoding);
    if (!isRecord(meta)) continue;
    const items = isRecord(meta.items) ? meta.items : null;
    const declared = items && isRecord(items.properties) ? items.properties : null;
    if (!measuredItems && !declared) continue;

    const itemProps: Record<string, unknown> = { ...(declared ?? {}) };
    let itemChanged = false;

    for (const [field, shape] of Object.entries(measuredItems ?? {})) {
      const existing = isRecord(itemProps[field]) ? itemProps[field] : {};
      itemProps[field] = {
        // A name, so the form has a label even for a field the schema never declared.
        name: field,
        type: shape.editorType,
        kind: 'primitive',
        ...existing,
        editorType: shape.editorType,
        ...(shape.encoding ? { encoding: shape.encoding } : {}),
        measured: true,
      };
      itemChanged = true;
    }

    // Item slots the probe reached and found nothing for. Offering an editor that changes nothing is the
    // failure this whole mechanism exists to remove.
    for (const field of Object.keys(itemProps)) {
      const nested = caps.slots?.[`${name}[].${field}`];
      if (!nested?.unresolved || !isRecord(itemProps[field])) continue;
      itemProps[field] = {
        ...itemProps[field],
        measured: true,
        editable: false,
        note: 'This component accepts no editable value here — set the image on the item instead.',
      };
      itemChanged = true;
    }

    if (itemChanged) {
      out[name] = { ...meta, items: { ...(items ?? {}), properties: itemProps } };
      changed = true;
    }
  }

  return changed ? (out as T) : properties;
}

/**
 * A lookup for the slots inside one container prop.
 *
 * Nested slots are recorded under their path — `cards[].imageSlot`, `subCard.bodySlot`,
 * `logoSlots[]` — because a bare field name is not unique: two different containers on one component
 * can both have a `bodySlot`, and they need not accept the same thing.
 *
 * The three return values are distinct and all three matter:
 *   a string — measured, write this
 *   `null`   — probed, nothing worked; the field is not editable
 *   `undefined` — never probed; the caller should fall back rather than assert anything
 */
export function nestedEncodingLookup(
  caps: ComponentCapabilities | null,
  prop: string
): ((field: string) => string | null | undefined) | undefined {
  if (!caps?.slots) return undefined;
  return (field: string) => {
    const cap = caps.slots[`${prop}[].${field}`] ?? caps.slots[`${prop}.${field}`];
    if (!cap) return undefined;
    return cap.accepts[0] ?? null;
  };
}

/** The encoding for a bare array of elements, `logoSlots[]`. Same three-way return. */
export function bareArrayEncoding(caps: ComponentCapabilities | null, prop: string): string | null | undefined {
  const cap = caps?.slots?.[`${prop}[]`];
  if (!cap) return undefined;
  return cap.accepts[0] ?? null;
}
