# 8x8 demo script — from a question to a specified design

**Date:** Thu 2026-07-30, morning · **Surface:** live 8x8 registry deploy · **Runtime:** ~12 min

The narrative: **"I want to build a hero"** → Claude checks what 8x8 *already has* → steers toward
composing from it → drafts the copy in 8x8's real voice → the workbench builds only what's
genuinely new → you critique and revise → transition to dev.

Two things to keep front of mind while presenting:

1. **Reuse is the thesis, not a feature.** The workbench generates net-new; the playground composes
   what exists. They're counterweights. Every beat should push toward "you already have most of
   this" — the cheapest component is the one nobody builds.
2. **Permissions are table stakes.** One sentence at the end. This demo is about what the system
   can *make*.

---

## Why this lands: it's already 8x8's own words

Read from the **8x8 registry** (`https://8x8-handoff.vercel.app`) via its MCP endpoint — not staged:

| Field | What's in it |
|---|---|
| `stackProfile` | **`bootstrap-handlebars`** — Handlebars templates, Bootstrap 5 utilities, SCSS with `var(--color-*)`. **Not React.** |
| `design_md` | "8x8 Design System Guidelines" — brand positioning (reliable, modern, outcome-focused; *"enterprise-grade without being cold or bureaucratic"*), visual principles (*"Clarity over decoration. Every element earns its place."*) |
| `voiceTone` | *"Confident and direct — we know our product works and we're not apologetic about selling it."* Never: jargon for its own sake, exclamation marks in headlines, passive voice, wishy-washy hedges. *"Trusted advisor who's also good at their job, not salesperson."* |
| `copyLength` | Headlines **3–8 words, never more than 10** · eyebrows **2–5** · CTAs **2–5, imperative verb first** · card descriptions **1 sentence, max 15 words** |
| `avoidedPhrases` | *Synergy · Revolutionize · Disrupt · Game-changing · Best-in-class (without proof) · Next-generation (without specifics) · **Seamless (overused)** · **Easy** · Robust (vague) · **Leverage** (as a verb) · **Utilize** · Unlock your potential · Transform your business · We're excited to announce* |
| `preferredPhrases` | *One platform · 99.999% uptime · AI-powered · Omnichannel support · Intelligent routing · All your communications, one place · Connect, collaborate, serve* |
| `sampleCopy` | Real hero examples: **"One platform. Every conversation."** / *"Voice, video, chat, and contact center — unified so your teams can focus on customers, not tools."* / CTAs *"See how it works"* / *"Start free trial"* |

⚠️ **Their guidance contradicts itself** — `avoidedPhrases` says avoid *"Seamless (overused — replace
with concrete description)"* while `preferredPhrases` lists *"Seamless collaboration."* Decide before
Thursday whether to (a) stay off that word entirely, or (b) surface the conflict as a *feature*
("your own guidance disagrees with itself — here's where"). (b) is the stronger move with a design-ops
audience, but only if you raise it deliberately rather than having the voice check stumble into it.

**And it flows automatically.** When the MCP queues a generation it sends empty guideline strings,
and `resolveDesignGenerationContext` (`design-workspace.ts:150`) falls back to the workspace — so
every MCP-triggered design silently inherits the design guidelines, the full brand voice, *and* the
uploaded button/input/iconography reference images. Say this out loud when it happens.

## The catalog is strong — 79 components, 2 patterns

**11 heroes:** `hero-simple`, `hero-split`, `hero-split-media`, `hero-with-media`, `hero-featured`,
`hero-background`, `hero-background-bubble`, `hero-logo-graphics`, `hero-icon-details`,
`hero-split-personalizable`, **`hero-form`**. Plus coherent groups for Cards, CTA, Content, Data,
Carousel + Tabs, Logo Cloud, Pricing, Quotes + Stats, Navigation, Footer Sections, Media, and atoms
(`button`, `badge`, `icon`, `card`, `quote-card`, `feature-card`, `carousel`, `drawer`, `breadcrumb`).

**But only 2 playground patterns** — "New Lander" (1 block) and "Playground pattern" (4 blocks). So
lean the reuse beat on **components**, not patterns. There is no library of composed landers to point
at yet.

