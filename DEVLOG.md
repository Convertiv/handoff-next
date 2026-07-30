# handoff-app — DEVLOG

Reverse-chronological running journal (newest at top). Decisions, state, gotchas, learnings.
Complements `CLAUDE.md`/`ROADMAP.md` (stable) and `docs/` specs. Whoever works this repo appends here.

---

## 2026-07-30 — Post-merge integration debt: Natko's UI ↔ our backend

The `feature/design-restructure` merge (`9ba122fc`) landed cleanly for everything except two UI files.
All backend work is byte-identical to its parent — `payload.ts`, `create-server.ts`, `pipeline-stages.ts`,
`design-from-brief.ts`, `brief-spec.ts`, `generation-prompt.ts`, `design-spec-generator.ts` and the
artifact detail page were untouched.

`LibraryClient.tsx` took Natko's version wholesale. `DesignClient.tsx` did **not** resolve to either
side: it kept his declaration block and our body, which is why it stopped compiling —
`LibraryArtifactRow`, the `authz/vocab` type imports and `activeSidebarTab` were dropped while the code
referencing them stayed. Restored the first two; the third was gated on a sidebar tab that no longer
exists, so the effect now loads on first need instead.

**To resolve after the demo — the list, while it is still legible:**

1. **~200 lines of orphaned machinery in `DesignClient`.** `fetchLibrary`, `libraryArtifacts`, the
   inspector's status/visibility handlers, `shareUrls`, and `confirmDeleteArtifact` all still compile and
   nothing renders them — `AssetInspector` is no longer mounted there. Decide per-handler whether it
   moves to the new Library surface or goes.
2. **Delete is gone from the library.** It shipped the day before the merge into the old sidebar; the new
   `/library` grid has none. `AssetCard` already carries `permissions`, so the affordance is a small port
   — gate on `canDelete`, confirm, `DELETE /api/handoff/ai/design-artifact/[id]`. The artifact detail
   page's delete survived and works.
3. **Two row types that look alike and are not.** `LibraryArtifactRow` (raw design row + lane fields,
   local to `DesignClient`) vs `LibraryAsset` (`components/library/AssetCard.tsx`, normalized across
   designs *and* patterns, so only the common denominator). Someone will try to unify these; the
   question to answer first is whether the workbench still needs raw rows at all.
4. **Where do lifecycle, visibility and share live now?** Those actions lost their home with the
   inspector. They are real capability, not leftovers.
5. **Protect `startSpecFirstDesign`.** It survived the merge and is the composer's entire spec-first path
   — brief → spec → assets → composite, plus the stage labels. Any further `DesignClient` restructure
   should treat it as load-bearing rather than as workbench plumbing.

Also worth knowing: the merge added `radix-ui` and `@shadcn/react` to `package.json`, so a stale
`node_modules` fails the build with four unresolved modules. `npm install` after pulling.

---

## 2026-07-29 — Placement VERIFIED: the composite really does place the generated asset

Brad, after a live spec-first run on 8x8: *"No they match perfect."*

This was the one open risk carrying the whole architecture. Asset-first only means anything if the
composite model **places** the attached photograph rather than redrawing it — the guarantee is that the
image in the comp and the file a developer downloads are the same bytes. `attachmentLabel` instructs the
model not to reinterpret, but nothing enforces it, and a silent redraw would have cost the guarantee
while everything still looked fine.

Confirmed by inspection. Corrected the stale ⚠️ block in `asset-first-generation.ts`, which still
described this as unresolved and would have sent the next pass chasing a solved problem.

**It is an observation, not an invariant.** It rests on a model instruction, so a model or prompt change
can break it with no code change and no failing test. A pixel comparison between each generated asset and
its region in the composite is what would make it enforced. Until that exists: re-check by eye after any
change to the composite prompt or the image model.

### Where the spec-driven chain stands

Working end to end on 8x8, from the composer prompt: brief → specification → assets → composite, with
the spec patcher for revisions and "Re-render from spec" to rebuild. Image-first is now the legacy path,
kept for existing artifacts.

---

## 2026-07-29 — Retiring the inverted buttons on a spec-first design

Spec-first landed and worked. Brad: *"Do we need the run dev handoff or generate assets button any
more?"* — for a spec-first design, no, and keeping them is worse than clutter:

- **Transition to dev** re-derives the specification by *reading the composite*. On a spec-first design
  that overwrites an authored spec with a description of its own rendering — it re-inverts the artifact.
- **Generate assets** produces images the current composite was never built from. That is exactly the
  orphan-asset bug that started this whole thread.

Both still make sense on a legacy image-first design, so the answer is conditional, not deletion.

- `startDesignFromBrief` now records `metadata.origin = 'spec-first'`.
- The detail page derives `isSpecFirst` from that marker **or** from any asset carrying
  `generatedFromRequirement` provenance — the fallback catches designs made spec-first before the marker
  existed (Brad already has some), since that provenance only appears on images produced FROM a declared
  requirement and never on anything the old extractor made.
- Spec-first designs get **Re-render from spec** instead: `assets -> composite`, regenerating the images
  against the current requirements and rebuilding the design from them. That is the loop closer — revise
  the spec with the patcher, then re-render. Destructive to the current image, so it stays an explicit
  button rather than something the patcher triggers itself.

**Also fixed:** the brief was printed twice above the image, because `startDesignFromBrief` writes it to
BOTH `description` and the conversation history and the page rendered those as separate blocks. Now the
image comes first and a single "Brief" block sits below it — the design is what you came to look at.
Legacy artifacts, where description and last prompt genuinely differ, still show both.

---

## 2026-07-29 — Spec-first belongs on the composer prompt, not in the Library

I first put the "start from a brief" entry in the workbench's Library sidebar, reasoning that spec-first
is async across three cron stages and so does not fit a composer that renders an image inline. Brad:
*"This UI isn't what we were shooting for. Shoving all this in the library is weird. We have a big
prompt that should drive this."* Right — that was solving a UI problem by hiding the feature.

The composer's own card model already fit. `GeneratedImage` carries `status`, `stage` and `artifactId`,
so a spec-first run is just a pending card whose stage label advances:

  Writing the specification… → Generating the images it calls for… → Composing the design from those images…

Those labels are the product's claim made visible. A bare spinner would hide the only thing that
distinguishes this from prompt-to-image.

- The main prompt now runs **spec-first for a new design**; refining an existing image keeps the direct
  path, because that is editing a canvas rather than specifying a component.
- Driven by polling, not SSE — the stages run on the design-jobs cron, in different invocations from
  the request, so there is no connection to stream over. A dropped poll is not a failed run.
- A failed stage reports *which* stage failed. "Generation failed" for a spec that came back too thin
  to build from sends you looking in the wrong place.
- Removed the "attach a prompt image / layout guide / foundations before generating" guard. It only
  ever applied to a new design — which now returns earlier — and it no longer describes a real
  requirement: a brief plus the registry's own foundations is enough to specify from.

