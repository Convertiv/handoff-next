# Playground plan — describe a page, get a page

**Branch:** `feature/playground-improvement` · **Written:** 2026-07-30 · **Status:** proposed

## The goal, in one sentence

A user describes what they want — in chat or over MCP — and gets a complete page built from existing
blocks, with imagery drawn from the asset library or generated into it, previewable and shareable.

## What is already true

Built and pushed on this branch:

- `POST /api/handoff/ai/playground-chat` — a server-side tool loop with `search_components`,
  `scaffold_args`, `search_assets`, `propose_page`. Non-streaming.
- Right-rail chat in `PlaygroundBuilder`, open by default on a new page. One AI entry point; the
  browser-key `WizardDialog` and the floating assistant are gone from this surface.
- "Pull content from a URL" — server-side extraction with an SSRF guard.
- The block editor moved into the left rail, replacing the list, so the canvas has the width back.
- `handoff_create_page` over MCP works again (it had been violating a foreign key on **every** call).

**Two things are unverified and both gate real work.** Neither is expensive to check:

1. **Is `previewImageUrl` populated on 8x8?** Thumbnails are half of phase 1. The column exists;
   whether the catalog has values is unknown.
2. **Does the model reliably call `scaffold_args` before proposing?** This decides whether applied
   blocks arrive populated or empty. One real conversation answers it. Everything downstream assumes
   yes.

## Scope change to record

The earlier note (`PLAYGROUND-AI-CHAT.md`) said this flow would **not** generate imagery. It now will —
but with a constraint that makes it better than the workbench's version:

> **Every image becomes a real library asset before anything references it.**

Generated, attached in chat, or pulled from a URL — all three take the same `presign → PUT → confirm`
path and come out as catalogued assets with an id, reusable on the next page. Nothing references a
one-off blob, and nothing hotlinks a foreign CDN.

That single rule resolves three separate items on the list.

---

## Phase 0 — Ground truth (half a day)

Cheap, and it stops later phases being built on guesses.

- Verify the two unknowns above.
- **Bugs** from Monica's pass, all needing triage rather than design:
  - font styling visible on the front end (likely FOUC — the preview iframe rendering before fonts load)
  - `hero-background-bubble` "didn't come over" — a block that failed to transfer or render
  - clicking a block in the left rail doesn't scroll the canvas to it
- **Vocabulary.** *Pattern*, *page*, *prototype* and *composition* are all in play, and "Save as a
  Pattern" meant nothing to a first-time user. Pick one word, use it everywhere. Most of the
  help-text problem disappears for free.

## Phase 1 — See it working

The turn is opaque for 10–30 seconds. A spinner cannot tell you it isn't stuck.

- **Event streaming, not token streaming.** Convert the route to SSE and emit one event per tool call:
  *searching blocks → found 11 heroes → scaffolding hero-split-media → looking for imagery*. That is
  honest narration of real work rather than a progress bar that means nothing. The loop already
  produces discrete tool calls; this is yielding instead of accumulating.
- **Stop button, wired to a real abort.** Without it, closing the tab leaves the loop running and
  burning tokens.
- **Thumbnails** on blocks in the proposal card and the picker (gated on the phase 0 check).
- Keep `runPlaygroundChatTurn` independent of the transport. It is today, and that separation is what
  keeps the loop testable.

## Phase 2 — Change one thing

The most important phase. Monica hit this on her first pass: *"With the Regenerate button, it feels
like all or nothing."* That is the line between a toy and a tool, and it is why "build-only first" was
the wrong call.

- **Per-block actions on the proposal card** — swap, reword, remove. Scoped to one slot: the model is
  asked to reconsider *this* block, not to reason about the whole page. That sidesteps the positional
  failure that made full conversational editing risky ("before the footer" when there are two
  candidate footers).
- **Composition awareness** for follow-up turns, so "make the hero shorter" refers to what is on the
  canvas.
- **An icon tool.** Monica asked for real design-system icons; the chat has no way to reach them,
  though MCP already exposes an icon catalog.

## Phase 3 — Close the asset loop

- Generate an image when the library genuinely lacks one, and **store it in the library**.
- Ingest chat attachments and URL-pulled images the same way.
- ⚠️ **Generation must not run inside the chat turn.** An image call is 60–100s; a turn that generates
  two images is 2–3 minutes, well past what a single request should hold open. It hands off to the
  existing pipeline queue and the chat reports progress. Designing for this now avoids discovering it
  when turns start timing out.

