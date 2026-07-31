# The field bridge — editing arbitrary React components reliably

**Status:** design note, 2026-07-31. Written after the third production bug from one cause.

## Scope: React registries only

**This is a React problem.** Handlebars components take plain serializable JSON as their template
context, so the value's shape *is* the declared shape — there is no element-tree indirection to infer
through and nothing for a lens to locate. Cynosure and SSC are Handlebars and need none of this.

8x8 is React, which is where a prop typed `React.ReactNode` becomes a serialized element tree at
runtime and the declared shape stops describing where the data lives. Everything below is about that.

## The bug class, stated once

Three failures this month, all the same shape:

| Symptom | Declared | Actual |
|---|---|---|
| `<p>` tags visible in copy | `slot` → "HTML string" | bare text |
| Empty buttons; `items.map is not a function` | `array` → "array of button" | a single React element |
| Image generated, "Applied", page unchanged | `image` → `{ src, alt }` | `{ type: 'img', props: { src } }` |

Each was fixed at its call site. The cause was never fixed, so it came back twice.

## CORRECTION, 2026-07-31 — the premise was backwards

Everything below the measurement was written before the round-trip was actually run. Running it inverted
the conclusion, so read this first.

**Test:** load `/api/component/hero-background-client.mjs` in a browser, render with the slot set four
ways, inspect the DOM.

| `desktopImageSlot` value | Result |
|---|---|
| `{ src, alt }` — the **declared** shape | ✅ renders the src |
| `{ ...element, src, alt }` | ✅ renders the src (top-level wins) |
| element with `props.src` — the **derived lens** | ❌ **silently ignored**; component falls back to its own default image |
| the stored preview value, verbatim | ❌ **throws** `(e \|\| []).filter is not a function` |

Same pattern on the other slots: `buttonSlots` must be a plain `[{ url, text }]` array — the component
calls `.filter` on it, and the stored element form crashes the render. `overlineSlot` as a plain string
renders; as an element it renders nothing at all.

**So the declared contract is right, and the stored preview values are wrong.** They are serialized
*render output*, not input props. Feeding them back either crashes the component or is discarded.

This reverses the central claim below. The bridge is not a bad label over good data; it is a **correct
label over contaminated seed data.** `scaffoldArgsForComponent` seeds `args` from preview values,
`summarizeFields` describes shapes from them, and the lens derives write paths from them — all three
learn from output and therefore teach the wrong shape.

It also explains the symptom that started this: an image "in the assets but not on the page". The
element form is not dropped, it is *replaced* by the component's default — so the page shows a
plausible wrong image rather than an obvious gap.

**Two things were wrong in the repo as a result, now fixed:**
- `d7101ef2` made `blankValue`/`coerceToShape` preserve the element and write `props.src`. That is the
  ignored form. Reverted: an output-shaped element is normalised to plain `{ src, alt, width, height }`,
  keeping only the dimensions worth lifting out of it.
- **The 176 finding is real but its cause is inverted.** The audit correctly detects 176 disagreements
  between declared contract and stored preview; the fix is not 50 lenses, it is repairing how previews
  are captured. Treat `breaks-write` as "this preview cannot be fed back", not "this descriptor is
  wrong". The verdict names should be changed accordingly — not done yet.

**What survives:** the invariant. `scaffold → render → assert` is the right test and is now known to
work in a browser against a real module. It should run over the catalog, and it would have caught all of
this at the source rather than after three fix attempts in the wrong direction.

Keep reading below for the original argument, but treat its direction as superseded.

## Read the 8x8 source, 2026-07-31 — there are FOUR contracts and no owner

The workspace is checked out at `~/Documents/Clients/8x8/8x8-website`. Reading it replaces the inference
below. The short version: **nothing is contaminated. There are four independent descriptions of the same
prop, written in four places, and no single owner.**

### 1. The type contract — `handoff/components/blocks/hero-background/schema.ts`

Generated from TypeScript. Every `*Slot` is:

```json
"desktopImageSlot": { "type": "React.ReactNode", "kind": "slot",
  "description": "Desktop background image slot. Recommended: 2560 x 1400 … about 64:35 …" }
```

**Not `image`. Not `array`. No mention of `{ src, alt }`.** True, and almost useless — exactly the
"ReactNode tells you nothing" point, now confirmed from the source rather than argued.

### 2. The intent hints — `handoff/handoff.config.js` (8x8's own)

```js
const MEDIA_FIELD_PATTERN = /\b(image|media|video|poster|avatar|thumbnail|background|logo|lottie)\b/i;
const extractDimensionRule = (description = "") => { … DIMENSION_PATTERN … }
```

