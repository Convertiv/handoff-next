/**
 * The `of:` vocabulary — what one item of an array field is, for authoring.
 *
 * A component's props are a *rendering* contract; `of:` is the first piece of an *authoring* one. See
 * `docs/AUTHORING-BRIDGE.md` for the whole argument. The short version: 39 array fields across 8x8's
 * catalog already declare `of:` — `button` ×23, `card` ×4, `image` ×2, `slide`, `row`, `location`,
 * `product`, `mediaKitCard`, `object` — and nothing anywhere defined what those names mean. The
 * vocabulary was already in use as a convention; this gives it a definition.
 *
 * **Two tiers, and the split is the point.**
 *
 * A few terms have a shape that is genuinely universal in this system. `image` is one: every image value
 * anywhere in Handoff is `{ src, alt }`, because that is what the encoding library says and what the
 * probe measures. Declaring that shape is safe.
 *
 * Most terms name a *kind* and nothing more. `card` means something different on `card-rows`,
 * `media-kit` and `related-cards`. `button` is worse than unknown — it is **ambiguous**: the catalog
 * measures both `array-of-urltext` (`{ url, text }`) and `array-of-labelhref` (`{ label, href }`), so a
 * vocabulary that picked one would be wrong roughly half the time. Those terms carry no shape, and the
 * item shape has to come from measurement or from an explicit `item` declaration on the field.
 *
 * Inventing a shape for them would be the confident-wrong answer this codebase has spent a month
 * removing: a form that reports success and changes nothing, or an MCP scaffold that names keys the
 * component discards.
 *
 * Pure.
 */

/** A field in an authoring shape — enough for a widget and for an MCP description. */
export interface AuthoringField {
  editorType: string;
  /** The prop encoding this authoring value projects to, where one is known. */
  encoding?: string;
  label?: string;
}

export interface AuthoringShape {
  /** What kind of thing an item is, for a human reading the catalog. */
  kind: string;
  /**
   * The item's fields, when they are universal.
   *
   * Absent means "kind known, shape not" — measurement or an explicit `item:` decides. That is the honest
   * answer for `card`, `slide`, `row` and the rest, and the *only* honest answer for `button`, which is
   * measured two different ways in the same catalog.
   */
  itemFields?: Record<string, AuthoringField>;
  /** Why the shape is absent, shown to whoever is wondering where their fields went. */
  note?: string;
}

export const AUTHORING_SHAPES: Record<string, AuthoringShape> = {
  image: {
    kind: 'image',
    // Universal: the encoding library defines an image value as `{ src, alt }` everywhere.
    //
    // `src` holds a **URL string**, which is why its editor is `image-url` and not `image`. An `image`
    // editor is bound to a whole image *object* and writes `src`/`srcset`/`alt` inside the value it is
    // given — so pointing one at `src` produced `src.src` and the component rendered
    // `<img src="[object Object]">`. The item is the image object; `src` is one string inside it.
    itemFields: {
      src: { editorType: 'image-url', label: 'Image' },
      alt: { editorType: 'text', label: 'Alt text' },
    },
  },

  // Ambiguous rather than unknown — both conventions are measured in this catalog, so picking one would
  // be wrong about half the components that say `of: "button"`.
  button: {
    kind: 'link',
    note: 'Buttons are measured as either { url, text } or { label, href } — the shape comes from the probe.',
  },
  link: {
    kind: 'link',
    note: 'Links are measured as either { url, text } or { label, href } — the shape comes from the probe.',
  },

  // Kind known, shape per component. `card` on `card-rows` is not `card` on `media-kit`.
  card: { kind: 'card', note: 'Card shape varies per component — declare `item:` or let the probe measure it.' },
  mediaKitCard: { kind: 'card', note: 'Card shape varies per component — declare `item:`.' },
  product: { kind: 'record', note: 'Product shape varies per component — declare `item:`.' },
  slide: { kind: 'record', note: 'Slide shape varies per component — declare `item:`.' },
  row: { kind: 'record', note: 'Row shape varies per component — declare `item:`.' },
  location: { kind: 'record', note: 'Location shape varies per component — declare `item:`.' },
  object: { kind: 'record', note: 'A plain object — declare `item:` to say what it holds.' },
};

