# The bridge, by probing — editing arbitrary React components

**Status:** design, 2026-07-31. Supersedes the lens approach in `FIELD-BRIDGE.md`.

## Probed for real, 2026-07-31 — hero-background

Ran it against the live module. Seven slots, seven candidate encodings, ~60 renders.

| slot | accepts | threw on |
|---|---|---|
| `overlineSlot` | `plain-text` | 0 |
| `titleSlot` | `plain-text`, `html-string` | 0 |
| `bodySlot` | `plain-text`, `html-string` | 0 |
| `desktopImageSlot` | `image-object` | 0 |
| `mobileImageSlot` | `image-object` | 0 |
| `buttonSlots` | `array-of-urltext` | 5 |
| `breadcrumbSlot` | `plain-text` | 0 |

**Every slot editable, and every row matches what it took four wrong turns and a source dive to
establish.** `desktopImageSlot: image-object` is the exact fact that broke three times. **No encoding
anywhere accepts `serialized-element`** — the whole month's bug, found mechanically, with no knowledge of
8x8's conventions, config, or template layer.

`threw: 5` on `buttonSlots` is signal rather than noise: a slot that rejects five encodings and accepts
one is strongly typed, and worth surfacing as confidence.

### Three corrections the run forced

**1. Batching is a correctness hazard, not an optimisation.** Setting every slot at once made
`buttonSlots` report `false` for an encoding it demonstrably accepts — interference between slots, since
probing it alone returns `true`. The cost model must be *slots × candidates*, not *candidates*. Batch
only as a fast path whose positives are trusted and whose negatives are re-probed individually.

**2. Cost is ~4x my estimate.** A render is ~600ms, not the ~150ms assumed. 7 slots × 7 candidates ≈ 30s
per component, ≈ 30 minutes for a 65-component catalog. That is a build-time job, not an interactive one.
Fine, but it must be scheduled and cached per component version, never done on demand.

**3. A truncated probe must not read as a rejection.** The first run was cut off by a 30s limit partway
through a candidate; unprobed slots defaulted to `false` and produced a record claiming
`desktopImageSlot` accepts nothing — confidently wrong, in the same way as every other failure this
month. `not-probed` must be a distinct state from `rejected`, and a partial run must refuse to emit a
record.

### What this validates

The approach works, and it is the only thing tried that got the right answer without being told. It
also self-corrected: the two wrong rows in the first run were both *my* measurement bugs, and both were
visible as inconsistencies rather than silent.

## Constraints, taken as given

- Components are **arbitrary and unknown**. We do not get to require a convention.
- **Infer from types as far as possible**, then bridge the minimum that types cannot reach.
- The component is a **black box**: it renders, and that is all we may assume.
- 8x8's `template.tsx` / `previewHelpers` / description-regex layer is **one client's answer**, not a
  spec. Nothing here may depend on it.
- The bridge must be **hyper-reliable and testable**.

## Where types run out, exactly

Extracting TypeScript gives two populations, and only one of them is a problem.

**JSON-native props** — `string`, `number`, `boolean`, literal unions, objects and arrays of those. These
need **no bridge at all.** The type is the shape, the editor follows from the type, enums come with their
members, and required-ness is stated. Most props on most components are here. This is the "infer as far
as possible" half, and it is free.

**Non-JSON props** — `React.ReactNode`, `ReactElement`, `(props) => JSX`, anything holding a function or
symbol. These **cannot cross a wire**, so a codec is unavoidable. Every failure this month was in this
set, and `React.ReactNode` is deliberately unhelpful: it means "anything renderable". Perfect type
extraction still tells you nothing about what a given component does with it.

So the bridge is exactly one thing: **a codec for non-JSON props.** Nothing else needs bridging.

## The idea: stop describing the shape, measure it

Every approach tried so far *describes* the shape — a regex on the field name, a prose note, a lens
derived from a preview, a hand-written adapter. All four are somebody's claim about a black box, and all
four have been wrong.

But we can render the component. So ask it:

```
write a unique sentinel into the prop  →  render  →  look for the sentinel in the DOM
```

If the sentinel comes out, that shape is accepted. If it does not, it is not. No convention, no
declaration, no source reading.

**This is feature detection, applied to props.** The same reason browsers are probed rather than
sniffed: the sniffed answer is a guess about an implementation you do not control, and the probed answer
is a fact about the one in front of you.

### What a probe set looks like

For one slot, a handful of candidate encodings, each with a distinguishable sentinel:

| Candidate | Sentinel | Accepted when |
|---|---|---|
| plain text | `"S3NT1NEL"` | the text appears |
| HTML string | `"<b>S3NT1NEL</b>"` | a `<b>` containing it appears |
| image object | `{ src: 'https://s/S3NT1NEL.png', alt: 'x' }` | `img[src*=S3NT1NEL]` appears |
| link/button object | `{ label: 'S3NT1NEL', href: '/S3NT1NEL' }` | an `a[href*=S3NT1NEL]` appears |
| array of the above | three distinct sentinels | all three appear, in order |
| serialized element | `{ type:'img', props:{ src:… } }` | the img appears |

The result per slot is a small ordered list of accepted encodings — a **capability record**, not a shape
description:

```json
{ "desktopImageSlot": { "accepts": ["image-object", "html"], "rejects": ["serialized-element"] } }
```

That record is the entire bridge. The editor picks a widget from `accepts[0]`. The AI is told
`accepts[0]`. The placeholder is generated in `accepts[0]`. One measured fact, three consumers, no
independent guesses — which is the actual disease: today `shapeNote`, `blankValue` and `ImageField` each
decide separately what an image slot is.

### Why this is the reliable answer rather than a clever one

- **The probe is the test.** There is no separate conformance suite to keep in sync — discovery and
  verification are the same act. A component whose slot stops accepting `image-object` fails at push
  time, which is the gate that was missing all month.
- **It cannot be wrong about a component it has probed.** A description can. That is the whole
  difference.
- **It degrades honestly.** A slot where nothing is accepted is **not editable**, and we say so rather
  than rendering a form that reports success and changes nothing. Every failure this month reported
  success.
- **No author burden.** No annotations, no adapters, no naming convention. A registry pushes components
  and the bridge derives itself.
- **It is not opinionated.** `image-object` is not privileged; it is simply what some components accept.
  A component accepting only HTML strings is equally well served.

## Nested slots and containers, 2026-08-02

Top-level slots were never the whole population. Across 8x8's catalog: **142 top-level slots and 48
nested ones** — `cards[].imageSlot`, `slides[].mediaSlot`, `images[].thumbnailSlot` — in 27 components.
Real coverage was 73%, not the 84% first reported, and the missing quarter is where the body of a
generated page lives. A hero is one slot; a feature grid is six.

The extension is small: same candidates, same checks, a different injection point. Build the container
with **one** item, write the sentinel at `cards[0].imageSlot`, render, look. Sibling elements in that
item are stripped first — recursively, because `cards[].buttonSlots` is an *array* of elements and
leaving it threw React error #31 for every candidate, which reads as the target slot rejecting
everything. Paths come from the preview's values, which is sound here for the same reason it is unsound
for shapes: the item type of `cards: CardProps[]` is an interface the registry never ships, but the
preview holds an actual card with an actual element in it.

### The container is often where the real answer is

`image-gallery.images` is the case that forced the second half of this. Probing its fields reports
`thumbnailSlot` and `lightboxSlot` both unresolved — true, and useless. The component's field annotation
rebuilds each item from `src` unless the slot already holds an element, so what an author writes is
`[{ src, alt }]`. Nothing declared that: `images` is `editorType: "array"`, not a slot at all. So
containers holding slots are also probed **as a whole**, with the ordinary candidate set.

That found one true answer and five false ones, and the false ones are the dangerous kind — plausible,
measured, lossy:

| Container | Rendered | Item really is | |
|---|---|---|---|
| `image-gallery.images` | `array-of-image-object` | `{ alt, caption, thumbnailSlot, lightboxSlot }` | ✔ describes it |
| `bento-lottie-grid.cards` | `array-of-labelhref` | `{ eyebrow, heading, gridSpan, mediaSlot, … }` | ✘ discards all of it |
| `related-cards.cards` | `array-of-urltext` | `{ cardSlot }` and nothing else | ✘ describes nothing |

All six rendered their sentinel. **Rendering is the wrong question for a container**: an item has many
fields, and matching one path through the component does not make the candidate the item's shape. The
test is coverage instead — the encoding must name at least one field the preview item actually carries,
bookkeeping keys excluded. That admits the gallery and rejects the other five, and an unrecorded
container keeps its value-derived description, which is imperfect but honest.

An unresolved container is never recorded at all, for the same reason: a `cards` array whose `cardSlot`
takes only an element still has title and body fields an author edits every day, and marking the prop
uneditable would take those with it.

