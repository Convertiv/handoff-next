# Spec — Comp as art direction, code as output

**Status:** Proposal (2026-07-28). Supersedes the crop-based approach in
`ASSET-EXTRACTION-REDESIGN.md` as the *strategic* direction; that doc remains valid as the tactical
fix if this is deferred.

**The shift:** stop treating the generated raster as the deliverable to be deconstructed. Treat it as
**art direction** — the visual target — and make the deliverable a **layered code component** built
from real tokens, real classes, and real component slots. Assets come out web-ready because they were
never composited in the first place.

---

## Why this is the right shape

The current model destroys structure at generation time and then spends AI credits trying to
reverse-engineer it. Layered-code-first removes the problem rather than mitigating it:

| Concern | Raster-first (today) | Comp-as-art-direction |
|---|---|---|
| Assets | Re-generated from a bitmap, forced 1024² | **Placed as assets** — native size, correct format, transparency where it belongs |
| Token adherence | Vision model *guesses* whether `#EBEAE1` is the off-white token | Generation emits `var(--color-*)`; adherence is a **lookup, not an inference** |
| Reuse | LLM opinion on "which of 79 components could build this" | Generated **against** a real slot contract; composition is a **fact** |
| Revision | Re-roll the whole image | **Class/prop change** — surgical |
| Verification | Vision gate asked to prove non-invention by an inventing pipeline | **Render → screenshot → compare** against the comp |

It also maps cleanly onto the lifecycle already in the product:

| Lifecycle | Stage | Artifact | Cost |
|---|---|---|---|
| **Ideate** | Conversation → brand voice → copy → comp | Raster comp | Cheap, fast, visual |
| **Iterate** | Refine the comp visually (image-to-image) | Better comp | Cheap, fast |
| **Build out** | Comp becomes the target; generate + verify code | **Layered component** | Expensive, gated |

`draft → review → approved` already exists on artifacts. **Transition to Dev becomes the build-out
gate** — which is exactly what it was reaching for.

**The comp is still worth keeping** — as the art-direction record. "What was intended" vs. "what
shipped" is a genuinely useful diff for a design-system team, and a far better story than "here's a
picture we took apart."

---

## What already exists — this is ~90% built

| Piece | File | State |
|---|---|---|
| Comp + conversation history | `design_artifact` | ✅ works |
| Code generation from a design | `component-generation-llm.ts` `generateComponentWithLlm` | ✅ works |
| Generation orchestration + **iteration loop** | `component-generation-run.ts` | ✅ loop exists |
| Preview render → PNG | `component-preview-screenshot.ts` | ✅ exists |
| **Visual comparison** (0–1 score, specific deltas, a11y notes) | `component-visual-compare.ts` `compareDesignToPreviewScreenshot` | ⚠️ **written, never called** |
| `visual_score` storage | `schema-pg.ts:508`, `queries.ts:1104` | ⚠️ column + types exist, **never populated** |
| Score display | `admin/builds/BuildsClient.tsx:398` | ⚠️ renders a value nothing computes |
| Threshold config | `HANDOFF_COMPONENT_VISUAL_THRESHOLD` | ⚠️ in `.env`, unread |
| Slot contracts | `getComponent(id).properties` (e.g. `hero-form`) | ✅ real, rich |
| Preview authoring via MCP | `handoff_create_preview` / `update_preview` | ✅ works |

### The gap is three wires

1. `compareDesignToPreviewScreenshot` is **never called**.
2. `component-generation-run.ts:219` — **`const refinement = undefined;`** is hardcoded, so the
   iteration loop regenerates *identically* every pass. It iterates without learning.
3. `visualScore` is never written, so the threshold can't gate anything.

Closing those three turns an open loop into a **converging** one. That is the whole of Phase 1.

---

## Prerequisite — fix the stack profile

`handoff_get_project_context` against `https://8x8-handoff.vercel.app` currently returns:

```
stackProfile: "bootstrap-handlebars"
translationRules: ["Use Handlebars templates, Bootstrap 5 utilities, and SCSS with var(--color-*) tokens."]
```