**This is where `editorType: 'image'` comes from** — a regex on the field name, plus dimension rules
parsed out of English prose in the description. This is the "little bridge" and it is a *hint* layer:
which editor to show, what dimensions to recommend. Legitimate for intent. It is not, and cannot be, a
statement about data shape.

### 3. The real JSON contract — `blocks/*/template.tsx` (8x8's own, invisible to us)

```tsx
type HeroBackgroundPreviewFields = {
  title?, paragraph?, body?, overline?,
  buttons?: PreviewButton[], breadcrumb?: PreviewBreadcrumb[],
  images?: { desktop?: PreviewImage; mobile?: PreviewImage },
};

desktopImageSlot={renderPreviewImageSlot(block.desktopImageSlot, block.images?.desktop)}
buttonSlots={renderPreviewButtonSlots(block.buttonSlots, block.buttons)}
```

and in `previewHelpers.tsx`:

```js
function renderPreviewImageSlot(slot, image, className = "h-full w-full object-cover") {
  if (slot) return slot;                                    // ReactNode: passed straight through
  if (!image?.src) return undefined;
  return <img src={image.src} alt={image.alt ?? ""} className={className} />;
}
```

**Two designed input paths per slot**, and the JSON-friendly one uses *different field names*:
`images.desktop`, `buttons`, `title`, `overline`, `paragraph`, `breadcrumb`. `PreviewImage` is
`{ src, alt, url, href, target }`; `PreviewButton` is `{ label|text, variant|type, url|href, target }`.

**handoff-app has never captured any of this.** Only 12 of 59 blocks have it, so it is a live migration,
not a finished convention.

### 4. handoff-app's `shapeNote` — `'{ src, alt, width?, height? }'`

A guess at (3), derived from (2), for a prop whose real type is (1). It happens to be close to
`PreviewImage` — which is why it *seemed* right — but it is asserted against the `*Slot` name, i.e.
path 1's field with path 2's shape.

### The serialization story, corrected

8x8 wrote `reviveSerializedReactNode` in `handoff.config.js` and injects it via
`hooks.clientBuildConfig`. It walks a serialized tree and rebuilds it with `React.createElement`,
mapping a non-string `type` to `React.Fragment`.

**So serialized elements in previews are not contamination — they are the intended wire format**, with a
reviver meant to restore them. The previous section's "shallow-rendered contamination" reading is wrong.

But the reviver is **absent from both the local build and the deployed bundle** (`grep -c
reviveSerializedReactNode` = 0 on each). It is not a stale-build problem: the bundle is newer than the
config, the reviver dates from May, and the replace target does match the generator's emitted string
(verified by extracting the template literal and testing `.includes`).

The remaining explanation is that the reviver is injected into the **SSR/hydration** entry
(`plugins/ssr-render.js`, which ends in `hydrateRoot(...)`), while the playground imports a **different**
entry exporting `render`/`update` (`preview/component/api.js`) that has no revive step. **Not fully
confirmed** — worth ten more minutes before anyone acts on it.

### Measured behaviour, for reference

Rendering the live module (`/api/component/hero-background-client.mjs`):

| Input | Result |
|---|---|
| data fields — `images.desktop`, `buttons`, `title`, `overline` | ✅ richest output: 2 styled buttons, both images, all copy |
| `*Slot` fields as plain data (`{src,alt}`, `[{url,text}]`, HTML string) | ✅ renders, but plainer buttons |
| `*Slot` fields as serialized elements | ❌ ignored; component falls back to its own default image |
| stored preview values verbatim | ❌ throws `(e \|\| []).filter is not a function` |

### What follows

**Do not build lenses over preview values.** That was solving the wrong problem — twice over, since
previews are neither ground truth nor contamination, but a format awaiting a reviver that is not running.

Two real options, in preference order:

1. **Capture contract (3).** `template.tsx`'s preview-field type is the authoring contract, already
   written per component, and it renders best. It is plain JSON with no revive needed, which suits both
   the AI and a form editor. The gap is that handoff-app never reads it — a TS type in the workspace that
   nothing extracts. This also makes the `*Slot` props irrelevant to authoring, which is the right
   outcome.
2. **Fix the revive path**, so serialized elements work on the playground entry as 8x8 intended. Keeps
   the existing preview data meaningful, but keeps authoring in terms of React trees — harder for both a
   model and a form.

Either way the immediate defensive move stands: **`shapeNote` should stop asserting `{ src, alt }` for a
`React.ReactNode` slot.** It is a guess, it is right by luck, and it is the thing that has now produced
four wrong turns.

## Root cause, 2026-07-31 — previews contain shallow-rendered components

Traced the write path. `previews` reaches the DB **verbatim** from the CLI push (`sync-queries.ts`
takes `d.previews` with no transformation), and is read out of the component's declaration as
`{ title, values }` (`component-build-worker.ts`). So the shape is whatever the workspace produced.