### Where it landed

190 slots probed across 54 components, 147 resolved. 30 of 48 nested slots now have a measured
encoding; the 18 that do not are almost all `cardSlot` — an item that *is* a card element, with no
authorable shape to find. Cost is 12s for the whole catalog.

## What probing cannot do, and what covers it

| Question | Answered by |
|---|---|
| What shape does this slot accept? | **the probe** |
| What values are legal? (enums, ranges) | TypeScript |
| Is it required? | TypeScript |
| Which editor widget? | derived from the accepted encoding |
| What does this slot *mean*? ("keep the subject clear of overlaid copy") | author prose — for humans and the LLM, never structural |

Note the last row is where 8x8's dimension-regex belongs: real information, useful to a model, correctly
kept out of the shape question.

### When the probe fails, 2026-08-04

A capability record has to distinguish three states, and for a while it only expressed two:

| State | Record |
|---|---|
| Measured, everything accepted something | `slots` populated, `unresolved: []` |
| Measured, some slot accepts nothing | `slots` populated, `unresolved: [names]` |
| **Could not measure at all** | `error`, plus **`unprobed: [targets]`** |

Before the third row existed, a probe that bailed — no jsdom, a bundle that would not load, no `render()`
export — emitted `slots: {}` and `unresolved: []`. That is byte-identical to a component whose every slot
measured clean, so **a total failure reported green.**

It cost a real wrong conclusion. `product-comparison` is the one bundle of 68 in 8x8's catalog that leaves
`react` as an external import, so it cannot load from a temp directory outside the build. A measurement run
reported it as having zero unresolved slots, and that empty list was believed over the component's own baked
record, which disagreed. The probe had measured nothing whatsoever.

Two rules follow, both now enforced in code and covered by tests that were confirmed to fail without them:

1. **A bail names its targets.** `unprobed` lists what would have been measured, so the failure is visible
   in the artifact and scaled — "6 slot(s) unmeasured" rather than a shrug.
2. **A failed probe is not a record.** `readCapabilities` returns `null` for an errored record with no
   slots, putting it on the same footing as a component that predates probing — which is what it is. The
   fallback is declared shapes, not marking every slot uneditable. An errored record that *did* measure some
   slots keeps them: partial evidence is not zero evidence.

The general form is worth stating, because it is not specific to probing: **an absence of findings and an
absence of measurement are different claims, and only one of them is evidence.** A check that cannot fail
reports green for behaviour nobody measured — see `docs/AGENT-TESTING.md` on vacuous eval passes, which is
the same mistake in the test suite rather than the artifact.

## Cost, honestly

Naively it is slots × candidates renders. Batched it is far less: set **every** slot to the same
candidate encoding with distinct sentinels and render once, so cost is *candidates* per component, not
per slot. Six to eight renders per component; roughly 500 for 8x8's 65 components. Feasible today —
rendering an arbitrary component from its `-client.mjs` in a browser is already proven.

Runs once per component version, at push or first probe, cached beside `properties`. A component whose
bundle has not changed is not re-probed.

## Risks worth naming before building

- **A false positive from an echo.** A sentinel could appear because the component dumps unknown props
  into an attribute rather than rendering the slot. Mitigated by asserting *where* it appears — an image
  probe must produce an `img[src]`, not merely the string somewhere.
- **A slot needing sibling props to render at all.** A tab panel may render nothing until `activeTab` is
  set. Probing sees "rejects everything" and marks it not-editable — wrong, but wrong in the safe
  direction, and detectable because the whole component renders empty.
- **Order-dependent acceptance.** `renderPreviewImageSlot` shows real components taking *either* a slot
  *or* a data field. Probing finds both and must record a preference; `accepts` is ordered for that
  reason.
- **Probing needs a browser.** A real dependency. The alternative is guessing, which we have now costed.

## Relationship to what exists

- **Deletes `shapeNote`.** Its whole job is describing shapes it cannot know.
- **Makes per-client adapters unnecessary.** Probing would discover that `hero-background` accepts
  `images.desktop` *and* `desktopImageSlot: {src,alt}` without reading a line of 8x8's config. They would
  not need to have written it.
- **Keeps the type extractor**, for the JSON-native population and for enums — the part that genuinely
  is inference.
- **Retires the lens work.** `field-lens.ts` derives locations from preview values; preview values are
  neither the contract nor reliable. Probing asks the component instead.
