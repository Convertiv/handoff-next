# The Workbench — strategic plan

**Written:** 2026-07-28/29, after a deep pass through the design/spec/component pipeline.
**Companions:** `COMP-AS-ART-DIRECTION.md` (the layered-code direction) ·
`ASSET-EXTRACTION-REDESIGN.md` (assets) · `WORKBENCH-PLAYGROUND-ROADMAP.md` (perf + multiuser).

This doc says what the workbench **is**. The others say how individual pieces work.

---

## 1. What the code actually told us

Every failure found in a full day of live testing was at a **seam**, not in a stage:

| Seam | State found |
|---|---|
| extraction ↔ spec | Shared one invocation; extraction starved spec, row stranded |
| comp ↔ code | `component-generation-run.ts:219` — `const refinement = undefined;` hardcoded. **The loop iterates without learning.** |
| spec ↔ component catalog | `existingComponentMatches: 0` on live 8x8, with 79 components available |
| design ↔ verification | `compareDesignToPreviewScreenshot` written, **never called** |
| verification ↔ storage | `visual_score` column + admin UI exist; nothing computes it |
| assets ↔ geometry | `boundingBox` declared in the type, never populated; `sharp` a dependency, unused |
| workspace ↔ spec | `designMd` parameter hardcoded to `''` |
| sharing ↔ people | `handoff_resource_grant` table has no writer anywhere |
| config ↔ behavior | `HANDOFF_COMPONENT_VISUAL_THRESHOLD` in env, never read |

**The stages are good. The transitions are unbuilt.** This is the signature of building forward
fast — every one of those was the right idea. But it means the highest-leverage work available is
**not new features**; it's closing loops that are already ~90% built.

Corollary for planning: front-load the unwiring. It is cheap, it de-risks everything after it, and it
produces the measurements that tell us whether the bigger bets are worth making.

---

## 2. The core structural idea: one gate, two systems

The pipeline is not one pipeline. It is two systems joined at a commitment gate.

```
idea → chat → prompt → image prototype → refine   ‖   spec → layered prototype → Figma / component
└──────────────── DIVERGENT ────────────────┘      ‖   └──────────── CONVERGENT ────────────┘
```

| | Left of the gate | Right of the gate |
|---|---|---|
| Purpose | Explore | Commit |
| Cost profile | Cheap, many attempts | Expensive, few attempts |
| Latency | **Critical** — dead air kills a session | Largely irrelevant |
| Durability | Throwaway; regenerate freely | Durable, auditable |
| Correctness | Taste | **Verifiable** |
| Infrastructure | `after()` is fine | Durable jobs, retries, provenance |

**The single biggest architectural error to avoid is applying one infrastructure model to both
halves.** That is exactly what produced the invocation-starvation bug: an exploration step and a
production step sharing one 300s budget, each unable to bound the other.

`draft → review → approved` already exists on artifacts and wants to be this gate. **Transition to
Dev is the gate crossing.**

---

## 3. The spec is the contract, not an output

Today the spec is something the pipeline *produces*. It should be the **interface between the two
halves**. That reframing pays for itself several times:

- **Many producers.** An image prototype yields a spec — but so can a Figma import, an existing
  component plus a delta, or a human writing one. None is privileged.
- **Many consumers.** Code generation, Figma projection, documentation, tests, changelog. Each
  independent and parallelizable.
- **"Push to Figma" and "push to component" stop being pipeline stages** and become two consumers of
  one contract. They can be built by different people, in either order, without coordination.

The spec is already durable and human-editable (`componentSpecMd`) — which is right. What's missing is
treating it as *authoritative* rather than as a by-product of one particular path.

**Design rule:** anything right of the gate reads the spec, never the comp. If a consumer needs the
image, the spec is incomplete.

---

## 4. Reuse belongs left of the gate

The `reuse` spec section (added 2026-07-28) evaluates composability at **spec** time — after a novel
image has been generated and everyone has anchored on it. That is backwards.

The reuse question belongs at the **prompt** stage:

1. Seed the prompt with the component vocabulary (`getComponentSummaries`, patterns).
2. Where an existing component fits, **constrain generation to its slot contract** — "generate a hero
   using `hero-form`'s structure" — rather than generating freely and matching afterwards.