**What is in there.** `stats.stats[].buttonSlot` and `hero-background.buttonSlots.children[0]` are
byte-identical:

```
type: 'a'
className: 'inline-flex font-bold transition-all duration-300 text-[19px] … bg-primary-dark-gray …'
style: { color: '#ffffff', backgroundColor: '#1f1f21' }
```

Two things make this conclusive. The same forty-class string appears in two unrelated components, and
the inline `style` holds **resolved token hex** — `#1f1f21` is a design token *after* resolution. Neither
is something an author types into a preview declaration. That is one shared `Button` component that was
**rendered**, and its output serialized.

`type: 'a'` plus `_owner`/`_store` means a real React element from a dev build whose type is a DOM tag —
so the component function was *invoked* and its return value captured, one level deep. Not
`renderToStaticMarkup` (that yields an HTML string) and not JSX serialized as authored (that would drop
`type`, since a component function is not JSON-serializable).

**What survives intact:** plain scalars. `stats.stats[].bodySlot` is lorem text, `hero-background.overlineSlot`
is `'Omnichannel routing'`. Both are correct and usable.

So the rule is: **a preview value is trustworthy when it is plain data and worthless when it is a
resolved element.** Contamination follows the *value*, not the component — hero-background has both in
one preview — which is why "derive shapes from real preview values" fixed some bugs and caused others.

### What this means for the three consumers

All three learn from previews, so all three need the same guard: **if a preview value is a serialized
React element, ignore it and fall back to the declared contract.**

- `scaffoldArgsForComponent` — seeds `args` from previews. Should use `placeholderValue(meta)` instead
  when the preview value is an element.
- `summarizeFields` — describes shapes to the model from previews. Should describe from the declared
  shape when the preview value is an element. Currently it teaches the model to author elements.
- `blankContentValues` / `coerceToShape` — fixed for images in `f22a4318`; the same normalisation should
  be general rather than one editor type.

`isReactElementish` already exists and is the whole test.

### Still unknown

*Why* the workspace resolves components one level before serializing. That code is in 8x8's own repo,
which is not checked out here — `data-preview-label` (an attribute on their preview image) appears
nowhere in any Handoff repo, so it is theirs. Worth finding, because fixing it at source makes every
consumer's guard unnecessary. Look for whatever builds the `.handoff.ts` preview `values` and why a
`<Button>` becomes an `<a>` on the way in.

**Until then the guard is the right move, not a preview re-capture:** the guard is a few lines in code we
own, works for every registry, and does not need 8x8 to change anything.

## Measured, 2026-07-31 (8x8)

`GET /api/admin/field-bridge-audit`, 65 components, 218 previews, 1878 field checks:

| Verdict | Count | Share |
|---|---|---|
| `ok` | 995 | 53% |
| `no-preview` | 645 | 34% |
| **`breaks-write`** | **176** | **9%** |
| `misleads-author` | 62 | 3% |

**Every `breaks-write` is a `*Slot` field.** The thirteen names reported sum to exactly 176; not one
field outside that convention breaks:

- **Buttons — 88 (50%)**: `buttonSlots` 56, `footerButtonSlot` 17, `buttonSlot` 11, `ctaSlot` 3,
  `productInfoButtonsSlot` 1
- **Images — 65 (37%)**: `imageSlot` 23, `mediaSlot` 10, `mobileImageSlot` 9, `desktopImageSlot` 9,
  `backgroundImageSlot` 7, `logoSlot` 4, `metaImageSlot` 3
- **Text — 23 (13%)**: `overlineSlot` 23

`*Slot` is this design system's convention for a prop typed `React.ReactNode`. So the hypothesis above
is confirmed by measurement rather than argument: **the bridge holds wherever the type is concrete and
fails exactly where the type says "anything renderable".** That is the whole of it — one cause, not
thirteen, and no non-slot field needs touching.

Counts are per (component, preview, field), and components average 3.4 previews, so 176 findings is
roughly **50 distinct component-field pairs** — bounded work, not a rewrite.

`buttonSlots` at 56 is the single largest item. It was parked earlier as a curiosity about inconsistent
shapes across components; it is in fact the biggest instance of the bug class.

**`no-preview` at 645 is a different problem.** A third of declared fields are exercised by no preview
at all, so their shape is unverifiable by any means — not a bridge defect, a coverage gap, and fixed by
authoring previews rather than by code. Worth tracking separately; it is also the ceiling on how much
the conformance check can ever prove.

## Why the bridge cannot currently be right

`shapeNote` in `lib/mcp/scaffold-helpers.ts` is the bridge:

```ts
case 'image': return '{ src, alt, width?, height? }';
```

