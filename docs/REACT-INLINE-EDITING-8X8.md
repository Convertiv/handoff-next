# Inline editing and review on 8x8 (React) — what it would actually take

Assessment, 2026-08-13. Written because the question keeps coming back in the abstract ("does Phase F work for
React?") and the answer turns out to be three different answers with three different price tags.

**Bottom line: the review process already works on 8x8 unchanged. Inline editing is the only real build — and
the roadmap's route to it is not the cheapest one available.** The blocker in front of both is a deployment
question, not a code question.

Everything here was checked against the real repo (`~/Documents/Clients/8x8/8x8-website`) rather than inferred
from the format flag.

---

## What 8x8 actually is

| | |
|---|---|
| Blocks | **59** under `handoff/components/blocks/`, 8 atoms |
| Per block | `template.tsx` (the Handoff wrapper), `schema.ts`, `style.scss`, `template.hbs`, `<slug>.js` |
| Schemas | **70** `schema.ts` files, generated from the TypeScript prop types (`sourceType`, `generic`, `kind`) |
| Field types | 502 `text`, 136 `object`, 115 `boolean`, 67 `array`, 27 `number`, 24 `enum`, 24 `function`, 12 `any` |
| Rules declared | **1003 × `required`. Zero content-length rules. Zero of anything else.** |
| Deployment | `handoff-app build:app` → static export (`handoff/vercel.json`, `outputDirectory: out/cPhnIGloI3RSykDUgu4x5M`) |

⚠️ **`template.hbs` is a decoy.** It is a static visual mock — `placehold.co`, lorem ipsum, no prop bindings at
all. It cannot carry `{{#field}}` marks because it does not render fields. The live path is `template.tsx`.

---

## Review — works today

Every check in the review pipeline reads **args, not DOM**:

- `auditBuild` walks `collectEditableText(mergeBlockArgs(...))`
- `authoring-guardrails` measures the same values
- `auditVoice` collects copy the same way

And `collectEditableText` already descends serialized React element nodes (`isElementNode` →
`walk(node.props, …)`, `guest-editable.ts:152`), which is exactly the shape 8x8's slots take. So placeholder
copy, shouting, thin content, repeated copy, weak link text and the voice audit all fire on 8x8 with no changes.
`patternThumbnailSvg` works too — it reads contracts, not renders.

Three gaps, in order of how much they cost:

1. **The content gate is empty.** 1003 `required` rules, zero length rules. `scripts/apply-content-length-plan.ts`
   can target these files, but note what is different from SS&C: SS&C's contracts are hand-authored, while
   8x8's `schema.ts` is *generated from the prop types*. Hand edits do survive today — none of the 70 files
   carries a generated marker, and sync only rewrites hand-authored schema under `repairHandAuthoredDocs` on a
   type-only file — but the source of truth is the TypeScript type, so authored rules are drift-prone. **F.4
   annotations are the durable home**; authoring into `schema.ts` is the expedient one.
2. **No contract-render audit.** There is no server-side React render anywhere in this codebase
   (`contract-render-audit.ts:6` says so and explains why). "Declared field renders nothing" stays unavailable
   for React; `slot-capabilities` covers part of the same ground from the build-time probe.
3. **The config lock is a name heuristic.** 8x8 has 502 `text` fields and its types make `anchor` and `*Theme`
   indistinguishable from a headline — the weak point already recorded in the roadmap, but 8x8 is where it
   bites hardest. Needs a per-block pass before guests are pointed at it.

---

## Inline editing — it needs a mark source

React blocks emit no `{{#field}}` marks, so today: no hit areas, no overlay, no field-level jump.

**Block-level navigation and the section flash already work on React**, as of 2026-08-12 — the handler moved
above the mark walker's early return, which is exactly the case that had been dying silently.

### The roadmap's route: F.3 sentinel tracer

Extend `slot-probe.ts` to record *where* each sentinel landed. Build-time, inferred, quoted at 60–80% coverage.
It is real work and it is the general answer for arbitrary React.

### The cheaper route, specific to 8x8: mark at the wrapper

8x8's Handoff wrappers **are already the adapter between flat editable fields and React slots.** `template.tsx`
declares its own field shape —

```ts
type HeroBackgroundPreviewFields = {
  title?: unknown; paragraph?: unknown; body?: unknown; overline?: unknown;
  buttons?: PreviewButton[]; breadcrumb?: PreviewBreadcrumb[];
  images?: { desktop?: PreviewImage; mobile?: PreviewImage };
};
```

— and converts it through **14 shared helpers** in `handoff/components/previewHelpers.tsx`
(`renderPreviewTextSlot`, `renderPreviewImageSlot`, `renderPreviewButtonSlots`, …), used by **41 of 58 blocks**.

Those helpers already create the DOM node for the value:

```tsx
return text.split("\n\n").map((line, index) => <Tag key={`${as}-${index}`}>{line}</Tag>);
```

They simply do not know the field's name. Give them one and emit `data-hf-field="title"` **on the node they
already create**.

Why this beats tracing, here:

- **No extra node.** The objection that killed `<span>` wrappers for Handlebars — 26 of 292 field blocks wrap
  block-level content, where a span is invalid nesting the browser reparents — does not apply, because nothing
  is being added. An attribute goes on an element the helper was already returning.
- **Deterministic, not inferred.** No coverage percentage to defend. A block either names its fields or it
  does not, and which is which is greppable.
- **Small and mechanical.** ~14 helper signatures plus threading names at call sites in 41 wrappers, all in the
  client repo, scriptable.

App-side cost is one pass: `collect()` in `inline-edit-script.ts` gains an attribute source alongside the
comment walker, producing the same `{id, blockId, start, end}` shape. Everything downstream — overlay, limits
counter, commit, findings jump, section flash — is untouched and already covered by
`test/inline-edit-script.test.ts`.

What it will not cover:

- The **~17 hand-rolled blocks** that do not use the helpers.
- The helpers' `if (slot) return slot` early return — an author-supplied React node stays unmarked.
- **Richtext.** 8x8 text goes through `plainTextFromPreviewValue`, so those fields are plain strings. Richtext
  inline editing would need the wrapper to accept HTML, which is a product decision about 8x8's content model,
  not a Handoff feature.

All three degrade to *nothing* rather than to a broken affordance, which is the F.2 rule.

### One nuance on commit

Committing rebuilds the whole `srcdoc`. React blocks can instead take `m.update(props)` over the postMessage
channel that already exists — worth wiring so an 8x8 inline edit does not remount the page. Scroll restoration
hides the symptom; it does not preserve component state.

---

## The actual prerequisite

8x8's Handoff deployment is still the **static build**, so there is no DB, no auth, and no
playground/build/review surface to put any of this on.

The catalog itself is not the problem: the F.-1 measurement (86 unfeedable fields across 37 of 76 components,
normalised to 0) ran over 8x8 **from the database**. This is a deployment gap.

## Recommended sequence

1. **Confirm which V2 deployment holds the 8x8 catalog and point a playground at it.** This alone gets build +
   review + audits + voice on 8x8 with zero code written, and it is the demo-shaped step.
2. **Author length rules for the top ~15 blocks** with the existing applier, accepting the drift risk, or land
   F.4 annotations first if this is meant to last.
3. **Then the `data-hf-field` marks**, starting with `renderPreviewTextSlot` and `renderPreviewImageSlot` —
   most of the coverage for the least threading.

F.3's tracer stays on the roadmap as the answer for React catalogs that have no wrapper layer to mark. 8x8 has
one, so 8x8 should not pay for the tracer.