**Gotcha worth remembering:** the finished image comes back as a **private-Blob proxy path**
(`/api/handoff/artifact-asset?p=…`), not a data URL. It needs the app's `basePath` prefixed or the
canvas silently renders a broken image. `tsc` cannot catch this class of bug — the response shape was
also wrong on first write (`{ artifact: row }`, not `{ imageUrl }`) and only reading the route caught it.

---

## 2026-07-29 (later still) — Spec-first: the chain now runs the direction we claim

Branch `feature/spec-driven`. Brad, on a live 8x8 artifact: *"the generate assets button is kinda
similar to our extract asset button - it happens after. We're not building the component from the
generated assets, but we're generating the component first and the asset after."* Correct, and the
second complaint — the generated asset didn't match the component — turned out to be the same bug.

### The inversion, as the code actually had it

- `startDevPipeline` required an existing spec before assets could be planned, and the spec was written
  by **reading the composite screenshot**. So the only possible order for a new design was
  image -> spec -> assets.
- The `full` intent was `assets -> composite -> spec`, with spec **last** and a comment saying so
  deliberately: "so it describes what was actually produced." Composite as source, spec as report.
- The UI button sent `intent: 'assets-only'`, so the composite was never rebuilt from the new assets.
  They landed next to an image they had no part in producing — structurally the old extractor.

**Why that asset didn't match.** `asset-first-generation.ts` hands the model a 1x1 blank canvas on
purpose, and the only content it gets is `req.subject` — a one-line brief the spec prompt explicitly
strips of anything structural. No composite, no palette, no foundation sheet. The asset generator had
never seen the design. That is *correct* for asset-first (the asset defines the look, the composite is
assembled from it) and guaranteed-wrong for asset-after, where the asset must match an image it was
never shown. One root cause, two symptoms.

### What was built

- **`lib/spec/brief-spec.ts`** — writes a spec from the brief, no image. The model **authors** copy
  rather than transcribing it, so brand voice is an input here, not just a later check. Emits no
  `tokens`/`reuse`/`voice` — those are measurements, and nothing has been rendered to measure.
  `briefSpecProblems` rejects a thin spec up front, because a thin spec produces a thin design and the
  run looks successful right up until someone opens the image.
- **`generateSpecFromBrief`** in the spec generator, and `runQueuedSpecGeneration(..., { mode })` so the
  queue can pick a direction. Same claim, watchdog and failure handling either way.
- **`spec-first` intent** — `spec(brief) -> assets -> composite`. Assets/composite enqueue
  unconditionally: whether the design declares imagery is unknowable before the spec exists, and
  `runAssetsStage` already plans at run time and no-ops cleanly.
- **`startDesignFromBrief`** + `POST /api/handoff/ai/design-from-brief` + `handoff_design_from_brief` +
  a "Start from a brief" box in the workbench Library tab. The artifact is created **with no image** —
  that is the point, not an omission.
- **Two fidelity fixes the new order exposed.** The composite stage never attached the rasterized
  foundations sheet (measured earlier: 76% token overlap without it, exact with it) — in spec-first that
  stage IS the design's only image, so omitting it would have made the new path produce *worse* output
  than the one it replaces. And `buildAssetPrompt` now takes the registry palette, so an asset generated
  in isolation still reads as part of the system. Both are in `pipeline-stages.ts`.

### The most important line in the new prompt

`assetRequirements.subject` **is** the image-generation prompt, verbatim, and it is the only thing the
image model will ever see. In the image-first flow it described something that already existed and
nothing depended on its richness. Now it has to carry the whole art direction — subject, setting,
lighting, mood, colour direction, composition. "A team collaborating" produces generic stock imagery;
`briefSpecProblems` fails a subject under 40 characters rather than letting it surface later as a bad
photo.

**Verification state:** 228 unit tests pass (21 new); `tsc` clean; `next build` compiles and typechecks.
**Not verified end-to-end on 8x8** — no spec-first run has been executed against a real registry yet.
The open risk remains the one already documented: the composite model is *instructed* to place attached
assets rather than redraw them, and nothing enforces it. That instruction now carries the entire
guarantee, so it is the first thing to check on a live run.

---

## 2026-07-29 (later) — The spec patcher · one owner per spec queue · MCP response cap

Branch `feature/spec-driven`. Three debt items, in the order they were asked for.

### 1. Spec patcher — a tweak edits the specification, not the picture

This was the hole in the middle of the spec-driven loop. Until now a revision either re-rolled the whole
image or hand-edited markdown; nothing edited the *spec*, which meant the spec was an output rather than
a source of truth and "what changed and why" had no durable answer.

- `lib/spec/patch.ts` — pure layer (prompt, validation, merge), 22 tests.
- `lib/server/spec-patcher.ts` — the model call, then `diffSpecs` -> `recordSpecVersion` with the user's
  own words as the change reason.
- `handoff_revise_spec` (MCP) + `POST /api/handoff/ai/design-artifact/[id]/revise-spec` + a revise box in
  `DevHandoffPanel`. Exposed on all three surfaces deliberately — the last several rounds each ended with
  a capability that existed server-side and was unreachable in practice.

Three design decisions worth keeping:

- **Routing is the hard problem, not editing.** "Shorten the headline" is a spec change; "make it feel
  more premium" is art direction the spec cannot hold; "give the CTA more room" is genuinely ambiguous.
  `target` is first-class and `unsure` is a legitimate answer — the prompt says so explicitly, because a
  wrong silent edit is worse than a question.
- **Derived sections are stripped on the way out and rejected on the way back.** `tokens`, `reuse`,
  `voice` are measurements against the real design system. Letting a tweak rewrite them would let a user
  edit their own report card — "fix" a coverage score without touching the design.
- **Section-level replacement, not deep merge.** A deep merge makes removal impossible (dropping a form
  field would silently keep it), and "the complete new value for this section" is a rule a model can
  actually follow. Rejected sections are surfaced in the response, never dropped silently.

Applying does **not** regenerate the image. That stays a separate, explicit step.

### 2. Two queues were draining the same spec work

`spec_status = 'pending'` (the sentinel the cron scans, still how "Transition to dev" requests a spec)
and the `pipeline_job` spec stage both call `runQueuedSpecGeneration`. The cron schedule is every minute
and `maxDuration` is 300s, so **up to five invocations overlap** — a concurrent tick's sentinel drain
could steal the artifact in the window between the pipeline's spec stage setting `pending` and claiming
it. The stage then failed with "another worker holds it" *for a specification that had generated fine*.

- `artifactIdsWithPendingSpecStage()` — the sentinel drain now yields to the pipeline, which holds the
  authoritative claim.
- `runSpecStage` no longer treats a lost claim as failure. It checks the **outcome on the row**, because
  that's what actually matters; a lost claim with the spec still in flight hands the stage back for the
  next tick instead of burning retry budget on a race.
- `handleRetryExtraction` -> `handleTransitionToDev`. The PATCH it sends queues the whole handoff; the old
  name made the button and the handler look like different features.

### 3. MCP responses were up to 34 MB

