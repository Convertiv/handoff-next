# Probing in practice — rollout, remediation, and a new registry

**Status:** design, 2026-07-31. Companion to `SLOT-PROBING.md`, which argues the approach; this is what
you actually do with it.

## Where it runs: the workspace build, not the registry

The workspace already builds `-client.mjs` for every component. Probing belongs immediately after that,
in the CLI, for three reasons: the artifact is already in hand, the author gets the answer while they are
still looking at the component, and the capability record can be pushed alongside `properties` so it
travels with the thing it describes.

Probing in the registry after push means the answer arrives too late to stop a bad push, and probing on
demand in the app means paying for it forever.

**The browser dependency is gone. Tested 2026-07-31.**

jsdom in Node renders `hero-background-client.mjs` and produces the **same capability record** as the
browser:

```
import           39ms   (browser: 532ms)
per render      4.3ms   (browser: ~600ms)
full probe       211ms  for 7 slots x 7 candidates = 49 renders
whole catalog   ~14s    extrapolated across 65 components
```

Not merely equal — **more complete.** jsdom found `buttonSlots` accepts both `array-of-link` and
`array-of-urltext`; the browser run reported only the latter, because that candidate had gone through the
batched path and hit the interference described below. Probing per-slot throughout, which is only
affordable because it is this cheap, gives the fuller answer.

Every finding reproduced exactly: `image-object` renders, `serialized-element` is silently ignored in
favour of the component's own default, a non-array `buttonSlots` throws
`(e || []).filter is not a function`.

**So this is part of `handoff build`, not a scheduled job.** Fourteen seconds for a whole catalog needs
no caching strategy, no queue, and no headless browser in CI.

### The probe harness

jsdom needs a small fixed set of stubs before the module loads. This *is* the harness, and it is worth
keeping short and explicit:

`window` `document` `navigator` `HTMLElement` `Element` `Node` `Text` `DocumentFragment`
`getComputedStyle` `CustomEvent` `Event` `MutationObserver` `SVGElement` `Image` `DOMParser` `self`,
plus `requestAnimationFrame`/`cancelAnimationFrame`, no-op `IntersectionObserver` and `ResizeObserver`,
a `matchMedia` returning `matches: false`, and `scrollTo`.

**`matchMedia` is the one with teeth.** CSS-driven responsive layout is safe — the desktop image sits
inside `hidden lg:block` and is still in the DOM — but a component that *branches in JavaScript* on a
media query could hide a slot from the probe under a fixed synthetic viewport. That is the
"fails safe but wrong" case, now concrete and worth a second probe pass at a different simulated width
if it ever shows up.

## Whole-catalog probe, 2026-07-31 (8x8)

50 components, 135 slots, **5.8 seconds** in jsdom.

| | |
|---|---|
| slots resolved | **115 (85%)** |
| slots with empty `accepts` | 20 (15%) |
| components fully resolved | **36 of 50** |
| slots accepting `serialized-element` | **0 of 135** |
| components skipped (schema parser) | 13 |

**Zero slots in the entire catalog accept a serialized React element.** The month's bug, confirmed
catalog-wide rather than on one component, and the strongest possible argument for step 3 of the
remediation: previews are seeded with a form nothing accepts.

### The harness was two-thirds of the "unprobeable"

The first run reported **58 empty slots (42%)**. Almost all of it was my own base-prop generation: every
non-slot prop was stubbed as `'x'`, so a component with `questions: FaqQuestion[]` crashed on `.map`
before any slot could render, and 21 slots across 14 components looked unprobeable when the component had
simply never rendered.

Deriving base props from the declared type instead — `kind: 'array'` → `[]`, `kind: 'object'` → `{}`,
literal unions → the first literal — dropped it to **20 (15%)**.

That is the "infer as far as possible" principle earning its place: the JSON-native props are exactly
what makes probing the non-JSON ones possible, and getting them wrong reads as a component limitation
rather than a harness bug.

### What the remaining 20 actually are

- **16 — rendered fine, slot never appeared.** The genuine escape-hatch population: `bodySlot` on
  carousels and tabbed components, `tocSlot`/`mobileTocSlot`, `hero-featured.audioSlot`/`shareSlot`.
  These want a probe context (`{ activeTab: 0 }`) or a candidate encoding not yet tried.
- **2 — component still will not render** (`job-table`, `product-feature-index`). Needs a richer base
  prop than an empty array.
- **2 — mixed** (`auto-tag-cards.footerButtonSlot`, `card-rows.buttonSlot`): threw on 5 of 9, accepted
  none. Button slots wanting a shape not in the set.

So the real declarative surface for 8x8 is **~20 slots in 14 components — 15%**, and the report names
every one. Compare the alternative already attempted there: a hand-written `template.tsx` per component,
of which 12 of 59 got done.

### One correction to the design: order candidates by specificity

Acceptance counts across the catalog:

```
plain-text 80 · array-of-text 77 · html-string 33 · image-object 16
array-of-link 15 · array-of-urltext 14 · link-object 8 · serialized-element 0
```

`plain-text` and `array-of-text` are near-universal because a `ReactNode` slot renders a string, and an
array of strings, almost by definition. They are true and nearly information-free.

