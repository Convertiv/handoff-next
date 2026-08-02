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

## Where it actually landed, 2026-08-02

Stages 1–3 are built. `npm run eval:smoke` (3 cases × 3 runs) before a prompt change, `npm run eval
-- --all` for the full set. `--save` writes a result file; `--baseline` diffs against one and prints the
delta per case, because a prompt change that lifts one case and drops another is the normal shape.

First full baseline, 6 cases × 2 runs:

| Case | | Notes |
|---|---|---|
| fresh-page-with-imagery | 1/2 | one run came back all `placehold.co` |
| fresh-page-plain | 2/2 | |
| fill-the-images | **0/2** | both generated images stranded |
| edit-the-headline | 2/2 | |
| gallery-four-images | **0/2** | three generated images stranded |
| stats-not-inverted | 2/2 | |

**Overall 7/12.** The two reds are one bug, and the log named it in the first run:

```
rejected edits hero-background: no such field src.
  Its fields are: theme, anchor, overlay, bodySlot, direction, titleSlot,
                  buttonSlots, overlineSlot, mobileImageSlot, desktopImageSlot
```

The model invents `src` / `image` when placing a generated image into an existing block, the edit is
rejected, and the image it already paid for reaches nothing. Reproducible 4 of 4 across two cases —
which is the whole point of the exercise: this was previously a paragraph of prose saying the images
"landed in the library but not on the page".

### Two things the first run taught about the harness itself

**A vacuous pass is worse than a red.** `fill-the-images` scored 3/3 on its very first run while doing
no work at all: `request_image` is gated on a user id, the local runner passed `null`, the tool returned
"unavailable", nothing was queued, and every imagery check returned null because there was nothing to
judge. Two fixes — a `turn-did-work` check that fails an outcome of nothing, and cases that declare
`requiresUser` are **skipped** rather than run when no user id resolves. A skip is reported as a gap and
never contributes a green.

**Some properties are signals, not verdicts.** The first draft asserted zero retries on a plain page
request, straight from the table above, and it failed 3/3 — because `content-gaps` firing means the
guard caught an incomplete first pass, which is the system working. Asserting on it would have been a
check that always fails, and the response to that is to delete it. It is now a *signal*: counted and
printed per case, never a failure. `first-pass-incomplete` is currently 2/2 on plain pages, and if that
holds while a prompt change is made, nothing red will tell you it got worse.

### First measured fix, same day

The stranding bug, with a before and after instead of an anecdote:

| Case | before | after |
|---|---|---|
| fill-the-images | 0/2 | **2/2** |
| gallery-four-images | 0/2 | **2/2** |
| overall | 7/12 | **10/12** |

`request_image` used to return a bare `{ src, alt }` and a note saying "write it into the block". The
model guessed the field — `src` on a `hero-background` — the edit was rejected for naming no field the
component has, and the image it had already paid for reached nothing. The fix is not a better note: the
target is now an **argument**. Name the block and the field, get told the real field names if it is
wrong, and get back a value already shaped by the encoding that slot was *measured* to accept. A wrong
target is rejected before a penny is spent, and the canvas summary now names each block's image fields
so there is nothing to guess.

**The suite also caught a bug in its own instrumentation.** After the fix one case went green while the
other stayed red on `no-stranded-images` alone — with its own placement check passing. Two measurements
of the same property disagreeing is a fact about the measurements: `unplacedImages` was computed against
proposal blocks only, so *every changeset that generated an image had been logged as stranding it*,
however correctly it was placed. That was in production logs. A metric that cries wolf on a working path
is worse than no metric.

### The invented-src bug was not an invented src

`fresh-page-with-imagery` at 0/4, with the same line in every log:

```
rejected values on hero-background desktopImageSlot
  image src was not from the asset library — replaced
```

The message never said *what* had been rejected — the same mistake the unknown-key path made, and for
the same cost: a model told it is wrong, with no idea what was wrong, produces the identical thing on
retry. Adding the value to the message answered the question immediately, and the answer was not what
anyone had assumed:

```
src: "<img src=\"/api/handoff/assets/img_aeb067be0406/raw\" alt=\"Students on campus\" />"
```

`img_aeb067be0406` is a **real asset in the library**. Thirteen searches, the right image found, and
then the whole tag written into the src — understandable, since most slots on these components take an
HTML string and this one takes `{ src, alt }`. The object shape was right. Only the packaging was wrong.

So the guard was rejecting a correct answer to punish formatting, and the page shipped entirely on
`placehold.co` while the reply claimed every field was authored. The fix unwraps a wrapped src before
judging it, and **extraction is not a relaxation**: what comes out is checked against the same allowlist,
so a tag pointing at `https://evil.example.com` or a `javascript:` URL is still replaced.

**0/4 → 3/4**, and the suite overall:

| | baseline | after |
|---|---|---|
| overall | 7/12 (58%) | **17/18 (94%)** |

Two lessons worth keeping. The first is that *a rejection must name what it rejected* — this is now the
third bug of that exact shape (unknown keys, invalid values, invented srcs), and each one hid a
different real cause behind an unactionable message. The second is that the failure had been described
in prose for a week as "the images land in the library but not on the page", which is a true sentence
that points at the wrong subsystem.

### And a real one it will not let us ignore

`fresh-page-with-imagery` read 0/4 on resampling — after the placement fix had apparently *dropped* it
from 1/2 to 0/2. It was not a regression: the identical failure is in the baseline, and on a fresh page
`request_image` is unreachable, so that change could not touch the path. **n=2 was simply too thin to
see a case that was already broken**, which is the argument for sampling made concrete on the first day
of having it. Resampling before reporting is the discipline; the case is diagnosed above.

What is left at 17/18 is one run in three where the model proposes a page with no image field filled at
all — a different mechanism from the wrapped src, and not yet diagnosed.

## What this means for the nested-slot work

Build Stage 1 first. It is an hour, and it means the nested-slot probe — and every prompt change after
it — can be verified locally instead of by deploying and reading prose. That single change would have
saved most of tonight.