Measured on 8x8: `list_design_artifacts` **34 MB**, `get_design_artifact` 6.7 MB, `get_design_job`
2.9 MB, `get_component_spec` 2.2 MB. Almost all of it base64 `data:` URIs — bytes a model can do nothing
with except pay for, and which evict the context the tool was called to provide.

`lib/mcp/payload.ts`, enforced in `textResult` — the single exit every tool returns through, so no tool
can regress and a new tool doesn't have to remember to bound itself. Two rules:

1. **No inline image bytes.** A `data:` URI becomes a descriptor (mime + size), so "there is a 1.2 MB
   PNG here" survives while the payload doesn't. Real references (`/api/handoff/artifact-asset?...`) are
   left untouched — that's how the model gets the actual bytes.
2. **A ceiling, honestly reported.** 256 KB default (`HANDOFF_MCP_MAX_RESPONSE_KB`). If stripping isn't
   enough it halves the longest array and **states the trim inside the payload**. Silent truncation is
   worse than a big response: a model that doesn't know a list was cut off answers confidently from the
   visible part. Records stay intact — trimming a list beats corrupting its entries.

Measured effect: a 20-artifact list carrying 300 KB images each (~6 MB) comes under the cap **by
stripping alone**, with all 20 artifacts still present. 16 tests.

**Verification state:** 207 unit tests pass; `tsc` clean; `next build` compiles and typechecks (the
prerender failure on `/foundations/_placeholder` is the missing local `DATABASE_URL`, not the change).
None of this is verified against 8x8 yet — the queue-race fix in particular only shows up under
concurrent cron ticks, which local runs don't reproduce.

---

## 2026-07-29 — Asset-first generation VALIDATED · the raster font chain · spec versioning

Branch `feature/spec-driven`. Three connected arcs; the third is the significant one.

### 1. The token sheet was never reaching MCP generation

`handoff_generate_design_image` hardcoded `foundationContext: { colors: [], typography: [], effects: [],
spacing: [] }`. `shouldRasterizeFoundations` returns **false** for four empty arrays and
`formatFoundationsBlock` emits nothing either — so **every MCP-initiated generation lost both the
rasterized colour/type/spacing sheet and the textual token block**, while UI-initiated generation kept
them. That reference sheet is what keeps the image model on-token. Fixed via a new
`buildFoundationContextFromRegistry()`. Measured before/after on an identical prompt: token overlap
went from 76% to "all correct" on the same design.

**Lesson recorded:** a round-trip experiment comparing spec-driven output against prompt-driven output
was **confounded** by this — the prompt path had the token sheet, the spec path didn't, and the gap got
attributed to the specification. Verify the two paths carry the same context before attributing a
quality difference to either.

### 2. The raster was teaching the model the wrong typeface

Registry fonts are pushed as *web* fonts (`subset-PPTelegraf-Regular.woff`), and raw WOFF was handed
to satori, which needs sfnt. satori falls back silently → specimens rendered in Inter → the model
copied Inter's letterforms → every generated design inherited them. Fingerprint: PP Telegraf resolved
to 26,584 bytes against Inter's 337,936.

- `lib/server/woff-to-sfnt.ts` unwraps WOFF (44-byte header + per-table zlib) with no new dependency.
  WOFF2 returns an explicit error — Brotli + transformed `glyf`/`loca` can't be unwrapped this way.
- `inspectSfnt()` verifies the tables a rasterizer needs and logs table count + outline type, warning
  loudly when unusable. 8x8 now reports `format=woff→sfnt, 53060 bytes, 17 tables, outlines=glyf`.
- Confirmed on 8x8: **fonts now correct in the raster.** The subsets did contain full Latin, so
  subsetting was never the issue — the container was. The byte-size subset heuristic is a bad proxy
  and should be deleted rather than tuned.
- ⚠️ **Regression I caused and fixed:** satori requires explicit `display: flex` on any element with
  more than one child. A `Letterforms — {family}` label had two, satori threw,
  `renderFoundationsImage` returned null, and `/debug-foundation-raster` fell to its JSON branch while
  `?generate=1` sent the 8×8 white-canvas fallback that OpenAI rejects. **Render the raster locally
  before pushing** — `renderFoundationsImage` runs fine under tsx; typechecking cannot catch this.

Also added: full letterform specimens (A–Z, a–z, numerals/punctuation) once per *weight* rather than
per token — the model was inferring most of the alphabet from a sample line containing no `j`, `q`,
`x`, `z` and one capital.

### 3. ⭐ Asset-first generation works — and placement held

The core bet: stop generating one flat composite and re-extracting crops from it (which was really an
image model *repainting* regions, forced to 1024², unfaithful). Instead the spec declares its imagery
and each asset is generated on its own, then the composite is assembled **from** those assets.

- `ComponentSpec.assetRequirements` — slot, kind, subject, aspect, minWidth, focalPoint, formats.
  Deliberately narrow: **only photographs and illustrations.** Flat backgrounds are tokens, states are
  CSS, icons resolve to the catalog, panels are components. The spec prompt says so explicitly.
- `lib/spec/asset-plan.ts` maps requirements to jobs: `3:2 → 1536x1024`, `16:9 → 2048x1152`,
  `2:3 → 1024x1536`, and a 3:2 slot needing >1536px is bumped wider — over-delivering pixels is
  recoverable by cropping, under-delivering is not. 16 tests.
- The asset prompt's constraints are load-bearing: ask for "a hero photo" and a model returns *a
  mockup of a hero section*. Explicitly forbids text, UI elements, collage.
- `lib/server/asset-first-generation.ts` generates assets concurrently, converts them to the
  `attachedImages` + `attachedImageLabels` pair (which puts the worker on its `designerAssembled` path,
  skipping the iteration base), and writes them into `artifact.assets[]` with provenance.

**Live result (local, real API):** asset returned at **exactly 1536×1024** — clean photograph, no
text, no UI, subject center-right as declared. The composite then **placed it rather than redrawing
it**: same subject, pose, garment, watch, notebook, plant and chair, cropped to the column. Copy came
through verbatim with **zero invention** (the composite-first path had fabricated a webinar date).
Tokens and typeface both correct.

**Caveats, stated because they are unresolved:** n=1, and image models are stochastic — placement
holding once is not proof it always will. And "same photograph" was a visual judgement between two
renders, not a pixel diff; a real check compares the asset against its cropped region in the composite.

**Architectural consequence — now a hard requirement, not a preference.** Asset generation took 114s
and the composite 100s. ~215s for one design *before* spec generation, so asset-first **cannot** share
a single 300s invocation. The job-queue-per-stage model in `docs/WORKBENCH-STRATEGY.md` §9 is a
prerequisite for this path, not an optimization.

### Also on this branch

Spec version history with semantic diffs (`0025_design_spec_version.sql`, `lib/spec/diff.ts`,
`lib/spec/versioning.ts`) — verified writing on 8x8 (`version 1 | generated | ["Initial
specification."]`). Round-trip fidelity harness (`lib/spec/generation-prompt.ts`,
`lib/spec/fidelity.ts`). Round-trip finding that still stands: **props overlap 0%** between a spec and
the spec re-derived from its own regenerated design — prop inference from a picture is arbitrary, so
the component API must come from the component being composed against, not from re-reading pixels.