A hardcoded table from a declared `editorType` to a **prose string**, asserted for every component in
every registry, with no reference to what the component renders. It is not that this is wrong and could
be corrected — **one `editorType` maps to many real shapes**, so no table can be right. `image` is
`{ src, alt }` in one component and a serialized `img` element in the next. `buttonSlots` is
`{ url, text }` here and `{ label, href }` there. The mapping does not exist to be looked up.

**The deeper problem: a label describes, but the UI needs a location.** `'{ src, alt }'` tells you the
shape and not where to write. Knowing "this is an image" did not stop us writing to `slot.src` when the
renderer reads `slot.props.src`. And a prose label cannot be tested — there is no assertion you can
write against the string `'{ src, alt, width?, height? }'`.

So: **the bridge should be a lens, not a label.**

## Three sources, each authoritative for exactly one question

The failure is not a missing source of truth. It is one source answering a question it cannot.

| Source | Authoritative for | Cannot answer |
|---|---|---|
| **Observed value** (preview render) | *Where the data lives* — the lens | What is allowed; what is required; intent |
| **TypeScript type** | *What is allowed* — enum members, optionality, required | Runtime shape, once a prop is `React.ReactNode` |
| **Author annotation** | *Intent* — which editor, label, help, grouping, dimension rules | Anything structural |

Today annotation answers the structural question. That is the whole bug class.

**Types alone cannot close this**, which is worth being clear about because it is the intuitive fix.
`desktopImageSlot: React.ReactNode` is a perfectly honest type meaning "anything renderable" — a string,
an element, an array of them. Full type inference would tell us exactly that, which is exactly nothing.
The runtime value is the only thing that knows a given component renders an `img` there. Type extraction
is worth doing for enums and required-ness; it will never answer "where does the src go".

## The lens

Replace the prose shape with a structural descriptor that says where each editable leaf lives:

```ts
// hero-background.desktopImageSlot
{ kind: 'element', tag: 'img', paths: { src: ['props', 'src'], alt: ['props', 'alt'] } }

// some-card.image
{ kind: 'object', paths: { src: ['src'], alt: ['alt'] } }

// a richtext slot
{ kind: 'html', paths: { html: ['props', 'dangerouslySetInnerHTML', '__html'] } }
```

Derived from the observed value, not declared. `findImageNode`/`setElementImage` in
`merge-block-values.ts` are the first instance of this written by hand for one case; the generalisation
is to compute the paths once, per component, and have every writer use them — the AI merge, the block
editor's `ImageField`, the placeholder swap. Three writers currently each rediscover the shape, which is
why one of them can be right while another is wrong on the same field.

## The invariant that makes it testable

This is the part that matters for arbitrary components, and it needs no understanding of the component:

```
write(lens, args, SENTINEL) → render → SENTINEL appears in the output
```

Round-trip through the actual renderer. If a write through the declared lens is not observable in the
render, the lens is wrong — and you know at build time rather than when a user's hero comes out blank.

Run it as a property over the whole catalog: **every component × every preview × every editable slot.**
It is a few hundred cheap assertions, it would have caught all three bugs above, and it keeps catching
them as components change — which is the actual risk, since a component author who restructures a slot
has no idea a field descriptor somewhere describes it.

This also gives a real answer to "is this component editable?" — a question we currently answer by
assumption. A component whose slots round-trip is editable. One whose slots do not is not, and we should
say so.

## The honesty rule

When no lens can be derived — no preview, or the round-trip fails — **show a raw JSON editor with a
warning, not a pretty form.** A form that writes to the wrong path is worse than an ugly one that
writes to the right path, because it reports success. Every failure in the table above looked like it
worked; two of them printed "Applied".

## Where this leaves the paused typed-React initiative

The fields-annotation layer (`project-typed-react-preview-builder`) is the right thing built against the
wrong contract. Keep it for what annotation is good at — which editor to show, labels, help text,
grouping, validation rules — and **stop it being the shape authority.** Its output becomes an input to
the lens, not a substitute for it, and it gets validated by the same round-trip.

That also makes it safe to roll out, which is arguably why it stalled: nobody could tell whether turning
it on would break rendering, because nothing checked.

## Order to build it

1. **The conformance test.** Derive lenses from previews, check every slot, report the catalog's
   failures. Ships no behaviour change and tells us how big the problem actually is — a number we do
   not currently have.
2. **One lens module**, replacing the three hand-rolled shape guesses (AI merge, block editor,
   placeholder swap) with shared accessors.
3. **Type extraction** for enums and required-ness, which the observed value genuinely cannot give.
4. **Annotation layer** on top, for intent, validated by (1).

Step 1 is the one that changes the conversation from "we think the bridge is right" to a number.