/** The declared shape for an `of:` term, or null when the term is unknown to the vocabulary. */
export function authoringShapeFor(of: unknown): AuthoringShape | null {
  return typeof of === 'string' && of ? (AUTHORING_SHAPES[of] ?? null) : null;
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
export function itemFieldsForEncoding(encoding: string | null): Record<string, AuthoringField> | null {
  switch (encoding) {
    case 'array-of-image-object':
      // `src` is a URL string, not a nested image object — see the `image` entry above for what assuming
      // otherwise produced.
      return { src: { editorType: 'image-url' }, alt: { editorType: 'text' } };
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
 * The item fields for an array field, by precedence.
 *
 * **Measurement wins.** A declared `item:` describes what an author supplies; a measured encoding
 * describes what the component actually accepts. Until projections are wired — see
 * `docs/AUTHORING-BRIDGE.md` — a declared shape the props cannot take would produce a form that reports
 * success and changes nothing, which is the failure this whole line of work exists to remove. Once a
 * field declares a `render` projection *and* we can verify it renders, the order flips and the declared
 * authoring shape leads.
 *
 * So: vocabulary as a floor, an explicit `item:` over it, measurement over both.
 */
export function resolveItemFields(input: {
  /** The field annotation — `of`, `item`. */
  field?: Record<string, unknown> | null;
  /** The measured encoding for the container prop, if the probe resolved one. */
  encoding?: string | null;
}): Record<string, AuthoringField> | null {
  const merged: Record<string, AuthoringField> = {};
  let any = false;

  const shape = authoringShapeFor(input.field?.of);
  for (const [name, def] of Object.entries(shape?.itemFields ?? {})) {
    merged[name] = def;
    any = true;
  }

  const declared = input.field?.item;
  if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
    for (const [name, def] of Object.entries(declared as Record<string, unknown>)) {
      if (!def || typeof def !== 'object') continue;
      merged[name] = { ...merged[name], ...(def as AuthoringField) };
      any = true;
    }
  }

  for (const [name, def] of Object.entries(itemFieldsForEncoding(input.encoding ?? null) ?? {})) {
    merged[name] = { ...merged[name], ...def };
    any = true;
  }

  return any ? merged : null;
}

/** Which authoring kind a measured prop encoding belongs to. */
const ENCODING_KIND: Record<string, string> = {
  'image-object': 'image',
  'array-of-image-object': 'image',
  'link-object': 'link',
  'array-of-urltext': 'link',
  'array-of-labelhref': 'link',
  'html-string': 'text',
  'plain-text': 'text',
  'array-of-text': 'text',
};

/**
 * Pick the accepted encoding the field is *for*, when measurement finds more than one.
 *
 * This is where `of:` earns its place, and it is not the gap-filling role I first assumed.
 * `logo-cloud-heading.logoSlots` measures **both** `array-of-image-object` and `array-of-labelhref` —
 * both genuinely render — so `accepts[0]` is decided by the specificity ranking, which is a heuristic
 * about which encoding is more informative in general, not about what this field means. The annotation
 * says `of: "image"`, and that is intent: logos are images.
 *
 * They happen to agree here, because image outranks link. The point is that the answer no longer *depends*
 * on them agreeing.
 *
 * Falls back to `accepts[0]` when the term says nothing useful — which includes the case `of:` cannot
 * settle: `array-of-urltext` and `array-of-labelhref` are both `link` kind and both specificity 44, so a
 * field accepting both is still decided by order. Measuring is not the same as disambiguating, and this
 * only claims the part it can do.
 */
export function preferredEncoding(accepts: readonly string[], of?: unknown): string | null {
  if (!accepts?.length) return null;

  const shape = authoringShapeFor(of);
  if (shape) {
    const wanted = accepts.find((e) => ENCODING_KIND[e] === shape.kind);
    if (wanted) return wanted;
  }
  return accepts[0] ?? null;
}