---

## 2026-07-28 (later still) — "Transition to Dev": unified handoff + reuse/token/voice spec sections

Rationalized asset extraction and spec generation into **one** operation, exposed as
`handoff_transition_to_dev`, and grew the spec to answer the three questions a developer actually
has. tsc clean (root + `src/app`); 108/108 tests; `build:registry` compiles clean. Uncommitted.

**Why the split was the bug, not just untidy.** Extraction and spec were two pipelines, two
statuses, two pollers, two failure surfaces — and nothing ever asked *"is this design ready for
dev?"*. Symptom, observed on the **local dev DB** (`HANDOFF_APP_URL=http://localhost:3000`, the
`DATABASE_URL` in the repo `.env` — ⚠️ **not** the 8x8 registry; see the correction note below):
`spec_status` is `none` on all 18 artifacts there, i.e. it has never once succeeded *in that
environment*. Diagnosis: the wiring landed 2026-06-10 (`1471a909`) and three artifacts postdate it
with assets `done` and spec `none`, so it never reached its first status write; the only exit before
that point was the `HANDOFF_AI_API_KEY` guard, which used to `return` **silently** — no log, no
status, no error. Which cause fired is now unknowable from the data, and *that* is the real defect.
(Ruled out by inspection: `updateDesignArtifactById` does handle `specStatus` — `queries.ts:621` —
the `as Parameters<…>` casts at the call sites are just noise.)

> ⚠️ **Correction (same day).** Every DB-derived observation in this entry and the one below came
> from the **local dev** Neon DB in the repo `.env`, not from the 8x8 registry
> (`https://8x8-handoff.vercel.app`). The local DB's design workspace happens to hold 8x8-flavoured
> brand content, which is what made the mistake easy to miss. The 8x8 registry — read properly via
> its MCP endpoint — is a **different and much richer** environment: **79 components** in coherent
> groups (11 heroes, incl. a `hero-form` with an embedded public form slot), stack profile
> `bootstrap-handlebars` (Handlebars + Bootstrap 5 + SCSS `var(--color-*)`, **not** React), and a
> brand voice whose rules differ from the local copy (headlines **3–8** words, CTAs **2–5**, and a
> different avoid-list). The local DB has 9 junk components and two *Intralinks* demo patterns —
> none of that is 8x8. **Rule: read a registry through its MCP/REST endpoint. The repo `.env`
> describes localhost only.** Code-level findings in these entries are unaffected — they came from
> reading source, not the DB.

**Unification.**
- `lib/server/dev-handoff.ts` — `runDevHandoff()` sequences extraction → spec with one error
  surface (never throws; forces a terminal `specStatus` if spec generation throws past its own
  catch). `deriveDevHandoffStatus()` collapses the two columns into one
  `{stage, running, progress, label, error, warning}`. **Derived, not a third column** — no
  migration, nothing new to drift. Stages: `not_started → extracting_assets → generating_spec →
  ready | failed`. A `done` spec is `ready` even if extraction failed (spec falls back to the
  original image) — that degradation surfaces as `warning`, not failure.
- `design-asset-schedule.ts` now just schedules `runDevHandoff`, so **every** entry point (HTTP
  route, MCP tools, lifecycle review/approved) is identical by construction.
- `markDevHandoffQueued()` resets both statuses and clears stale errors *synchronously*, so a
  poller can't catch a stale `ready` from the previous run. Wired into the PATCH route and
  `set_design_status` — the latter previously skipped extraction entirely, since extraction only
  claims rows already in `pending`.
- MCP: `handoff_transition_to_dev` (new); `handoff_extract_design_assets` kept as a deprecated
  alias forwarding to it. `handoff_get_design_artifact` and the status poll route both now return
  `devHandoff`, so UI and MCP can't disagree about the stage.
- `maxDuration = 300` on the MCP route (it schedules `after()` work and was inheriting a default).

**Spec grew three sections** (all optional — older specs render fewer sections, nothing breaks):
- **`reuse`** ⭐ — *"what could I build this FROM"*, matched against the full component + pattern
  catalog via a new light `loadReuseCatalog()`. This is the workbench/playground counterweight made
  machine-readable: composition score, per-part component candidates, patterns that already cover
  the layout, and a compose-vs-build-new recommendation. Distinct from
  `implementation.existingComponentMatches`, which answers "which component IS this" with full prop
  mappings but **only fires when component guides were attached up front** — so in practice it was
  usually empty. The prompt is explicitly biased toward composition and forbidden from inventing ids.
- **`tokens`** — every observed colour/type/spacing/radius value matched against the registry's real
  tokens (`design-token-summary.ts`, capped at 60/group), with `exact|close|none` and a coverage
  score. Prompt hard-rule: never invent a token name; an honest "off-system" beats a false match.
  Spacing/radius come from DTCG (`getDtcgTokenStrings(...).dtcg`, parsed — it returns serialized
  formats, not a map) and legitimately come back empty on registries without them.
- **`voice`** — per-string pass/warn/fail against the workspace brand voice, with the banned-phrase
  list checked literally. Closes the loop with the demo's opening beat.
- Also fixed: `designMd` was **hardcoded to `''`** at the spec call site, so the team's design
  guidelines never reached the spec at all.

**View** — `components/Design/DevHandoffPanel.tsx`, demo-grade. Order is the opinion: reuse first
(with links straight into the playground / component pages), then assets on a transparency
checkerboard, then token swatches with off-system values in red, then voice findings. Raw editable
markdown moves behind a disclosure. One `DevHandoffProgress` stage bar replaces the two independent
status banners. Sidebar action is now **"Transition to dev"** and routes through the unified path.
Client-side status derivation mirrors the server (duplicated, not imported — `dev-handoff.ts` is
`server-only`).

**Still open:** none of this is verified against a live run. Spec generation has never succeeded on
the **local dev** DB; its state on the 8x8 registry is **unknown and still to be checked** — that's
pre-flight #1 in `docs/DEMO-8X8-WORKBENCH.md`. `handoff_resource_grant` remains read-only everywhere
(no insert path anywhere in the codebase).

**MCP payload hazard found while reading the real registry:** `handoff_get_component('hero-form')`
returns **513KB** even on the "slimmed" path (the slimming drops `sharedStyles`/validation/Figma
metadata but keeps `css`, `code`, `html`, `sass`, `previews`, `entries`). `rate-card-app` returns
53KB. A demo where Claude calls `get_component` on a real 8x8 block risks blowing the context
window mid-conversation. Needs a hard size cap or a `fields`-style projection before the surface is
safe to lean on. Also noted: `rate-card-app` ships with **0 properties**, so contract coverage
across the 8x8 library is uneven — reuse-match quality will vary by component.

---

## 2026-07-28 (later) — Terminal-state guarantee for design-artifact background jobs (8x8 demo hardening)

