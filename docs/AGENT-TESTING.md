# Testing an agentic system — what to build, in what order

**Status:** design, 2026-08-01. Written after an evening where one behaviour took four attempts, three
of which made it worse.

## The thing to be clear about first

An agentic feature has three layers, and they need completely different tests. Most of the value is not
in the layer people mean when they say "eval".

| Layer | Deterministic? | How you test it | Tonight's bugs |
|---|---|---|---|
| **Pure logic** — merges, shape derivation, encodings, verification | yes | ordinary unit tests | FK write order, `array-of-text` ranking, placeholder detection, error summarising |
| **Plumbing** — does the record reach the row, does the tool return the right shape | yes | integration tests against a real DB/API | capabilities not reaching the row, MCP running a duplicate scaffold, artifact pruned by a cleanup |
| **Behaviour** — given this prompt, does the agent do the right thing | **no** | an eval suite | model never called `propose_page`, generated images it never placed |

**Roughly two thirds of what broke tonight was in the first two rows.** An eval suite would not have
caught the foreign-key ordering or the duplicated MCP handler. It is worth building, but it is not the
thing that has been hurting most, and building it first would be treating the visible failure rather
than the common one.

## What an eval suite actually is

Three parts, and none of them are exotic:

1. **Cases.** A fixed input — a prompt, plus any starting state (an empty canvas, or a page with six
   blocks). Ours come from real failures, which is the only source worth having early.
2. **A runner.** Executes each case against the real model and captures what happened — not the prose,
   the *trace*: which tools ran, in what order, what came back.
3. **Assertions on structure, not wording.** "Called `propose_page`", "proposed ≥ 6 blocks", "zero
   generated images left unplaced". Never "the copy is good".

The last point is the one people get wrong. Asserting on prose means either brittle string matching or
an LLM judging another LLM — expensive, noisy, and it would have said "looks great" about a reply that
described a page which was never proposed.

**Because the model is stochastic, a case does not pass or fail — it has a rate.** Run each case 3–5
times and require, say, 4 of 5. A single green run proves very little; a single red run may be noise.
That is the main practical difference from unit testing, and it is why eval runs are reported as
percentages.

## The unlock we are missing, which is not an eval suite

**A turn cannot currently be run without a deploy.** Every iteration tonight cost a push, a Vercel
build, and a manual run in the browser — then a paragraph of prose to infer the cause from. Four
attempts at one behaviour, three of which made it worse, is what that loop produces: each change was a
plausible reading of insufficient evidence.

So the first thing to build is not evals. It is:

```
npx tsx scripts/run-turn.ts "sell our phone systems to university clients" [--canvas fixture.json]
```

One turn, locally, against the real model, printing the trace and the reply. Perhaps an hour of work.
It immediately makes prompt changes testable *before* they ship, and it is the thing every later stage
sits on top of — a runner is a loop over this with assertions attached.

## The order I would build it

**Stage 0 — record what real runs do.** Done: every turn now logs its tool sequence, the guards that
fired, the outcome, and image counts, with computed flags. This is ground truth, and it is where cases
come from.

**Stage 1 — make one turn runnable locally.** The script above. Stops the deploy-per-iteration loop.
Everything else is optional; this is not.

**Stage 2 — turn tonight's failures into cases.** We already have six worth keeping:

| Case | Assert |
|---|---|
| Fresh page, "include good images of students" | proposes; ≥ 6 blocks; no `request_image` (no canvas yet) |
| Applied page, "fill the images" | every queued image's src appears in an op |
| Applied page, "make the hero headline shorter" | one `update` op, non-empty values |
| Fresh page, plain request | zero retries fired — retries mean guards disagreeing |
| Gallery block, "add four images" | four items, each with a real src |
| Stats block | `stat` holds the number, `sub` holds the label |

Each is a bug that shipped. Write the case when you fix the bug, not later.

**Stage 3 — the runner.** Loop the cases, n runs each, report pass rates and cost. `npm run eval:smoke`
for three cases before a prompt change; the full set less often. Real money per run, which is a feature:
it keeps the suite small and the cases meaningful.

**Stage 4 — keep it honest.** Every new behavioural bug becomes a case *before* it is fixed. Track
rates over time; a prompt change that lifts one case and drops another is the normal shape, and without
rates you will not see the drop.

## Techniques worth knowing, and when they earn their place

- **Trace assertions** — assert the tool sequence, not the output. Already available now that turns are
  logged. Cheapest useful signal there is.
- **Invariants over expectations** — "no generated image is left unplaced" holds for every case and
  never needs updating. "Proposes exactly 8 blocks" is brittle. Prefer the former.
- **n-of-m sampling** — 3–5 runs per case. Below that you are measuring noise.
- **Tiering** — a 3-case smoke set you will actually run, and a fuller set for releases. A suite that
  takes twenty minutes gets skipped.
- **LLM-as-judge** — only for genuinely subjective properties (does the copy match the brand voice), and
  only once the structural layer is solid. Noisy, costs a second model call per assertion, and cannot
  see the failures we have actually had.
- **Record/replay** — cache model responses so the deterministic parts of a turn can be tested for free.
  Useful later; premature now, because the stochastic part is what we are testing.

## What this means for the nested-slot work

Build Stage 1 first. It is an hour, and it means the nested-slot probe — and every prompt change after
it — can be verified locally instead of by deploying and reading prose. That single change would have
saved most of tonight.