**So `accepts[0]` must be the most *specific* accepted encoding, not the first probed.** Rank structured
encodings (image-object, link-object, array-of-*) above `html-string` above `plain-text`. Without that
ordering every slot types as "text" and the image and button distinctions — the ones that matter — are
lost.

### Two findings about running probes at all

**React 18 render errors are asynchronous and escape a synchronous `try/catch`.** They arrive as an
uncaught exception and, untrapped, kill the run mid-catalog. A probe harness must trap at the process
level and attribute the error to whichever candidate is in flight. This is not incidental: "did it
throw" is half the signal.

**jsdom's virtual console writes React errors to stderr regardless.** Noisy, and easy to mistake for a
crashed run — the first version of this looked dead and had in fact completed.

## Where candidates come from

A fixed list of encodings is a small opinion, and we can mostly avoid having one. Three sources, in
order:

1. **The TypeScript type**, when it is concrete. A prop typed `{ src: string; alt?: string }` yields
   exactly that candidate. No guessing, and it covers the JSON-native population outright.
2. **Existing preview values.** Previews are useless as a *contract* — that is the whole lesson — but
   they are an excellent *candidate generator*. A preview holding `{ url, text }` proposes that shape;
   the probe then decides whether it is true. This is how you learn `{url,text}` versus `{label,href}`
   without hardcoding both, and it is why the day's contaminated data still has value.
3. **A universal fallback set** for `ReactNode` with no better source: text, HTML string, image object,
   link object, arrays of each, serialized element.

Only (3) is opinionated, it is small, and it shrinks as (1) and (2) improve.

## Validating as far as possible

Four layers, cheapest first.

**1. The probe itself.** Self-validating: a capability record only ever contains encodings observed to
render. `not-probed` stays distinct from `rejected`, and a partial run emits no record.

**2. Exact round-trip, not presence.** Assert the value comes back *identical* — `img.src` equals what
was written, not merely contains the sentinel. Catches a component that mangles, truncates or
re-encodes, which "the sentinel appeared somewhere" would pass.

**3. Coverage.** Every declared prop must land in one of three buckets: JSON-native (no probe needed),
has a capability record, or **unknown**. Unknown is reported, never silently treated as fine. The count
of unknowns is the honest measure of how much of a catalog is actually editable, and it is the number to
drive to zero.

**4. Change detection.** Capability records are stored per component version. A push whose capabilities
*changed* is a breaking change for content already saved against the old ones — the component author
almost never knows this, and today nothing tells them. This is the highest-value output of the whole
exercise and it falls out for free.

## Remediating the rest of 8x8

Sequenced so each step is useful alone and nothing is destructive:

1. **Probe all 65** → capability records. Read-only, changes nothing.
2. **Diff against what the app currently believes** (`editorType` + `shapeNote`). Produces the real
   version of the "176 findings" number, this time meaning something.
3. **Stop scaffolding from preview values.** `scaffoldArgsForComponent` should build from `accepts[0]`
   plus a placeholder. Previews stay as sample *content*, used only where the value is already in an
   accepted encoding. This alone fixes the generated-page problems without touching a single component.
4. **Audit stored content.** Check every saved pattern's block args against the capability records. That
   finds the pages rendering a wrong image today, rather than waiting for someone to notice.
5. **Mechanically migrate what can be.** A stored serialized element containing an `img` converts to
   `{ src, alt }` safely, *because the record says that is the accepted encoding.* Migration is only
   safe once you know the target, which is precisely what has been missing.
6. **Delete `shapeNote`.**

Steps 1–2 are read-only. Step 3 is the behaviour change and the one worth deploying on its own.

## Standing it up on a new registry (Resolvet)

The point is that there is almost nothing to do.

1. Push components as normal. No annotations, no `template.tsx` adapters, no naming convention.
2. The build probes each component and reports: *"58 of 61 components fully editable; 3 slots unknown."*
3. **Only the unknowns need a human**, and the report says exactly which.

An unknown has two causes, and they want different answers:

- **A missing candidate encoding** — the component takes a shape nobody has tried. Add it to the probe
  set; it then benefits every registry.
- **A slot that will not render without sibling props** — a tab panel dead until `activeTab` is set. This
  is where the minimal declarative escape hatch lives: a per-component **probe context**, e.g.
  `{ activeTab: 0 }`, so the probe can reach the slot.

That is the whole declarative surface, and it matters that it is **earned rather than default**. You
write it only where probing failed, probing tells you exactly where, and the amount of it is a measured
number that can be driven down. Compare 8x8, where a `template.tsx` was hand-written for every component
whether it needed one or not — and only 12 of 59 got done.

## What I would verify before building any of it

1. ~~jsdom renders these modules.~~ **Done — it does, at 4.3ms per render.**
2. **A component that needs context to render.** The failure mode flagged as "fails safe but wrong". 8x8
   has tabs and accordions; find one and see whether the probe reports it honestly.
3. **One non-8x8 React component**, ideally Resolvet's, to confirm nothing here quietly depends on 8x8's
   conventions. The whole claim is that it does not.
