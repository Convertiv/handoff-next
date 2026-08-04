# From props contract to authoring contract

**Status:** design note, 2026-08-04. Written after tracing `image-gallery.thumbnailSlot` through 8x8 to
answer a QA report — "the thumbnailSlot and lightboxSlot aren't getting converted to image fields".

The short answer to that report is that they never can be. The longer answer is the interesting one: it
exposes the difference between describing a component's props and giving someone a way to author it, and
most of the machinery to close that gap already exists in the repo.

---

## Part 1 — The trace

### What an author actually fills in

Sanity, `studio/src/schemaTypes/objects/blocks/imageGallery.ts`:

```
images: array of {
  type: 'image',              ← the item IS an image asset
  fields: [ alt, caption ]
}
```

One image per item, plus alt and caption. No `thumbnailSlot`. No `lightboxSlot`.

### What the component receives

`web/lib/component-library/wrappers/ImageGalleryBlock.tsx` derives **both** slots from that one image:

```tsx
thumbnailSlot: <Image src={image} width={400}  height={300}  className="object-cover" />
lightboxSlot:  <Image src={image} width={1200} height={800}  className="object-contain" />
```

`component-library/src/blocks/content/ImageGallery.tsx` then renders them verbatim —
`{image.thumbnailSlot}` in the grid, `{currentImage?.lightboxSlot}` in the lightbox. The declared type
says so out loud:

```ts
/** Thumbnail image (rendered by consumer). Recommended source: 800 x 600 … */
thumbnailSlot?: React.ReactNode;
```

**`thumbnailSlot` is an output of the consumer, not an input an author sets.** It exists so Next's
`<Image>` optimisation lives in the website rather than in the component library — a deliberate and
correct separation.

### What Handoff does

`handoff/components/blocks/image-gallery/template.tsx` mimics the production wrapper:

```tsx
const previewImage = image.src ? image : image.image;
thumbnailSlot: renderPreviewImageSlot(image.thumbnailSlot, previewImage, 'object-cover')
```

Use the slot if given; otherwise build the `<img>` from `src`. So Handoff's authorable field is `src` —
the same "the item is an image" model Sanity uses.

But the generated `schema.ts` declares:

```
item props: _key, alt, caption, thumbnailSlot, lightboxSlot     ← src is not among them
```

The block editor renders `items.properties`, so it offered two fields that accept nothing and no way to
set the picture.

### Why the schema is wrong about this

`scripts/sync-handoff-blocks.ts` generates the schema from the component's **TypeScript props** — the
*consumer* contract — while authoring uses fields the props never mention. It is not gallery-specific:

| | |
|---|---|
| Block templates using the preview slot helpers | **43** |
| `image-gallery` slot fields declared | `bodySlot`, `thumbnailSlot`, `lightboxSlot` |
| Their authoring sources, declared | none — `body`, `src` appear nowhere in the schema |

`bodySlot` is the same story: the template pairs it with `block.body`, and the schema has the slot and not
the source.

### One correction, worth its own line

`image-gallery.bodySlot` also probed as unresolved, and I had filed it with the unauthorable slots. It is
not — it is a **probe artefact**:

```
probed with images: []       bodySlot accepts=[]                          ← what shipped
probed with one image        bodySlot accepts=[html-string, plain-text]
```

The component renders nothing when `images` is empty, so the sentinel never appeared. The two *item*
slots stay unresolved even with context — those are genuine.

So of three "not editable" fields on this block, one was a false negative, and the same shape — a
component that renders nothing until its array has an item — likely affects others among the 25 top-level
unresolved slots. **That list is probably overstated.** `probeContext` is the existing escape hatch for
exactly this, and at the time of writing no 8x8 block declared one.

**Measured, later the same day.** 11 blocks have both an unresolved top-level slot and a required array,
and all 11 now declare a `probeContext` (uncommitted in 8x8, pending review). Supplying one throwaway item
per required array:

| Outcome | Blocks |
|---|---|
| **False negative, now resolved** | `auto-tag-cards` (2 slots), `card-rows` (2), `sliding-vertical-carousel` (2), `bento-lottie-grid`, `filterable-card-grid`, `image-gallery` |
| **Genuinely unauthorable** — rejects every encoding *with* an item present | `content-tabs.bodySlot`, `split-card-carousel.footerButtonSlot` |
| **Behind interaction state** — `probeContext` sets props, and no prop opens the modal | `pricing-carousel.modalFooterSlot` |
| **Fails outright** — throws on 8 of 9 encodings; a real defect, not a probe artefact | `job-table.bodySlot` |
| **Unverifiable outside the build** | `product-comparison` (see below) |