⚠️ **Do not let Claude call `handoff_get_component` on a real block during the demo.**
`hero-form` returns **513KB**; `rate-card-app` returns 53KB. Use `handoff_search_components` (light)
and talk over it. Also: `rate-card-app` ships with **0 properties**, so contract coverage is uneven
across the library.

---

## Beat 1 — The contrast opener (90 sec) ⭐

**Do this first. It's the whole pitch in one move.**

With the 8x8 MCP **disconnected** (scratch session):

> "Write a hero headline and subhead for a cloud communications platform."

You'll get *"Transform Your Business Communications" / "Revolutionize how your teams connect"* —
generic SaaS mush, and both phrases are on 8x8's explicit banned list.

Now connect the MCP:

> "I want to build a hero. We're selling our integrated contact center + business phone platform to
> IT and CX leaders. Pull our brand voice and draft the copy."

`handoff_get_brand_voice` + `handoff_get_design_guidelines`.

Point at the screen: the banned phrases are gone, because it read the list. Then count the words —
headline lands in 4–8, CTA in 2–4, because that's the rule.

---

## Beat 2 — "What do we already have?" (2 min) ⭐ *the thesis beat*

Before generating anything:

> "Before we design anything new — what do we already have that could build this hero?"

`handoff_search_components` + `handoff_list_pages` / pattern listing.

**The point, said plainly:** *"The goal isn't to generate more design. It's to stop rebuilding
things you already own."* Most of a hero — eyebrow, heading, body, CTA pair, media slot — is
almost always already in the system. Let Claude enumerate it.

This is also where the **playground** enters as the workbench's counterweight: if an existing
pattern already covers the layout, the answer isn't "generate", it's "open it in the playground and
fill it in."

---

## Beat 3 — Refine the copy conversationally (90 sec)

> "The subhead is doing too much. Tighten it, and lean on the 'one platform' idea."
>
> "Give me three CTA options."

Iterate on *words* while it's cheap — before any pixels exist. The copy is the brief.

---

## Beat 4 — Generate only what's genuinely new (2 min)

> "Good. Now generate the hero design using that copy."

`handoff_generate_design_image` → job → `handoff_get_design_job` polls.

Narrate while it runs: *"I never told it our background colour, our typeface, or our button rules.
It's pulling all of that from the workspace, along with our actual button reference images."*

> ⏱ **Dead air.** Vercel Cron runs `* * * * *`, so budget **up to ~60s** before pickup plus
> generation time. Use the narration; have the fallback artifact ready.

When it returns, read it against the guidance out loud: off-white background, PP Telegraf, one
primary + one outline button. It followed rules nobody restated.

---

## Beat 5 — Quibble and revise (2 min)

> "The headline is competing with the product shot. Make it tighter and give the CTA more room."

Two paths, and **they behave differently — choose deliberately:**

- **In the workbench** (recommended): the bottom prompt bar does a true image-to-image iteration,
  refining the design on screen.
- **From MCP:** `handoff_generate_design_image` with `artifactId` attaches to the same artifact but
  **re-rolls from scratch** — `iterationBaseUrl` is hardcoded null (`create-server.ts:1006`). You
  get a different hero, not a refined one.

Do it in the workbench. Better result, and it's a natural *"this is where a designer takes over"*
moment.

---

## Beat 6 — Transition to dev (3 min) ⭐ *the payoff*

Back in Claude:

> "Transition this to dev."

`handoff_transition_to_dev` — **one** operation. Poll `handoff_get_design_artifact` and read
`devHandoff` for stage progress: `extracting_assets → generating_spec → ready`.

Then open the artifact's **Spec** tab:

1. **Build from what exists** — a composition score plus the specific components that could build
   this, each with what it covers and a link into the component page. *This is the thesis beat
   closing the loop.* Verified worth doing: the pre-change spec on 8x8 returned
   `existingComponentMatches: 0` with 79 components sitting right there.
2. **Design tokens** — observed colour/type/spacing values matched against 8x8's real tokens with an
   on-system coverage score; off-system values called out with what to snap to.
3. **Brand voice** — per-string pass/warn/fail, banned phrases flagged. **Ties back to Beat 1.**
4. **Extracted assets** — ⚠️ **verify before promising this.** See the risk table: asset extraction
   has never once succeeded on 8x8 (5 `none`, 1 `failed`, zero assets across all six artifacts). If
   it's still failing Thursday, cut this from the beat and lead on 1–3, which don't depend on it.