## Phase 3.5 — Exemplars belong to the project, not the product ⚠️

**This is remediation, not a feature.** `lib/page-exemplars.ts` currently hardcodes **8x8's** page
structures into the Handoff app. Every registry that uses the playground now inherits an
enterprise-SaaS product-page shape — fifteen sections, analyst recognition, security badge rows —
whether or not it resembles anything they publish. A design system tool that imposes one client's page
architecture on every other client has the problem backwards.

Exemplars are workspace data, exactly like `designMd` and `brandVoice`:

- **Stored per registry**, alongside the other workspace settings.
- **No default.** If a workspace has none, the prompt simply omits that section. A generic "typical
  marketing page" fallback sounds harmless and isn't — it would quietly become everyone's house style,
  which is the same mistake in a milder form.
- **Written over MCP**, following the pattern `handoff_update_brand_voice` just established:
  admin-gated, merge rather than replace, echo what changed.
- The 8x8 exemplars move out of code and into 8x8's workspace. They were derived from observation and
  should live where the observations apply.

**The authoring flow is the interesting part, and it already exists in pieces.** Deriving exemplars is
what an LLM session is good at, and the tools are mostly built:

1. `extract-url` reads a real page — already used by the chat's "pull from URL".
2. The session reads several, and proposes structures.
3. `handoff_update_page_exemplars` stores them.

So "point Handoff at your own site and let it learn your page shapes" needs one write tool, not a
crawler. That is a genuinely good story for onboarding a new registry, and it is the same move as
correcting a fabricated brand voice from observed copy.

Worth deciding when building: whether exemplars are freeform text or the structured
`{ sections: [{ purpose, tone, items }] }` shape used today. Structured is checkable and rendersconsistently;
freeform is easier for a human to write by hand. Structured with a text `notes` field is probably the
right compromise.

## Phase 4 — Output

- **Preview as an image.** Needs a decision (below) — the cheap version captures the existing preview
  iframe into the pattern's `thumbnail` column; the expensive version is headless full-page rendering.
- **Share a pattern.** Design artifacts have share links; patterns do not. Likely reuses the same
  grant machinery.

---

## Cost discipline (applies from phase 1 on)

Agentic loops are **input-heavy and superlinear** — the opposite of chat. Every round re-sends the
whole transcript including all prior tool results, so a six-round turn is roughly 70k input tokens
against ~2k output. Three levers, by payoff:

1. **Cache the stable prefix.** System prompt plus tool definitions are identical every round. Keep
   them first and never interleave anything variable into them.
2. **Trim tool results.** A fat result is re-sent on every subsequent round, not once. `scaffold_args`
   is the one to watch — eight blocks means eight of them, repeatedly.
3. **Tighten `MAX_TOOL_ROUNDS`.** It is 12. Rounds 9–12 cost more than 1–6 combined. Treat hitting the
   cap as a signal the prompt needs work, not as normal operation.

Fluid Compute bills active CPU, and an agentic loop is overwhelmingly *waiting on the model* — so
holding a streaming function open is much cheaper than wall-clock billing would suggest.

## Decisions needed

| Question | Why it blocks |
|---|---|
| **Header and footer** — included in a composed page, or assumed from the site shell? | A product call, not a bug. Either is defensible; being silent is what confused Monica. Whichever we pick, the chat should say so. |
| **What "preview as an image" is for** | Shareable? Pasteable? The live iframe already exists, so she wants something else. Cheap and expensive paths differ by an order of magnitude. |
| **One word for the thing** | Pattern / page / prototype / composition. |
| **MCP parity — per phase, or chat leads?** | MCP already has the search/scaffold/create tools, so Claude can compose today. The gap is asset generation and ingest. |

## Risks

- **`scaffold_args` compliance is the load-bearing assumption.** If the model skips it, blocks render
  empty and every phase inherits the problem. Verify first; if it is unreliable, the fix is server-side
  enforcement — reject a `propose_page` containing a block that was never scaffolded — rather than
  more prompt wording.
- **Monica's feedback is against the deleted wizard.** "Review screen", "Regenerate button" are gone.
  The needs transfer to the proposal card; the specific screens do not. Re-test on the current build
  before treating any of it as an open bug.
- **This branch is missing the spec-first work.** `feature/playground-improvement` branches off `main`,
  which does not contain it, and `test:unit` here silently skips 8 missing files while reporting a
  green run. Fine for this work — it shares no code — but a green test run on this branch is not
  coverage, and merging to main will not bring spec-first with it.