So the list was overstated by **9 of 25 top-level unresolved slots** — 6 blocks' worth — and the remaining
four are now explained rather than merely unresolved. A minimal `[{ _key: 'probe' }]` performed identically
to items derived from real preview values, so the declarations stay small.

### A trap worth naming, because it cost an hour

**A probe that fails to load reports `unresolved: []`** — the same value a component with no problems
reports. `product-comparison` is the one bundle of 68 that leaves `react` as an external import, and the
probe writes the bundle to a temp dir where ESM cannot resolve a bare specifier, so it reported a perfectly
clean component while measuring nothing at all. This is the vacuous-pass problem from
`docs/AGENT-TESTING.md` in a different costume.

**Closed in code the same day**, rather than left as advice to read `capabilities.error` first — advice is
what fails under time pressure, and I had ignored my own. A bail now records `unprobed: [targets]` so the
failure states its scope, and `readCapabilities` returns `null` for an errored record with no slots, so no
consumer can read a failed probe as a measurement. Six tests cover it, each confirmed to fail without the
guard. See `docs/SLOT-PROBING.md` § "When the probe fails".

---

## Part 2 — The general problem

A React component's props are a **rendering** contract: what it needs in order to draw. An authoring
contract is a different thing: what a person or a model can meaningfully supply.

Between them sits a **projection** — `authoringValue → props`. In 8x8 that projection is written three
times:

1. **Production**, in the Sanity wrapper — Sanity value → props.
2. **Preview**, in `template.tsx` — preview value → props.
3. **Editor**, in the `fields.*.render` annotations — editor value → props.

Three implementations of one mapping. That is the same "two callers disagree about one value" failure that
has produced most of this month's bugs, at architecture scale rather than function scale.

The projection is where the authoring contract lives, and it is currently *executable but not
inspectable*: `images.render` accepts `[{ key, alt, caption, src }]`, and the only way to know that is to
read the function body. So the editor cannot offer `src`, and MCP cannot describe it.

---

## Part 3 — What already exists

More than I expected. Three of the four pieces are in place.

**A vocabulary of item types.** `of:` is already declared on 39 array fields across the catalog:

```
23  of: "button"     4  of: "card"      2  of: "image"      1  of: "slide"
 4  of: "object"      2  of: "product"  1  of: "row"        1  of: "location"
                                                            1  of: "mediaKitCard"
```

**A projection, in the right place.** `blocks/<id>/<id>.js` — the component's own Handoff definition —
carries the `fields` annotations, and its comment already states the intent:

> Field annotations (Handoff's argTypes) — refine the generated `schema.ts` slots into real builder
> widgets, and map serializable editor values back to ReactNode slots via `render`.

That is precisely the bridge, already written, already shipped, already executed by the client bundle.

**Measured prop encodings.** The build-time probe renders each slot with sentinel values and records what
it accepts (`docs/SLOT-PROBING.md`). It found `image-gallery.images` accepts `array-of-image-object` —
i.e. it *inferred* that an item is `{ src, alt }`, which is the very fact the schema was missing.

**What is missing** is the fourth piece: nothing **declares the shape** the projection consumes. `of:
"image"` names a shape nobody defines; `render` eats a shape nobody describes.

---

## Part 4 — The proposed bridge

**Infer the shape, declare the intent.** The probe can discover what a prop accepts by rendering; it
cannot discover a label, a size recommendation, requiredness, or which declared field to suppress. So:

| Layer | Source | Example |
|---|---|---|
| **Prop encoding** | measured, by the probe | `image-object`, `array-of-image-object`, `html-string` |
| **Authoring shape** | declared, from a shared vocabulary | `image`, `richText`, `link`, `list<image>` |
| **Projection** | declared once, per component | `render(authoringValue) → props` |

Two things make this work rather than just re-describing the problem:

**1. The vocabulary is finite and shared.** Exactly like the encoding library, `image`, `button`, `card`,
`richText` are defined *once, in handoff-app*, not per registry. An editor knows how to render each; MCP
knows how to describe each; a scaffold knows how to seed each. `of: "image"` then already carries enough
meaning to produce an image picker per item and an MCP shape of `{ src, alt }`.

**2. The declaration stays serialisable.** `render` is a function and cannot cross the wire, but the
*shape name* can — which is how encodings already reach MCP. So one declaration serves the browser
editor, the MCP tool surface and the eval suite without any of them importing the component.

### What a block would add

For `image-gallery`, in its existing `image-gallery.js`:

```js
images: {
  editorType: 'array',
  label: 'Gallery Images',
  of: 'image',                    // ← the vocabulary term; already the convention elsewhere
  item: {                         // ← only where the shape is non-standard
    caption: { editorType: 'text', label: 'Caption' },
  },
  render: (v) => …                // ← already exists, unchanged
}
```

Everything else is derived: the editor shows an image picker, alt and caption per item; MCP's scaffold
returns `images: [{ src, alt, caption }]`; `thumbnailSlot` and `lightboxSlot` are suppressed because the
projection produces them.

### The probe gets better, not redundant

Today the probe guesses encodings against bare props, which is why `bodySlot` came back unresolved — no
image, nothing rendered. Given a declared authoring shape it can do something strictly stronger: **feed a
real authoring value through the declared projection and check the result renders.** That supplies the
context the probe currently lacks, so the false negatives go away, and it verifies the projection itself
rather than inferring around it.

---

## Part 5 — On "let the model cope with a bad editor"

Worth taking seriously, and I think the evidence is against it. Every model failure QA reported this week
turned out to be a contract failure, not a reasoning failure:

| Report | Actual cause |
|---|---|
| Generated images landed in the library, never on the page | `request_image` returned `{src, alt}` and no field name — the model guessed `src` on a component that has `desktopImageSlot` |
| A gallery generated three images and placed none | nested item slots described as `HTML string`, a guess, and the wrong one |
| "Some components weren't edited that it listed as edited" | `buttonSlot` vs `buttonSlots` — one letter, whole update discarded |
| Copy authored from the "Old Copy" column | the table arrived with no header structure, so no column meant anything |
| Six identical `simple-copy` blocks | 16 of 77 components never reached the model, and none carried a line about what it was for |

Each was fixed by making the contract explicit **in code** — a required argument, a measured encoding, a
resolved name — and each fix moved a measured eval rate. Nothing was fixed by asking the model to try
harder.

So a good authoring contract is not a nicety that a capable model could route around; it is the same
artifact the model needs. One bridge, two consumers. The MCP surface gets better *because* the editor does,
which is the case for doing this properly rather than papering over it on the model side.

---

## Part 6 — Sequencing

**Shipped already (2026-08-04).** `applyCapabilitiesToProperties` overlays a measured container's item
shape onto the declared properties: `image-gallery` items now offer `src` as an image field, and
`thumbnailSlot`/`lightboxSlot` are marked not editable with a reason. This is inference-only — no block
had to change — and it is a patch at the consumer, not a fix at the source.

Also shipped: the failed-probe guard (`unprobed`, and `readCapabilities` returning null for a record that
measured nothing), so none of the measurement above can be quietly wrong in the same way again.

**Next, cheap and independent.**

1. Define the item-shape vocabulary in handoff-app (`image`, `button`, `card`, `link`, `richText`), so
   `of:` means something. Roughly the size of the encoding library.
2. Teach the editor and the MCP scaffold to read `of:`/`item`. Both already read `fields`.
3. ~~Add `probeContext` to the blocks that render nothing without an array item, so the unresolved list stops
   overstating itself.~~ **Done, uncommitted in 8x8** — 11 blocks, 6 of them genuine false negatives. See the
   table in Part 1. Takes effect on the next `push:all`, since the capability record is baked at build time.

**Then, the real fix.** Have `sync-handoff-blocks.ts` emit the authoring contract rather than only the
props contract — it already special-cases `Slot`/`Slots` names, so it knows which props are slots. Where a
template pairs a slot with a source, the generated schema should say so. That fixes all 43 templates at
once instead of one block at a time.

**Open, and genuinely a judgement call.** Should the projection be shared with the *production* wrapper?
Today `ImageGalleryBlock.tsx` and `template.tsx` implement the same mapping separately, and the second is
the one Handoff can see. If a block's Handoff definition owned the projection and the site imported it,
there would be one implementation instead of three — but that puts Handoff on the site's render path,
which is a much bigger commitment than a design system registry usually makes.

---

## What to read next

- `docs/SLOT-PROBING.md` — how prop encodings are measured, and why they are measured rather than declared.
- `docs/FIELD-BRIDGE.md` — the earlier note on why declared field types were not enough.
- `docs/AGENT-TESTING.md` — the eval suite, and why the fixes above are stated as rates.
