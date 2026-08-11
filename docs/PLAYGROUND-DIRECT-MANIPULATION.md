# Design — direct manipulation in the playground (inline editing, visual choices, traced fields)

**Status:** proposed, 2026-08-05. Complements `PLAYGROUND-EDITING.md` (which covers *AI-proposed* edit
operations against the canvas); this note covers the **human** editing surface — the left-rail form and
what could replace or augment it. Companion roadmap phase: **Part 2 / Phase F**.

> ⚠️ **Superseded on one central point (2026-08-10).** This note unifies both engines behind sentinel tracing.
> The roadmap now splits them: **Handlebars uses its existing `{{#field}}` wrapper** (deterministic, and the
> templates already carry it — the only blocker is that the *playground's* copy of the helper is stubbed to a
> pass-through at `Preview.tsx:16`), and **sentinel tracing is for React**, where no cooperation is possible.
> Handlebars goes first. Everything below about *how* to edit — the in-frame overlay, never `contenteditable` on
> the component's node, args in and geometry out — still stands and is engine-independent; what changed is where
> the marks come from. See **Phase F, "two engines, two mechanisms"** in
> `WORKBENCH-PLAYGROUND-ROADMAP.md`. The "two prerequisites" section below is also now **both cleared**: capture
> is repaired at the sync boundary (86 → 0 unfeedable on 8x8), and the stubbed helper became F.1 rather than a
> reason to sidestep it.

## The problem

The field editor works and is not good. Three distinct complaints, worth separating because they have
different fixes:

1. **Form order and shape.** Fields render in whatever order the schema hands them over, frequently with
   no help text. Editing is possible, never pleasant.
2. **Fields whose meaning is opaque.** Text and image props read fine. The block-builder parameters do
   not: `light`/`dark`, theme, `left`/`right`, overlay toggles. A label cannot explain these as well as
   seeing them.
3. **Visual roughness.** Field styling and layout.

(3) is a straightforward design pass. (1) and (2) are the interesting ones, and (2) is the one that a
better-looking form does not fix.

**The hard constraint, which is non-negotiable and correct:** components are arbitrary React or
Handlebars that authors would ship in production. No Handoff-specific authoring sauce may be required.
Anything in this note that needs component-side cooperation is disqualified unless it is *optional*
enrichment on top of a path that works with zero cooperation.

## The reframe: mark the values, don't read the DOM

The instinct is to detect props in the rendered DOM and attach editors to them. On arbitrary code that is
intractable — it amounts to reverse-engineering the component's render.

Invert it. **Mark the values before render, then find the marks afterwards.** The component's own render
becomes the oracle for where a prop lands. No parsing, no heuristics, no author cooperation.

This is not a new idea in this codebase — it is what
[`slot-probe.ts`](../src/transformers/plugins/slot-probe.ts) already does to *measure what a slot accepts*.
The extension is to also record **where the sentinel landed in the DOM**.

| Prop kind | Marking technique | Recovered from DOM |
|---|---|---|
| text, richtext | wrap value in zero-width sentinels (`⁢<id>⁢` … ) | exact text node + character offset |
| image, video, link/href | sentinel as a URL query param (`?__hf=hero.image`) | `[src*="__hf="]` / `[href*="__hf="]` — element + attribute |
| enum, boolean, number | **do not trace** | — |

Zero-width marks do not shift layout. A query param survives into `src`/`href`, is inert, and is trivially
findable. Enums and booleans are excluded because a sentinel there corrupts a class name or flips a switch
branch.

**That exclusion is the load-bearing insight of this design, not a limitation of it.** Tracing succeeds on
exactly the props where inline editing is valuable, and fails on exactly the props where inline editing is
meaningless. Nobody wants to inline-edit `theme="dark"` — they want to *see* the two options. So the target
is a **hybrid surface**:

- **Content** (text, images, links) → edited inline on the canvas, where it is rendered.
- **Configuration** (enums, booleans, structure) → edited in chrome, as *rendered choices* rather than
  labelled inputs.

The failure mode of "move the whole form onto the canvas" is that configuration props have no sensible
inline representation, and they are precisely complaint (2).

## Coverage, honestly

Expect **60–80% of text and image props** on real components. Known losses:

| Loses the trace | Why |
|---|---|
| `React.memo` / cached subtrees | value may not re-flow on the instrumented pass |
| canvas / SVG-rendered text | no text node to anchor to |
| i18n, formatters, `slice`/`truncate`/`toUpperCase` | sentinel mangled or stripped mid-pipeline |
| values used as keys, ids, or class fragments | excluded by policy (see above) |
| `fields[].render` returning arbitrary nodes | §12a of `COMPONENT_PREVIEW_SCHEMA.md` guarantees shape freedom — cannot assume where a value lands |

**Therefore the design rule: every consumer of the trace must degrade to nothing, never to broken.** A
missing trace means "no highlight, no inline affordance, use the form field" — not a dead editor. This is
what makes it safe to ship a tracer with 70% coverage, and it is why the first consumer should be
hover-linking (harmless when absent) rather than editing (harmful when wrong).

## Implementation rules

**1. Never `contenteditable` the component's own node.** React reconciliation will discard the edit, and
[`RichTextField.tsx:6-24`](../src/app/components/Playground/fields/RichTextField.tsx) already documents the
caret-loss pain of imperative `innerHTML`. Instead:

> Absolutely-positioned overlay input over the traced node's `getBoundingClientRect()`, with typography
> copied from `getComputedStyle`. Edit in the overlay. On commit → write args → normal `update-props`.

The component tree is never mutated by the editor. One consequence worth stating: this *editing* path is
**identical for React and Handlebars**, because it never touches the render mechanism — only args in, geometry
out. (Superseded in one respect: how the editable node is *identified* now differs per engine — see the status
note at the top. The overlay mechanics here are unaffected.)

**2. Everything runs inside the frame, over postMessage.** The preview iframe is opaque-origin by design
([`Preview.tsx:391-398`](../src/app/components/Playground/Preview.tsx)) and must stay that way;
`getBlockControlsScript` ([`Preview.tsx:239`](../src/app/components/Playground/Preview.tsx)) is the existing
pattern to copy — injected script, messages up, listeners down.

**3. The tracer is a second pass, not the display pass.** The user's canvas renders real values. The
instrumented render is separate (offscreen, or a transient pass whose marks are stripped). Cheap in both
engines: Handlebars recompiles per keystroke already; React is one `m.update(props)` on a live module.

## Two prerequisites, both real

- **The playground's `field` helper is stubbed to a no-op** at
  [`Preview.tsx:16-18`](../src/app/components/Playground/Preview.tsx), so playground previews emit no
  `data-handoff-field` wrappers at all. Sentinel tracing *sidesteps* this entirely — which is the point, since
  the helper requires template authoring — but the build-time
  [`field` helper](../src/transformers/utils/handlebars.ts) and its `-inspect.html` artifacts remain a useful
  cross-check while validating the tracer, and its array-index ambiguity (`items.title` for every item, no
  index) is a good illustration of why the annotation-based approach was never going to be enough.
- **Preview capture writes render output, not input props.** [`field-lens.ts:1-24`](../src/app/lib/field-lens.ts)
  states it plainly: *stored preview values are serialized render output, not input props*, and the remedy is
  repairing capture rather than writing lenses. An inline editor writes back into args, so it inherits this
  bug directly. **Phase F.3 is gated on this being fixed.** F.0–F.2 are not — they read, they do not write.

## Proposal, in value-per-risk order

### F.0 — The unglamorous pass (do this regardless)

Most of the felt improvement, none of the new machinery. Complaint (3), plus the parts of (1) that are not
about ordering.

- Field styling and layout pass; grouping and collapse.
- **Wire up validation that is already modelled and unused.** `SlotMetadata.rules` (required,
  `content.min`/`max`, `pattern`) exists in the schema and only `ImageField` reads it
  ([`ImageField.tsx:60`](../src/app/components/Playground/fields/ImageField.tsx)). Char counters, required
  markers, pattern errors — all derivable today.
- **Validate from measured capabilities.** `SlotCapability.accepts` / `rejects` / `threw`
  ([`slot-capabilities.ts:16-30`](../src/app/lib/slot-capabilities.ts)) is a validator already computed at
  build time. `threw` → inline error before commit.
- **Undo/redo and per-field revert.** A field editor without undo makes people edit timidly, which reads as
  klunkiness even when nothing is actually wrong.
- **Presets as the entry point.** `previews` are Storybook-style named arg sets, and
  [`PlaygroundContext.tsx:84-88`](../src/app/components/Playground/PlaygroundContext.tsx) uses only the first
  one, to seed data. Real editing is "start from the closest variant, change the words" — not "fill in
  fourteen empty fields." Surface previews as a *start from* strip, plus per-field *revert to preset*.