**8x8 is React + Tailwind + Sanity.** That is SSC's profile on 8x8's registry. Code generation reads
this profile, so today the build-out stage would emit Handlebars for a React/Tailwind shop. **Nothing
in this plan can be evaluated until it's corrected** — a wrong stack profile makes every generated
component wrong in a way that has nothing to do with the architecture.

Also worth auditing: whether `stackProfile` is per-registry configuration or was inherited from a
template, since the same bug may exist on other tenants.

---

## Phases

### Phase 1 — Close the verification loop *(small, highest value)*

- Call `compareDesignToPreviewScreenshot(comp, previewPng)` after each iteration's preview render.
- Persist `visualScore` (column already exists).
- **Feed `differences` into `refinement`** on the next iteration — replacing the hardcoded
  `undefined`. This is the single most valuable line in the plan.
- Stop early when `score >= HANDOFF_COMPONENT_VISUAL_THRESHOLD`; keep the best-scoring iteration
  rather than the last.
- Surface score + deltas in the dev-handoff panel.

**Exit:** generation converges toward the comp instead of re-rolling blind, and the score is visible.

### Phase 2 — Comp becomes art direction, not deliverable

- `handoff_transition_to_dev` runs the build-out: generate code → render → compare → iterate.
- Dev-handoff status gains stages: `generating_code → verifying → ready`.
- The comp is retained and labelled **"art direction"**; the panel shows comp-vs-built side by side
  with the score and the remaining deltas.

**Exit:** the output of a workbench session is a component, with the comp as provenance.

### Phase 3 — Generate against the component vocabulary *(the reuse thesis, enforced)*

- Feed the reuse candidates (from the `reuse` spec section) into generation as **slot contracts**,
  not prose: given `hero-form`'s real `properties`, generate a *filled instance*, not a new component.
- Prefer, in order: **fill an existing component's slots** → **compose existing components** →
  **generate net-new** (and when net-new, emit the contract it would need to join the library).
- Composition score becomes structural: *did it use real components?* — verifiable, not an opinion.

**Exit:** Variant A of the demo is enforced by the pipeline, not merely suggested by a prompt.

### Phase 4 — Assets web-ready by construction

- Image *content* (photos, illustrations) generated at correct native size and aspect, placed as
  discrete assets — **never composited into the comp's layers**.
- Background plates, gradients, and shapes become CSS/tokens, not bitmaps.
- Icons resolve to the icon catalog by reference (see `ASSET-EXTRACTION-REDESIGN.md`).

**Exit:** "extraction" becomes enumeration — there is nothing hidden in a bitmap to recover.

### Phase 5 — Retire raster extraction

Once Phase 4 lands, `design-asset-extractor.ts`'s `openAiImageEdit` path has no remaining job.
Delete it. Keep `annotated_overview` (it is the comp) and the deterministic geometry helpers if
Phase 4 still needs crops for any content asset.

---

## Risks, honestly

- **Visual quality is the real risk.** Image models are genuinely better at *composition* —
  proportion, focal weight, colour relationships — than a code generator writing React/Tailwind. The
  comp stays the art-direction source precisely to preserve that, but a code generator that can't hit
  the comp will produce structurally perfect, visually mediocre output. **Phase 1's score is the
  instrument that tells us whether this is true**, which is why it goes first and cheapest.
- **Two AI passes can disagree.** The comp may be unbuildable in the component vocabulary. Phase 3's
  ordering (fill → compose → net-new) is the escape hatch, and the score makes the disagreement
  visible rather than silent.
- **Convergence isn't guaranteed.** Feeding deltas back may plateau. Mitigation: cap iterations, keep
  best-scoring, and surface the residual deltas as developer notes rather than pretending they're
  resolved.
- **Cost moves, it doesn't vanish.** Fewer image generations, more code generations + renders +
  vision comparisons. Should net cheaper (text ≪ image), but measure it.

## Sequencing

**Not before Thursday.** Phase 1 is small but it changes the build-out path, and the demo needs
stability more than it needs this. Right order after the demo: **fix the stack profile → Phase 1 →
measure the scores on real 8x8 designs → decide whether Phases 2–5 are justified by the numbers.**

Phase 1 is worth doing regardless of the strategic bet: an iteration loop that never learns from its
own verification is a bug on any architecture.