**What IS proven on 8x8:** spec generation works and the output is good. Artifact `e391308f`
produced `PlansPricingSection` — organism, group Pricing, 6 props including a `selectedBilling`
enum, **48 text-inventory items**, 6.4KB of clean markdown, capturing their real copy (*"Plans built
for how you work."*) verbatim from `sampleCopy`.

Say it: *"That's not a picture in a Slack thread. It's a specification — and it tells you what you
already own, what's off-system, and where the copy drifted."*

Optional close: `handoff_generate_component_from_design` → code in their stack.

---

## Beat 7 — Land it (30 sec)

*"Everything you just watched works the other way round too — designers work in the workbench, and
it's the same artifact, the same guidance, the same spec. Sharing, team visibility and permissions
are already in there."*

Show `/library` for three seconds. **Don't demo the permission model.**

---

## Pre-flight (Wednesday, not Thursday morning)

| # | Check | Why |
|---|---|---|
| 1 | Run **one full `transition_to_dev`** end to end **on the 8x8 registry** | ⚠️ **The single highest-risk item.** Spec generation has never once completed on the *local dev* DB; **its state on 8x8 is unverified.** The unification fixed the *silent* failure, so a failure will now name itself — but it still has to actually succeed. |
| 2 | Confirm the **reuse section** names real 8x8 components | The catalog is confirmed rich (79 components), so the inputs are there. What's unverified is whether the model picks well from them — and patterns are thin (2), so expect component hits, not pattern hits. |
| 3 | Confirm the **tokens section** populates | Depends on the registry's DTCG spacing/radius tokens. Colour/typography come from the Figma snapshot and should be present; spacing/radius may legitimately be empty (as on SSC) — the section degrades gracefully but say nothing about spacing tokens if so. |
| 4 | Pre-build a **fallback artifact** fully transitioned to dev | Insurance for Beats 4–6. |
| 5 | MCP connected with a **device-login JWT**, not the sync secret | `handoff_generate_design_image` hard-fails on a service token. |
| 6 | Rehearse Beat 1's "before" prompt | You want the generic version visibly full of banned phrases. Verify it is. |
| 7 | Confirm the workbench iteration path works on the live deploy | Beat 5 depends on it. |

---

## Known risks

| Risk | Mitigation |
|---|---|
| 🔴 **Asset extraction has never succeeded on 8x8** — 5 `none`, 1 `failed`, zero assets across all six artifacts. **This is now the top risk**, not spec generation. | The watchdog + reaper stop it *hanging*; they don't make it *succeed*. Either root-cause it before Thursday or cut the assets section from Beat 6. Note `c7621545` already shows the degraded path in production (`assets: failed` + `spec: done`), which the new `warning` field surfaces honestly. |
| ~~Spec generation has never completed~~ — **resolved, it works on 8x8** | That finding came from the local dev DB. Two 8x8 artifacts have `specStatus: done` with good output. |
| 🔴 **Four MCP tools return context-blowing payloads** — `list_design_artifacts` **34MB**, `get_design_artifact` **6.7MB**, `get_component_spec` **2.2MB** (completed specs only; tiny while pending), `get_component` **513KB** | All inline base64 images / full component source. Every one is a tool Claude might reach for mid-demo, and any could kill the conversation. Needs a size cap or field projection. Interim mitigation: steer the demo to `search_components` and the UI. Also: 8x8's six artifacts are all un-backfilled inline data URLs despite Blob being configured — running the backfill route would shrink these a lot. |
| Reuse/token sections come back thin or wrong | They're AI-generated against a real catalog, so quality varies. Pre-flight #2/#3 tells you what you're working with — if reuse is weak, lead Beat 6 with assets + tokens instead. |
| ~60s cron latency before generation starts | Scripted narration in Beat 4; fallback artifact. |
| First design comes back visually weak | Beat 5 reframes it — critique *is* the demo. A mediocre first pass that improves is a better story than a perfect one-shot. |
| Stuck extraction job mid-demo | Watchdog (240s self-fail) + cron reaper landed 2026-07-28. |
| Asked about per-person invites | Honest answer: team visibility + share links today, named grants next. `handoff_resource_grant` is read-only in the codebase — nothing inserts a row. Don't claim it. |