Pre-demo hardening pass on the MCP→workbench path (8x8 demo Thu 2026-07-30). Closes the long-open
"hanging build jobs" item (`_control/tasks/2026-07-21-handoff-build-jobs-image-extraction.md`).
tsc clean (root + `src/app`); 108/108 unit tests.

**Root cause (confirmed, not theorized).** `claimDesignArtifactForExtraction` flips the row to
`extracting`, and *only* `finalizeDesignArtifactExtraction` moves it to a terminal state. Both
extraction and spec generation run inside `next/server` `after()` callbacks, which are bounded by
the serverless invocation. If the function dies between claim and finalize — timeout, instance
recycle, deploy — nothing else ever touches the row. Process death is not catchable in-process, so
no amount of `try/catch` inside the extractor can fix it. There was also **no reaper**:
`queries.ts` only ever *read* pending/extracting rows.

This is exactly the risk the `create-server.ts` NOTE flagged and left unverified: *"verify live that
extraction actually runs in-cloud. If after() proves unreliable here, promote this to the design-jobs
cron."* Rather than moving extraction wholesale to the cron (which would add up-to-60s latency to the
demo's happy path), the fix keeps `after()` as the fast path and puts a safety net under it.

**Changes:**
- **Watchdog** (`design-asset-extractor.ts`) — `runDesignAssetExtractionForArtifact` now races
  extraction against a 240s ceiling (mirrors the existing Figma-fetch bound) and finalizes `failed`
  on timeout, so the row goes terminal *before* the invocation is torn down. The race loser can't be
  cancelled; if it later resolves it overwrites `failed` with real results — better data, not
  corruption. Noted inline.
- **Reaper** (`queries.ts` `reapStuckDesignArtifactJobs`) — sweeps rows whose `updated_at` is older
  than 15 min and whose `assets_status ∈ {pending,extracting}` or `spec_status ∈ {pending,generating}`
  into `failed`, flipping *only* the status that's actually stuck. Wired into the existing
  every-minute `/api/handoff/ai/design-jobs/run` cron (`maxDuration=300`, already `CRON_SECRET`-gated),
  before the drain and inside its own try/catch so a reap failure can't block job processing. No new
  infrastructure. Also cleans up pre-existing stranded rows, not just new ones.
- **Second stranding path found + fixed** (`design-spec-generator.ts`) — `generateSpecForArtifact`
  returned *silently* when `HANDOFF_AI_API_KEY` was unset, but callers set `specStatus:'pending'`
  **before** scheduling it (`design-artifact/route.ts:252`, `create-server.ts:874`). Result: row spins
  on `pending` forever with no reason surfaced. Now writes `failed` + `metadata.specError`.
- **Latent bug** — `killDesignAssetExtractionJob` wrote its reason to `metadata.assetsError`, but the
  detail page and Builds board read `metadata.assetsExtractionError` (`assetsExtractionErrorFromMetadata`).
  Admin-killed jobs showed as failed with no explanation. Now writes the key the UI actually reads.
- **`maxDuration = 300`** declared on `api/handoff/ai/design-artifact` and `api/mcp` — both schedule
  `after()` work and were inheriting a default that could strand a job mid-flight. MCP-initiated jobs
  now get the same budget UI-initiated ones do.

**Live DB observations** (read-only scan, the Neon DB in local `.env` — 18 artifacts, 2 patterns):
- **0 currently-stranded rows.** The hang is intermittent, not chronic — lower standing risk than the
  backlog item implied, but unbounded when it does happen, which is what the above fixes.
- 4 failed extractions, all from **June** (06-03, 06-23); 3 recorded no error at all. Extraction has
  been healthy since. The one recorded reason: *"All extracted assets failed vision validation."*
- ⚠️ **`spec_status = 'none'` on all 18 rows** — spec generation has never completed on this DB. Means
  `handoff_get_component_spec` returns nothing for every existing artifact. Needs a live check before
  the demo if the spec path is on the script.

**Demo-visibility data pass** — new `scripts/set-demo-visibility.ts` (dry-run by default,
`--apply` to write, `--visibility=team|public`, `--owner=`, `--include-patterns`). Deliberately **not**
a migration: migrations auto-run on boot for *every* registry deployment, and flipping visibility is a
per-tenant data decision — baking it into 0025 would silently expose private rows on SSC and every
other tenant. Dry run against the local-`.env` DB reports 17 artifacts + 2 patterns would move
`private → team`. **Not applied — awaiting confirmation of which DB that is.**

**Worth knowing:** admins bypass the whole problem — `designArtifactLaneClause` returns every row for
`isAdmin` (`grant-queries.ts:142`). The empty Team/Public lanes only bite on a non-admin account, so
the data pass matters only if the demo runs as a normal user.

---

## 2026-07-28 — Workbench/Playground: perf hardening + multiuser (Phase A/B) + unified Library lander

Big arc across the workbench (`/design` → design artifacts) and playground (`/playground` → patterns).
Full spec + per-phase status: **`docs/WORKBENCH-PLAYGROUND-ROADMAP.md`**. Phase B UX approved via an
interactive mockup (artifact: `claude.ai/code/artifact/9db33798-b2b7-4546-b5dc-baecb64ffd5b`).
**Frontend UX refinement now owned by Natko.**

**Part 1 — performance (root cause: base64 images stored inline in Postgres JSONB, then `SELECT *`).**
- Phase 0: perf indexes (`0023_perf_indexes.sql`), light list/status projections for design artifacts,
  single-row `getPattern` (was full-scan+`.find()`), pooler-safe `getDb()` (`prepare:false`+timeouts),
  playground `bulkAddComponents` parallelized. Verified on 8x8 — resolved the slowness.
- Phase 1: images → **Vercel Blob** (`lib/storage/artifact-images.ts`, `offloadArtifactImages` wired into
  all 4 artifact write fns; graceful passthrough when `BLOB_READ_WRITE_TOKEN` unset). Admin resumable
  backfill route `POST /api/handoff/admin/backfill-artifact-blobs`. Blob store must be created +
  `vercel env pull` per deployment (done on 8x8).

  > ⚠️ **CORRECTION (2026-07-29).** This entry originally read "Serving = **public unguessable URLs**
  > (not private/proxy)". **That is wrong.** The decision was **private stores**, and 8x8's store is
  > configured private. `offloadDataUrl` hardcodes `put(..., { access: 'public' })`, so every offload
  > on 8x8 fails with *"Cannot use public access on a private store"* — and because the catch
  > swallows it and returns the inline data URL, **no artifact image has ever reached Blob there.**
  > That is the source of the 3.2MB-per-field rows (imageUrl + a duplicate inside
  > conversationHistory = ~6.4MB), the ~90s of row I/O inside the handoff invocation, and the
  > oversized MCP payloads. Fixing it is not a one-liner: private blobs need
  > `get(pathname, { access: 'private' })` server-side, so the stored reference is no longer a
  > browser-usable URL and every consumer changes —
  > the workbench, the detail page, share pages, `imageUrlToVisionPart`, `imageUrlToEditInput`.
  > Scoped but not yet sequenced.
