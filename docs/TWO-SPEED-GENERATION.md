# Spec — Two-speed generation: sketch while talking, specify on save

**Status:** Approved, not built (2026-07-30). Deferred until after the 8x8 demo. Decision by Brad.

## The problem

Every generation currently runs the full spec-first pipeline: `spec → assets → composite →
conformance`, one stage claimed per cron tick, **5–9 minutes** end to end. That is the right cost for
producing a specified design with web-ready assets. It is the wrong cost for a conversation.

Natko's chat window makes this obvious. The interaction is conversational — say a thing, see a thing,
adjust — and a five-minute wait per turn breaks it. The pipeline isn't misconfigured; it's being asked
to serve a loop it was never shaped for.

## The model

Two speeds, chosen by intent rather than by surface:

| | Sketch | Specify |
|---|---|---|
| **When** | every turn of the conversation | once, on **Add to Library** |
| **Path** | `POST /api/handoff/ai/generate-design` — creates a job and runs the worker **inline over SSE**, no cron | `spec-first` pipeline, four stages on the cron |
| **Cost** | one image call, ~60–100s | 5–9 min |
| **Output** | a disposable prototype | a specified design with real assets |

The sketch is a thumbnail: fast, cheap, and never the deliverable. Saving is the moment the user says
"this one" — and that is when it earns a specification.

Note the fast path already exists and is already wired: `generateDesignImage` in `DesignClient` calls
it, and it was the composer's behaviour before spec-first. Nothing new is needed to make sketching
work; the change is *where spec-first is triggered from*.

## The decision: regenerate on save, with the sketch as art direction

Three options were considered. The one chosen keeps both guarantees:

- ❌ **Keep the sketch as the final image, spec + assets only.** No surprise and only two stages, but it
  breaks the thing asset-first exists to provide: the photo in the comp would no longer be the same file
  a developer downloads.
- ❌ **Regenerate from the spec, ignore the sketch.** Purest, simplest, and undercuts the loop the user
  just spent time in — they approve one image and the library shows a visibly different one.
- ✅ **Regenerate, with the approved sketch attached to the composite stage as a layout/style
  reference.** The final is spec-derived, so the comp and the assets remain the same bytes, and it still
  resembles what was signed off.

## Implementation notes

**The sketch is already stored where the pipeline needs it.** On save, the artifact is created with the
prototype as its `imageUrl`. The composite stage reads `row.imageUrl` *before* overwriting it, so the
art-direction reference needs no new storage and no new column — it is simply the image the artifact
already has.

Hook points, all of which exist:

1. **`handleGenerate` (`DesignClient`)** — currently routes `!refining` to `startSpecFirstDesign`.
   Revert to `generateDesignImage` for both new and refining, so every conversational turn sketches.
2. **The save action** (`handleOpenSaveArtifact` → save dialog) — on confirm, create the artifact with
   the prototype image, then `startDevPipeline({ artifactId, intent: 'spec-first' })`.
3. **`startDesignFromBrief`** creates an artifact with **no** image by design. It needs a variant (or a
   parameter) that accepts the approved prototype, since in this model save *does* start with one.
4. **`runCompositeStage`** — attach the prior `row.imageUrl` as a labelled reference.

⚠️ **Attach it as a labelled reference, not as `iterationBaseUrl`.** Supplying `attachedImageLabels`
puts the worker on its `designerAssembled` path, which deliberately *skips* the iteration base. The
label has to distinguish the sketch from the generated assets, which carry "place this as-is": the
sketch is guidance for composition and must **not** be reproduced, since its imagery is exactly what the
real assets are replacing. Something like *"layout reference only — match the composition and
proportions; do NOT copy its imagery or text."*

## Risks

- **The two labels compete.** The composite stage will be handed "place these assets verbatim" and
  "follow this layout but don't copy it" in the same prompt. If the model conflates them it may
  reproduce the sketch's photography instead of placing the generated assets — which would silently
  break the same-bytes guarantee. Verify by eye on the first run, the same way placement was verified.
- **Sketches cost credits too.** Every conversational turn is now an image call. Cheaper per turn than
  today, but there will be more turns.
- **Two paths to a design again.** The reason spec-first exists is that image-first put the spec
  downstream of the picture. This reintroduces an image-first *sketch* — acceptable only because the
  sketch is explicitly disposable and the saved artifact is still generated from the brief. If that ever
  slips (e.g. someone makes save derive the spec by reading the sketch), the whole inversion is back.
  **The spec must always come from the brief, never from the sketch.**