### F.1 — Render the options instead of naming them

**The direct fix for complaint (2), and it needs no tracer.** For every enum and boolean, render N
miniatures of the component with that prop varied and let people choose by sight. `light`/`dark`,
`left`/`right`, overlay on/off stop needing explanation when you can see them.

- Machinery already exists: one module instance, `m.update(props)` per variant; Handlebars recompiles.
- Cap the render count; two enums crossed is a matrix, not a picker. Vary **one** prop at a time from
  current state.
- Zero authoring required — the options come from `SlotMetadata.options` / the boolean's own domain.

### F.2 — The tracer, consumed for orientation only

Ship the sentinel tracer with two consumers, both of which are harmless when a trace is missing.

- **Bidirectional hover linking.** Hover a field in the panel → outline its node(s) in the canvas. Click a
  node → focus its field. This is most of the *perceived* slickness of inline editing at a fraction of the
  risk, and it honestly answers "what does this field do?" for every content field. Per-block versions of
  both directions already exist (`playground-scroll-to-block`, block hover toolbars) — this is the same
  pattern at field granularity.
- **Automatic field ordering.** Sort traced content fields by the document position of their node, so the
  form reads top-to-bottom the way the component looks. Keyboard tab order falls out of it for free. This is
  the actual fix for complaint (1) — better than declaration order *or* alphabetical, because it matches
  what the user is looking at.
- **Dead-prop and impact detection** (independent of tracing, same instrumented-render harness): vary each
  prop, diff the output. No change → the prop does nothing for this preview; collapse it. Large visual delta
  → it matters; surface it first. Automatic importance ranking, no authoring.

**F.2 is where trace coverage gets measured on real components.** That number is the gate for F.3.

### F.3 — Inline overlay editing

Only now, and only if F.2's measured coverage justifies it. Overlay input per rule (1) above, for text /
richtext / image / link props. **Gated on the preview-capture bug** (see prerequisites) since this is the
first phase that writes.

### F.4 — Auto-populate the annotation layer (parallel, independent)

[`FieldAnnotation`](../src/declarations/types.ts) was built for hand-authored labels, help text, groups and
editor hints. Hand-authoring does not happen at scale. Generate them at build time from component source
plus a rendered screenshot, and write them to a checked-in, human-editable annotations file.

- Biggest single lever on *"not always with help text"*, and it asks component authors for nothing.
- Docgen already carries TSDoc into `description`
  ([`docgen/index.ts:116`](../src/transformers/docgen/index.ts)) — so anything documented already works and
  generation only fills gaps.
- On-brand: this is an AI-native tool with an MCP surface and a chat panel already in the playground.
- Output is data, reviewable in a diff, overridable by hand. Not a runtime dependency on a model.

## Sequencing and gates

| Phase | What | Gate |
|---|---|---|
| F.0 | Styling, validation, undo, presets | none — ships alone |
| F.1 | Rendered option pickers for enums/booleans | none; independent of F.0 |
| F.2 | Sentinel tracer → hover linking, auto-ordering, dead-prop detection | F.1 proves the instrumented-render harness |
| F.3 | Inline overlay editing | F.2 coverage ≥ threshold **and** preview-capture fixed |
| F.4 | LLM-populated field annotations | none; parallel throughout |

**The thing to resist: building the tracer *for* inline editing.** Build it for hover-linking and ordering,
where partial coverage is still a win and absence is invisible. Let inline editing be the payoff if the
coverage numbers earn it. Reversing that order stakes the whole investment on the one consumer that breaks
loudly when a trace is wrong.

## Open decisions

- **Coverage threshold for F.3.** Suggest ≥70% of text/image props across the SSC and Cynosure component
  sets, measured in F.2, with a named list of what misses and why.
- **Where trace results live.** Recomputed per render (simple, always fresh) vs cached per
  component+args-shape (faster, invalidation to get wrong). Recommend recompute first; it is cheap in both
  engines.
- **Whether F.1 renders live miniatures or cached screenshots.** Live is simpler and always correct; cached
  is cheaper for large components. Recommend live, revisit if it drags.
- **F.4 review workflow** — generated annotations land as a PR-able artifact, or are written silently and
  corrected on sight? Leaning PR-able for client component sets, silent for playground-only scaffolding.