- Phase 2: cursor pagination on Library list; bounded sync feed (`fetchSyncChangesSince` `hasMore`/
  `nextCursor`, `version=hasMore?nextCursor:latest` so clients never skip the tail); driver decision
  **ADR-003** (stay on postgres-js; Fluid Compute keeps the pool warm). 2.5 light component variant +
  2.6 retention/rollup for `sync_event`/`event_log` still open.

**Part 2 — multiuser (tenancy = team within one deployment; per-user ownership + team sharing, NO org).**
- Phase A (authz): `lib/authz/policy.ts` — enforce ownership INSIDE the shared write core
  (`patchPattern`/`removePattern` — owner or admin; null-owner=team-editable) so both UI + MCP paths are
  covered. NOTE: CLI/registry sync-replication writes patterns directly (not via the core), so it's
  unaffected. `role` threaded onto `PatternWriteActor`.
- Phase B (sharing & visibility): migration `0024_phase_b_visibility.sql` (visibility+status cols;
  `handoff_resource_grant` + `handoff_share_link` tables). `computePermissions()` +
  `attachPermissions()`; client-safe vocab in `lib/authz/vocab.ts` (policy re-exports — client imports
  vocab, NOT server-only policy). `lib/db/grant-queries.ts`: lane-filtered SQL lists (`?lane=yours|shared|
  team|public`), bulk grant resolution. Routes stamp per-row `permissions`+`owner`+`isMe`+`visibility`+
  `status`. Setters: `setPatternMeta` + artifact PATCH (`approved` = maintainer-gated). Share links +
  public `share/[token]` route (safe subset — no base64/PII). UI primitives in `components/library/*`
  (Tailwind v4 + shadcn/ui, driven by `permissions`). Both surfaces cut over to lane endpoints (default
  "Yours"). Existing rows defaulted `private`/`draft` (data disposable), so "Team" lane looks sparse until
  visibility is set — expected, not a bug.

**Unified Library lander (`/library`) + full-bleed consistency pass.**
- New route `app/library/` = the **home of the Tools nav** (`MainNav` "Tools" → `/library`; Library first
  in the sub-nav; `/library` in all 3 `TOOLS_PATHS`). Unified grid over designs+patterns
  (`components/library/AssetCard.tsx`): type facet, lane tabs, search, launches into both builders.
- Full-bleed builder shell (sidebar facets + scrolling grid) applied to `/library` AND the saved-design
  detail page (`design/library/[id]/SavedDesignDetailClient.tsx`) so the whole Tools section is consistent.

**Tail CLOSED this session (backend + the two contained UI bits):** ✅ true artifact clone
(`POST /api/handoff/ai/design-artifact/[id]/clone` — design "Duplicate" now makes an owned copy, not
open-in-workbench); ✅ cross-type "Load more" pagination on `/library` (per-type cursors, `// TODO`
removed); ✅ public share-viewer page `app/s/[token]` (safe subset, `noindex`; share URLs now point here,
not the JSON endpoint); ✅ one-pass visibility+publicAccess PATCH (was 2 calls); ✅ "fetch existing share
link" `GET /api/handoff/share?resourceType&resourceId` (inspector shows a prior link on open). Also fixed a
latent bug: `insertDesignArtifact` was dropping `visibility`/`componentSpec`/`specStatus` in its insert.

**Left for Natko / next (deliberately not done):** folders/collections + tags + bulk actions (net-new
feature — new taxonomy data model + bulk-select UI, wants its own design pass); rest of Phase C — C.1
create/rename/draft-vs-published lifecycle, C.3 concurrency safety (optimistic-lock + conflict UI), C.4
attribution/activity feed; Phase D outbound export (Jira/Asana/CMS/Figma); Part 3 CLI installer (deferred,
low on backlog). ⚠️ If an MCP visibility/status setter is added, put the `approved` gate in the shared write
core (today it lives in the `setPatternMeta` server action).

---

## 2026-07-23 — Idempotent fonts mkdir + diagnosis of `public/api` EEXIST build race

**Reported bug (from ssc-handoff).** `handoff-app build:app` exits 1 during doc
assembly with `EEXIST: mkdir '.../.handoff/<id>/public/api'`.

**Diagnosis.** All `public/api` dir creations in the current source *and* the
published `1.2.2-7` dist already use `fs.mkdirSync(..., { recursive: true })` /
`fs-extra.ensureDir` — recursive does not throw EEXIST on an existing leaf, so a
missing flag is **not** the cause. Reproduced in ssc-handoff: the EEXIST (and
sibling `ENOENT chmod` / `ENOENT copyfile` variants) only occurred while a
`handoff-app start` dev server was running concurrently against the **same**
`node_modules/handoff-app/.handoff/<projectId>/` working dir. The build's
`syncPublicFiles` → `mirrorDirectory` (`fs.remove` + `ensureDir` + `copy`) races
the dev server regenerating `public/api` → TOCTOU inside fs-extra. Stopping the dev
server and cleaning `.handoff` → `npm run build` exits **0** deterministically.

**Fix applied.** Hardened the one genuine non-idempotent mkdir in the build:app
path: `src/pipeline/styles.ts` `buildCustomFonts` used a TOCTOU
`if (!existsSync) mkdirSync(fontsFolder)` (non-recursive, inside a `Promise.all`
over font families — can EEXIST on parallel families or a re-invoked build, and
ENOENT if the parent is missing). Replaced with
`fs.mkdirSync(fontsFolder, { recursive: true })`. Compiles clean (`npm run build`).

**Follow-up worth considering.** build:app and a running `start` dev server share
one `.handoff/<projectId>` working dir; concurrent use will keep racing on
`public/api` regardless of per-call mkdir flags. Isolating the working dir per
process (or serializing) would remove the class of error.

## 2026-07-21 — Neon compute reduction: cache the registry read hot-path + fix idle polling

**Problem.** 8x8-handoff burned ~119 CU-hrs since Jul 1 on developer-only traffic.
119.37 CU-hrs / ~20 days ≈ **0.24 CU sustained 24/7** — i.e. the compute endpoint
was essentially never auto-suspending. Root cause was two-fold: (1) every registry
request re-ran the root layout, which fired ~5–8 **uncached** Postgres reads
(registry config, nav tree, component summaries, user count) + per-page content
reads; and (2) a forgotten-open `/admin/builds` tab polled every 12s forever,
pinning compute awake. React `cache()` only dedupes within one render — there was
no cross-request caching.

**Key insight.** The CU cost is DB *query volume*, not Vercel render mode. Wrapping
the hot-path reads in Next's Data Cache means cache hits do **zero** Postgres work
regardless of request volume → Neon can idle between real content changes. No risky
layout/auth refactor needed (that would only help Vercel function compute, not Neon).