3. Net-new becomes a branch the user **chooses, with a stated reason**, not the silent default.

This is cheaper (no image spend to discover you already owned the thing) and it makes the product's
core opinion structural rather than prompted. `reuse` stays in the spec as the *record* of the
decision, not the place the decision is made.

---

## 5. The fidelity cliff

The chain stacks three lossy translations: **image → spec → code.** By the time a developer holds
code, they are three inferences from what the marketer approved.

`compareDesignToPreviewScreenshot` is the only mechanism that can close that gap — the only thing
able to say *"what shipped matches what was approved, to 0.87."*

This is why the verification wires come first regardless of which strategic direction wins. Without
them the pipeline has no way to know it is working — precisely the condition that let spec generation
sit silently broken for seven weeks.

**Design rule:** every generative stage must emit a score against its input. A stage that cannot be
scored cannot be trusted, and will eventually break quietly.

---

## 6. Figma is a projection, not a push

One-way push into Figma will drift — and drift has already bitten this product once (previews). The
repo already holds the right ingredients: DTCG multi-axis theming, a figma-plugin API, and a
multi-source provenance model (`providence-multi-source-provenance-model.md`).

Treat Figma as a **projection of the spec**, with provenance tracking which source is authoritative
per field. Bidirectional reconciliation is the eventual shape; a thin one-way projection is an
acceptable first step **only if** it is designed as a projection from the start.

**Strategic note:** this is the weakest link in the chain for value, not difficulty. For most teams
value flows the other way — designers live in Figma and want it in code. Pushing generated work into
Figma matters as a courtesy artifact and as proof the system respects their tools. Real, but not why
anyone buys. **Scope it last and thin.**

---

## 7. The missing half: change, not creation

The sketched chain is entirely about **net-new creation**. The durable value is in **change**:

> This hero already exists. Marketing wants a variant. What's the diff? What breaks? What's the
> changelog entry? Who approved it? Why?

`handoff_pattern_change` and `change_why` already exist. A system that owns *"how did this component
get here and what changed"* is far harder to displace than one that produces good first drafts —
first drafts are becoming a commodity; provenance is not.

This should be a first-class axis of the roadmap, not a follow-on. Concretely: every gate crossing
should produce a change record, and the second visit to a component should open on its history.

---

## 8. The wedge

Stated plainly, so scope decisions have something to be measured against:

> **From an idea to a working component that provably uses your design system** — with token
> adherence you can measure, reuse you can verify, and a specification a developer can build from
> without a meeting.

Everything in this doc either serves that sentence or gets deferred. "Provably" is the load-bearing
word, and it is what sections 5 and 7 exist to deliver.

---

## 9. Target architecture

```
                    ┌──────────── LEFT: exploration (after(), ephemeral) ────────────┐
  idea → chat/MCP → prompt (seeded with component vocabulary + brand voice)
                       ↓
                    image prototype ⇄ refine (image-to-image)
                       ↓
  ════════════════════ GATE: review → approved ════════════════════════════════════════
                       ↓
                    ┌──────────── RIGHT: production (durable job queue) ─────────────┐
                    SPEC  ← the contract; editable, authoritative, scored
                     ├──→ layered component  → render → screenshot → compare → refine ⟲
                     ├──→ Figma projection
                     ├──→ docs / changelog / change record
                     └──→ tests
```

**Right-half execution model: one stage per invocation, driven by a durable job queue.** The
`design_generation_job` + `/api/handoff/ai/design-jobs/run` cron already prove the pattern. Each
stage gets a full budget; stages are independently retryable; adding stages is adding rows, not
tightening a budget. Let the cron chain stages opportunistically within a tick while time remains, so
the fast path stays fast and the slow path stays safe.

---

## 10. Sequencing principles

1. **Wire before building.** Cheap, and it produces the measurements that justify the expensive work.
2. **Measure before betting.** Land the visual score before committing to layered-code generation —
   the score tells us whether a code generator can hit the comp at all.
3. **Never share an invocation between an exploration step and a production step.**
4. **Every generative stage emits a score.**
5. **Right of the gate reads the spec, never the comp.**
6. **Defer Figma.** It is proof-of-respect, not the wedge.
