# Phase A Spike — Handoff MCP as a Claude design system (SS&C)

**Date:** 2026-06-25
**Registry:** `https://ssc-handoff.vercel.app` (SS&C — Bootstrap 5 + Handlebars + SCSS)
**Method:** 6 fresh Claude subagents acting as SS&C developers, each given the live design
system through a thin MCP CLI (`hmcp`) and a realistic task, with **no hint about which tools
to use**. We observed natural tool selection, whether output was grounded in real registry
values, and what each wished it had. Tool selection is the headline signal: in real Claude
Code the tools are always present, so the question is whether the model *chooses* to call them.

> Caveat: subagents also had filesystem access to the SS&C workspace and some grounding came
> from reading repo files directly. That's realistic for Claude Code (the dev has the repo),
> but means MCP wasn't always the sole source — see Finding 5.

---

## Result: PASS

Roadmap acceptance was "≥7/10 prompts produce output referencing actual registry data."
**6/6 prompts were fully grounded** in real registry data. Every agent called `__list` first,
then reached for the right tools unprompted — none guessed colors, type, or class names.

| # | Task | Tools the agent chose (unprompted) | Grounded |
|---|------|-----------------------------------|----------|
| 1 | Primary brand colors | `get_tokens` | ✅ |
| 2 | Primary button | `project_context`, `stack_guide`, `search_components`, `get_tokens`, `get_component`, `get_reference`, `get_component_reference` | ✅ |
| 3 | Hero section | `project_context`, `stack_guide`, `get_tokens`, `search_components`, `get_component`×2, `get_reference` | ✅ |
| 4 | Blog post card | `project_context`, `search_components`, `get_component`, `stack_guide`, `get_tokens` | ✅ |
| 5 | Search + close icons | `search_icons`×N, `get_icon_catalog`, `get_reference` | ✅ |
| 6 | Brand-voice copy | `get_brand_voice`, `project_context` | ✅ |

**The thing we said to watch — does the model call `get_tokens` before writing token-dependent
code — happened every time.** The tool descriptions are pulling their weight.

Two design tools earned their keep beyond raw tokens: `get_stack_guide` (the mandatory SCSS
`@import`, `class` vs `className`, Bootstrap-not-Tailwind mapping) and `get_component_reference`
(the buttons reference image revealed the primary button is an amber pill — see Finding 6).

---

## Findings (what to fix, in priority order)

### 1. 🔴 `handoff_get_component` ships ~143K tokens per call — `sharedStyles` is 97% of it
Verified directly: `get_component` returns **~570–585 KB (~143K tokens)** per component. A
single field, `sharedStyles` (the entire compiled design-system CSS), is **97.1%** of the
payload — and it's repeated on every component call. `validationResults` adds ~2.5K, and a
swarm of `figma*` fields add noise. The data a code-gen consumer actually needs (`code`,
`html`, `sass`, `css`, `properties`, `group`, `type`, `title`, `description`, do/don'ts) is
**~630 tokens — 0.4% of the payload.** Three `get_component` calls would blow ~430K tokens.

**Fix:** the same slimming we just applied to `handoff_get_tokens`. Strip `sharedStyles`,
`validationResults`, and the `figma*` bag from the MCP response; keep the implementation
fields. Add an `include` escape hatch if the full payload is ever wanted. This is the single
highest-impact change coming out of the spike.

### 2. 🟠 No spacing / radius / grid tokens — the most-cited gap
Agents 2 and 3 had to eyeball button padding (`0.75rem 1.5rem`), pill radius (`999px`), and
hero section padding (`6rem`) because `get_tokens` exposes no spacing/radius/grid scale. These
were the *only* non-token literals in otherwise fully-grounded SCSS. Confirms the **Phase 2
token-area extractor** (spacing, radius, grid) is the dependency for true component fidelity —
the slim token tool already forwards these the moment they're extracted.

### 3. 🟠 Component build output / template fidelity is uneven
The `button` component's rendered `code` is valid Handlebars (592 chars), but its `html`
render is a minimal `btn-outline` with an empty `href`, and its `sass` is just the shared
import + comment. Agents compensated by reading on-disk repo files. Ties directly to roadmap
**open-question #3**: is the built `component.html` reliably stored in the registry, or only
in the local workspace? For a *pure* Claude.ai-Design context (no repo on disk), the MCP must
carry the real template — this is what `handoff_get_component_template` (Phase C1) is for.

### 4. 🟡 Two agents disagreed on the primary-button color — yellow vs blue
Agent 2 made the primary button **amber** (`--color-accent-yellow` `#f5ab0a`) based on the
buttons *reference image*; Agent 3 made its hero CTA **blue** (`--color-primary-ssc-blue`
`#0077c8`) based on the token *named* "primary". Both are defensible — there is no
semantic/component-tier token like `button.primary.background` to disambiguate. This is
concrete evidence for the **component/semantic token tier** (Phase 2 component tokens): without
it, two competent models produce different brand output for the same component.

### 5. 🟡 MCP isn't yet self-sufficient without the repo
Several agents grounded partly by reading workspace files (`featured_posts/template.hbs`,
etc.). Fine for Claude Code, but the north-star (Claude.ai Design, no repo) needs the MCP to
carry component templates and on-disk conventions. Reinforces Findings 1 and 3.

### 6. 🟢 Minor / polish
- **`get_reference` arg confusion:** Agent 5 first called `{"type":"icons"}` (failed) before
  `{"id":"icons"}`. Tighten the description / accept `type` as an alias.
- **Gradient tokens have no `var()` name:** tokens expose `$color-gradients-*` sass names but
  no confirmed CSS-variable mirror; an agent had to infer `var(--color-gradients-*)`.
- **No on-primary / state color semantics:** hover/disabled/on-primary text were inferred from
  the primitive ramp.
- **CTA capitalization convention** is ambiguous in the brand-voice doc (Title Case vs
  sentence case).
- **DS content gap (not a tool gap):** no close/X icon in the catalog — agent correctly fell
  back to Bootstrap's native `.btn-close` rather than inventing one. Good behavior.

---

## What this means for the roadmap

- **Phase A: done — PASS.** The MCP surface works and models use it naturally.
- **Phase B (token surface): validated.** The token slim shipped during this spike drew zero
  size complaints. Spacing/radius/grid (Finding 2) is the remaining token-surface work and is
  gated on the Phase 2 extractor, not the MCP.
- **Phase C (component surface): now has a proven, urgent first task** — slim
  `handoff_get_component` (Finding 1). `handoff_get_component_template` (Finding 3) and the
  semantic/component token tier (Finding 4) follow.
- **Next action:** slim `handoff_get_component` exactly as we slimmed `handoff_get_tokens`.