**Changes (B/C/D):**
- **C — cache the read hot-path.** New `src/app/lib/server/registry-cache.ts`:
  `unstable_cache` wrappers (tags + 300s TTL floor) for registry config, navigation,
  component summaries, user count (3600s), and per-slug page content. Wired into
  `runtime-config.ts` (config), `dynamic-provider.ts` (nav + summaries — Data Cache
  layered *under* the existing React `cache`), `app/layout.tsx` (user count), and the
  public catch-all routes `app/[...slug]` + `app/foundations/[...slug]` (page body +
  generateMetadata). **Freshness** via `revalidateTag(..., 'max')` on every write
  path: `/api/registry/config`, `/api/registry/navigation`, `/api/registry/pages`,
  `/api/sync/upload` (component/page changes), and `setup/actions.ts` (user create).
  The 300s TTL is a safety net if a write path is missed.
- **D** is folded into C — the per-slug page cache is the real "ISR" win. Note: the
  root layout reads cookies (`auth()`) + `headers()`, so pages stay dynamically
  rendered; route-level `revalidate` can't make them static HTML. That's a
  Vercel-compute optimization, **not** a Neon one, so deliberately deferred.
- **B — stop idle polling.** `admin/builds/BuildsClient.tsx`: poll 4s while a job is
  active, 15s when idle but **stop after ~5 min** of no activity, and **pause when the
  tab is hidden** (resume + refresh on `visibilitychange`). Kills the forgotten-tab
  keep-awake.

**Gotchas.**
- Next 16.2.4 `revalidateTag(tag, profile)` now *requires* the 2nd arg — use `'max'`.
  `unstable_cache` (not `"use cache"`) is correct here since `cacheComponents`/
  `dynamicIO` is off in `next.config.mjs`.
- `getCachedPageBySlug` guards on `usePostgres()` and falls back to the raw read in
  workspace mode, so the no-DB filesystem path stays byte-identical.
- Cached wrappers must never read `headers()`/`cookies()` (they don't — DB only).
- Mutation/admin routes still call the raw `registry-queries` fns so they see fresh data.

tsc clean on all changed files (2 remaining errors are pre-existing in `lib/mcp/`).
**Not yet verified against a live DB** — needs a run pointed at a dev/8x8 database to
confirm cache hits + tag invalidation on push. Data to watch afterward: Neon activity
graph should go spiky (idle between pushes) instead of flat; enable `pg_stat_statements`
to confirm the config/nav/summaries reads drop off the top-`calls` list.

**Follow-up spun off:** build jobs (esp. workbench image/asset extraction) get stuck
non-terminal → `_control/tasks/2026-07-21-handoff-build-jobs-image-extraction.md`.

---

## 2026-07-16 — figma-plugin API: CORS fix + contract alignment to the plugin spec

Reviewed `handoff-figma-plugin/docs/p1.6-figma-plugin-api-spec.md` (the plugin is built against it).
Two classes of fix — the CORS blocker, plus the route shapes (the plugin expects shapes that
differ from what P1.6c first shipped). tsc clean; 108/108 tests; verified over HTTP against
`next dev` (spec §6 checklist a/b/c all pass).

**CORS (spec §1–2) — `src/app/proxy.ts` + `next.config.mjs`:**
- The plugin UI runs in a sandboxed iframe (`Origin: null` desktop / `figma.com` web) — all calls
  cross-origin; a missing CORS header shows as an opaque `Failed to fetch`. Added a `/api/figma-plugin/*`
  branch in `proxy.ts` that answers `OPTIONS` preflight with `204` + CORS **before any auth**, and
  stamps CORS (`Allow-Origin: *`, `Allow-Methods: GET,POST,DELETE,OPTIONS`, `Allow-Headers:
  Authorization, Content-Type`, `Max-Age: 86400`) on `next()` so it merges onto every route
  response **including errors** (401/410/500). No `Allow-Credentials` (Bearer-only, wildcard-safe).
- **Trailing slash:** the app runs `trailingSlash: true`, which 308-redirected the plugin's no-slash
  POSTs (a cross-origin 308 re-triggers preflight and drops the body). Next fires that redirect
  **before** middleware, so proxy.ts can't intercept it, and Next has no per-path trailingSlash →
  set **`skipTrailingSlashRedirect: true`** app-wide. Pages/routes now serve both `/foo` and `/foo/`
  without redirecting (canonical link generation via `trailingSlash: true` is unchanged). Verified
  pages still 200 at both forms.

**Contract alignment (spec §4) — the routes now match what the plugin sends/expects:**
- `auth/device` → **camelCase** `DeviceCodeResponse { deviceCode, userCode, verificationUrl, expiresIn, interval }`.
- `auth/token` → body `{ deviceCode }`; **poll-status** `TokenPollResponse`: `{status:"pending"}` |
  `{status:"approved", token, scopes[], user}`; **`410`** on expiry. (Extended `exchangeCliDeviceCode`
  to also return `scopes` + `user` — additive, `/api/oauth/token` unaffected.)
- `auth/revoke` → **`DELETE` → `204`** (was POST). Stateless JWT, best-effort.
- `foundations/preview` → response is now `{ changeset: Dtcg.DtcgChangeset, diagnostics }` (the full
  changeset incl. `next` with syncState + axes; dropped the separate source/axes/mappingUsed fields).
- `foundations/commit` → **body is now `{ snapshot, mapping }`** (same as preview, not `{ source }`).
  Curation is expressed entirely through `mapping`; the server **recomputes** the source
  deterministically (`buildDtcgSourceFromFigmaSnapshot`) rather than trusting a client tree, then
  persists + diffs. Response `{ ok, committedAt, committed:{added,modified,removed} }`.

Note for the plugin team: this supersedes the P1.6c contract shapes in the entry below — the shapes
above are current. Device/token need a live DB to exercise end-to-end (device-session storage); CORS,
no-redirect, error-CORS, preview shape, and revoke were all driven over HTTP here.

---

## 2026-07-16 — P1.6a–d built (storage · resolve/serve · figma-plugin routes · viz)

All four sub-phases implemented on `feature/mcp-prototype` against `handoff-core@feature/
multi-axis-theming` (linked `file:../handoff-core`). Changes left in the working tree for review
(not committed — Profile A hard rule). tsc clean (0 errors); 108/108 unit tests pass; each
route/query/UI driven end-to-end (details below).

### P1.6a — storage & migration
- **Migration `0022_dtcg_source.sql`** (+ journal `idx 22`): adds two additive columns to
  `handoff_registry_dtcg` — `dtcg_source jsonb` (a `Types.DtcgSource`: reference-preserving tree
  + `axes[]`, leaves keep `{group.path}` aliases unresolved and carry `$extensions.handoff.
  {originalId,syncState}`) and `axis_mapping jsonb` (team-shared `Dtcg.AxisMappingConfig`).
  Both default `'{}'`; **no forced re-ingest** — existing registries keep serving precompiled
  bytes until they re-push with references. Hot `theme.css` path untouched (ADR-001 §2).
- `schema-pg.ts`: `dtcgSource` + `axisMapping` columns. `registry-queries.ts`: `RegistryDtcgPayload`
  gains both (optional); **`upsertRegistryDtcg` is now partial-safe** — only provided columns are
  written, so a token-only push never clobbers `dtcg_source` and a figma commit never clobbers the
  precompiled bytes. New helpers: `getDtcgSource()`, `getAxisMappingConfig()`, `insertDtcgTokenChange()`.
- **`lib/dtcg-axes.ts`** (new) — the axis interpretation layer: `asDtcgSource` (narrows/rejects
  empty `{}`), `schemeValues`/`axisValues`/`getAxis`, `toAxisAwareBrands` (legacy flat brand tree
  reads as scheme `"default"`; scheme-nested `{scheme:tree}` preserved), `resolveSelector`,
  `buildResolvedBrandsCache` (brand×scheme resolved cache).

### P1.6b — resolve + query (REST & MCP)
- **`GET /api/registry/dtcg`**: no params → full payload (back-compat). Any generic axis param
  (`?brand=&scheme=&…`) → `Dtcg.resolveTokens(source, selector)` literal tree; `?format=css|scss|
  map|style-dictionary` → `Dtcg.resolveAndFormat`. Uses the data provider's source (graceful
  `tokens:null` note when a registry has none). Unknown axes ignored; unspecified → axis defaults.
