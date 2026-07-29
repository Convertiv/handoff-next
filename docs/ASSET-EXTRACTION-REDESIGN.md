# Design asset extraction — assessment and proposed redesign

**Status:** Proposal (2026-07-28). Prompted by: extraction has never once succeeded on the 8x8
registry (5 `none`, 1 `failed`, zero assets across six artifacts), and by the 240s budget it
consumes. Current implementation: `src/app/lib/server/design-asset-extractor.ts`.

---

## The core finding: it doesn't extract, it re-generates

The pipeline's Phase 2 calls **`openAiImageEdit`** with `gpt-image-2` and a text prompt per asset:

```ts
const assetUrl = await openAiImageEdit({
  model: 'gpt-image-2', size: '1024x1024',
  prompt: task.prompt,          // e.g. "Extract the background layer…"
  images: [input],              // the composite
});
```

So "extract the background" actually means *"draw me a new image that looks like this one with the
foreground removed."* **The output pixels are not the input pixels.** For a design asset that is
fatal, not merely lossy: colours drift, text re-renders as garbled glyphs, logos are redrawn
incorrectly, gradients are approximated, edges move.

Everything downstream follows from this one decision.

## Why it's fragile — five compounding problems

**1. Output is synthetic, so it can never be faithful.** A developer needs the actual asset. A
plausible repaint of the asset is worse than useless, because it looks right at a glance and is
wrong in production.

**2. "Right-sized" is impossible by construction.** `size: '1024x1024'` is hardcoded for every
asset. A 1920×1080 hero background comes back as a 1024² square; a 24×24 icon also comes back as a
1024² square. The stated goal — *pull out right-sized image assets* — cannot be met on this path.

**3. The geometry was designed for but never built.** `ExtractedAssetV2` already declares
`boundingBox?: { x, y, w, h }` with *"0–1 relative coordinates"*. **Nothing ever populates it.**
Classification returns no coordinates and extraction computes none. The type anticipates the
approach below; it was simply never implemented.

**4. The vision gate is asked to enforce a criterion the pipeline violates.** `visionValidateAsset`
sets `ok=true` only if the asset is *"grounded in A (no invented content)"* — but the asset **is**
invented content, by construction. Hence the one recorded failure on 8x8: *"All extracted assets
failed vision validation (possible model mismatch or strict gate)."* The gate was arguably right and
the pipeline wrong. It's also inconsistent: it fails **open** in two places
(`if (!orig || !asset) return true`, `catch { return true }`), so it rejects sometimes and waves
through others depending on transient conditions. That is exactly the "works occasionally" symptom.

**5. Cost and latency are structurally bad.** Per run: 1 classify + **up to 7 image generations**
(state variants + 3 sub-components + icons + media + background) + up to 7 vision validations.
Image generation dominates, which is why extraction needs a 240s budget — and why it starved spec
generation of time in the same `after()` invocation.

**Bonus problem:** `visibleStates` is a vision *guess*, and the pipeline then asks an image model to
render a "hover state" that may not exist anywhere in the design. That isn't extraction under any
definition — it's invention on top of a guess.

---

## Proposed redesign: detect → crop → verify

The principle: **extraction returns real pixels, only ever real pixels.** Anything synthesized is
*generation* and must be a separate, explicitly-labelled operation.

### Phase 1 — Region detection (one cheap vision call)

Ask a vision model for **normalized bounding boxes**, not images:

```json
{ "regions": [
  { "key": "background", "role": "background", "label": "Hero background",
    "box": { "x": 0, "y": 0, "w": 1, "h": 1 }, "confidence": 0.9 },
  { "key": "media_product", "role": "media", "label": "Product screenshot",
    "box": { "x": 0.52, "y": 0.18, "w": 0.44, "h": 0.6 }, "confidence": 0.8 }
] }
```

One JSON call, no image generation. This populates the `boundingBox` field the type already has.

Coarse-localization errors here are **visible and correctable** — a wrong crop is obviously wrong,
unlike a subtly repainted gradient. That's a categorical improvement in failure mode.

### Phase 2 — Deterministic crop with `sharp`

**`sharp@0.35.2` is already in `package.json` and currently unused anywhere in the app.**

For each region: crop the **original** at real pixel coordinates. Then per-role post-processing:

| Step | Why |
|---|---|
| `.extract({ left, top, width, height })` | True source pixels at native resolution |
| `.trim()` for icons/sub-components | Removes uniform padding → genuinely tight bounds |
| Emit at natural size (+ optional capped 2× variant) | **This is what "right-sized" means** — no forced square |
| PNG where transparency matters, WebP/AVIF for photos | Correct format per asset type |
| Record `width`, `height`, `bytes`, `format` on the asset | Developers can see what they're getting |

Runs locally in milliseconds per crop. No API call, no cost, no latency.

### Phase 3 — Verification that can actually be correct

Because assets are now crops, validation becomes deterministic and free:

- box within canvas bounds, non-degenerate (w/h above a floor)
- not ≈100% of the canvas (unless role is `background`)
- crop is not near-uniform (catches blank/empty regions)
- resulting dimensions sane for the role (an "icon" 900px wide is a mis-detection)

No model in the loop, no coin flip, no fail-open/fail-closed inconsistency. Groundedness is
guaranteed by construction rather than adjudicated after the fact.

Optionally: one vision pass over a **contact sheet** of all crops to sanity-check *labels* — but
never to decide whether pixels are real, which is no longer in question.

---

## What legitimately stays generative — and must be labelled

Two real needs genuinely require synthesis. Both should be **separate, opt-in operations**, never
silently mixed into extraction:

1. **Background plate reconstruction** — inpainting behind removed foreground. A crop of a hero
   background still has the headline sitting on it. Filling that in is real generative work. Ship it
   as an explicit "reconstruct background plate" action, output clearly marked *AI-reconstructed —
   not your original pixels*.
2. **Missing state variants** (hover/focus not present in the design) — that is *design work*. It
   belongs in the workbench prompt loop, not in an extraction pipeline.

## Icons: match, don't extract

Icons are the worst case for crop-based extraction (small, low-resolution, anti-aliased) — and also
the case where extraction is least necessary. The registry already has an icon catalog
(`handoff_get_icon_catalog`, `handoff_search_icons`).

**The right move is to identify the icon and match it to the system's icon set, returning a
reference — not a bitmap.** This is the reuse thesis applied to assets: don't hand the developer a
fuzzy 1024² PNG of a chevron; tell them it's `icon-chevron-right` and hand them the reference.

---

## What this buys

| | Current | Proposed |
|---|---|---|
| Fidelity | Re-generated pixels | **Original pixels** |
| Sizing | Forced 1024×1024 | **Native size per asset**, correct aspect |
| API calls | 1 classify + ≤7 generate + ≤7 validate | **1 detect** + 0 |
| Latency | Minutes (needed 240s budget) | **Seconds** |
| Cost | Image generation × N | One JSON vision call |
| Failure mode | Silent unfaithfulness | Visible, correctable mis-crop |
| Validation | Model coin-flip, fails open | Deterministic geometry |

It also **dissolves the budget problem** from 2026-07-28: extraction drops from ~240s to a few
seconds, leaving the full invocation for spec generation. The shared-deadline fix stays useful as a
guard, but stops being load-bearing.

---

## Risks, honestly

- **Box accuracy is the new risk.** Vision models are imprecise at exact pixel boundaries.
  Mitigations: request generous boxes then `.trim()`; snap to detected edges; and — crucially —
  **allow manual box adjustment in the UI**, which only becomes possible once assets are geometry.
  You cannot hand-correct a hallucinated repaint.
- **Small regions stay hard.** Source composites are 1024–1536px; a 24px icon is ~20 source pixels.
  See "match, don't extract" above.
- **Existing generated assets remain in the DB.** They stay readable; new runs produce crops. Add
  `width`/`height`/`bytes`/`format` as optional fields so old rows don't break.

## Migration

1. Add optional `width`/`height`/`bytes`/`format` to `ExtractedAssetV2`; populate `boundingBox`.
2. Implement `detectAssetRegions()` (vision → boxes) and `cropAssetRegions()` (sharp).
3. Swap Phase 2 to detect+crop; delete `openAiImageEdit` from the extraction path.
4. Replace `visionValidateAsset` with the deterministic geometry checks.
5. Keep `annotated_overview` as-is (it is the original — already correct).
6. Move background-plate reconstruction behind an explicit action.
7. Re-point icons at the icon catalog.

Steps 1–4 are the substance and are self-contained. **Not a pre-Thursday change** — the demo should
either drop the assets section or show it with whatever the current path yields.