- **Provider**: `DataProvider.getDtcgSource()` added — dynamic reads `dtcg_source`, static reads
  `design-system/dist/dtcg/tokens.source.json` (emitted by handoff-core P1.5), Hybrid inherits.
- **MCP**: `handoff_get_tokens` + `handoff_export_design_md` gain `{ brand?, scheme? }`. The
  response advertises `axes`; a selector attaches resolved `axisTokens` (color/typography/effect).
  `collectFoundationTokens` threads the selector; export_design_md frames the brief on the resolved theme.
- **`dtcg-normalizer.ts`**: opt-in `carryAxisProvenance` stops the first-seen-wins cross-brand
  collapse and stamps `brand`/`scheme` (default off = byte-identical single-axis behavior). New
  `normalizeDtcgMatrix(brand×scheme)` normalizes each cell independently for the viz.

### P1.6c — `/api/figma-plugin/*` (the plugin contract)
Auth: **`verifyHandoffApiAuth(request, { requireScopes: ['figma:sync'] })`** — this is the
HTTP-route scope gate (mcp-auth.ts); `verifySyncAuth` returns no scopes so it can't enforce
`figma:sync`. **`authOrCloudToken` retired on the Figma path.** In registry mode a JWT must carry
`figma:sync` (admin-only via `scopesForRole`) or the legacy secret grants it; workspace mode stays
locally trusted.
- `auth/device` · `auth/token` · `auth/revoke` — map onto `cli-device-oauth` (device → token gains
  `figma:sync` when an admin approves at `/cli/device`). Revoke is best-effort (stateless JWTs).
- `foundations/preview` — body `{ snapshot: FigmaFoundationsSnapshot, mapping?: AxisMappingConfig }`
  (mapping defaults to the saved team config). Runs `buildDtcgSourceFromFigmaSnapshot` →
  `diffDtcgSource(next, stored)`. **No writes.** Returns `{ changeset:{added,modified,removed,
  unchanged}, source (syncState-stamped, references preserved in $valuesByAxis), axes, diagnostics,
  mappingUsed }`.
- `foundations/commit` — body `{ source: DtcgSource, mapping?, message? }`. Persists `dtcg_source` +
  `axis_mapping`, precomputes the resolved `brands` cache, appends `handoff_token_change`. Returns
  `{ ok, counts }`.
- `GET foundations?brand=&scheme=` — resolved slice for pull-to-canvas (later milestone).

**Plugin contract note:** `preview.source` leaves carry `$valuesByAxis` keyed `"scheme=light"` /
`"brand=resolvet;scheme=dark"` with references **unresolved** (`{color.gray.50}`), plus
`$extensions.handoff.{originalId,syncState,tier,scopes}`. The plugin curate UI renders the
changeset (not the source dump) and posts the curated `source` back to `commit`.

### P1.6d — visualization
`ColorsDisplay` gains a **scheme toggle** beside the brand switcher (BRAND × SCHEME). When a source
with a scheme axis exists, the colors page builds a `normalizeDtcgMatrix(buildResolvedBrandsCache
(source))` color matrix and passes it in; switching either axis re-resolves the semantic tokens
(verified: dark flips Surface `#fafafa`→`#121212` / Text inverse; Hagyard flips Primary
`#048bbb`→`#8b0050`, composing independently). No source → the existing single-axis CSS-brands path
is untouched.

### Gotchas / notes
- **`handoff-core` must be a real copy in `node_modules`, not a symlink.** `file:../handoff-core`
  installs a symlink to a sibling *outside* the app repo; Turbopack's root is the app repo and
  refuses to resolve it (runtime value imports of `handoff-core` — new here — fail; type-only
  imports were fine because they erase). Fix: `npm install handoff-core@file:../handoff-core
  **--install-links**` (materializes a real copy). Re-run after editing the core, or switch to the
  git-branch pin. This affects the real `next build` too, not just dev.
- **Verification without a DB:** no local Postgres here, so the migration wasn't applied (it
  auto-runs on boot in any real deploy; SQL is idempotent `ADD COLUMN IF NOT EXISTS`). Substantive
  logic driven via `handoff-core` + the app helpers end-to-end (scratchpad `verify-p16*.ts`), and
  the routes driven over real HTTP against `next dev` in workspace mode (`HANDOFF_SYNC_SECRET` set
  to engage auth): preview 200 with references-preserved changeset, `figma:sync` 401 without token,
  axis GET resolves, colors page brand×scheme toggles confirmed in-browser.

---

## 2026-07-16 — P1.6 of the Figma-sync initiative — working on `feature/mcp-prototype` directly

Downstream of handoff-core P1 (the `Dtcg.*` engine, on `handoff-core@feature/multi-axis-theming`,
pushed). **Decision (Brad):** no sub-branch — do P1.6 directly on `feature/mcp-prototype`, the
active integration branch. (An earlier `feature/multi-axis-theming` branch here was deleted; it
was content-identical to `mcp-prototype`, so nothing was lost.) P1.6 adds the app side:
axis-aware DTCG storage + migration, `originalId`/`syncState` persistence, the `resolveTokens`
resolver on the query/viz path (hybrid — hot `theme.css` stays precompiled), brand×scheme REST/
MCP query params + visualization, and the `/api/figma-plugin/*` routes (with `figma:sync`
enforcement) the plugin consumes.

Full spec + sub-sequencing (P1.6a–d) in
[`docs/p1-6-kickoff-multi-axis-theming.md`](docs/p1-6-kickoff-multi-axis-theming.md); parent
design is RFC-001 in `handoff-figma-plugin`.

**Dependency (settled):** the `^0.2.0` pin is a non-issue — `0.2.0` was a re-release of a
corrupted `0.1.0`, no divergent code. This work lands as a fresh **`0.3.0`**; correctness comes
from testing app + plugin against the branch, not matching the old pin. Use `file:../handoff-core`
for dev; cut `0.3.0` when the engine stabilizes.

**Working agreement:** no commit/push without Brad's approval (Profile A). Same branch name
across handoff-core / handoff-app / handoff-figma-plugin.
