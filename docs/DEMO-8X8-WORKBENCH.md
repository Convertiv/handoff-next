# 8x8 demo script — from a question to a specified design

**Date:** Thu 2026-07-30, morning · **Surface:** live 8x8 registry deploy (branch `feature/spec-driven`) ·
**Runtime:** ~12 min

The narrative: **"I want to build a hero"** → Claude checks what 8x8 *already has* → steers toward
composing from it → drafts the copy in 8x8's real voice → **the brief becomes a specification, and the
specification produces the design** → you revise the spec, not the picture.

Two things to keep front of mind while presenting:

1. **Reuse is the thesis, not a feature.** The cheapest component is the one nobody builds. Every beat
   should push toward "you already have most of this."
2. **Permissions are table stakes.** One sentence at the end. This demo is about what the system can
   *make*.

> **Rewritten 2026-07-29.** The previous script had the chain running image-first: generate a picture,
> then derive a spec from it at the end as the payoff. That direction is now the *legacy* path. Spec-first
> is the product, and it changes the shape of the demo — the specification is no longer the reveal at the
> end, it is the thing that produces the design. Beats 4–6 are new.

---

## Why this lands: it's already 8x8's own words

Read live from the **8x8 registry** MCP endpoint — not staged. Verified 2026-07-29:

| Field | What's in it |
|---|---|
| `stackProfile` | **`react-tailwind`** — React TSX, Tailwind utilities, tokens as CSS variables. ⚠️ *The previous script said `bootstrap-handlebars` / "Not React". That is stale — the live registry returns `react-tailwind`. Don't say "Handlebars" on stage.* |
| `design_md` | "8x8 Design System Guidelines" — *"enterprise-grade without being cold or bureaucratic"*, *"Clarity over decoration. Every element earns its place."* |
| `voiceTone` | *"Confident and direct — we know our product works and we're not apologetic about selling it."* Never: jargon, exclamation marks in headlines, passive voice, hedges. *"Trusted advisor who's also good at their job, not salesperson."* |
| `copyLength` | Headlines **3–8 words, never more than 10** · eyebrows **2–5** · CTAs **2–5, imperative verb first** |
| `avoidedPhrases` | *Synergy · Revolutionize · Disrupt · Game-changing · **Seamless** · **Easy** · Robust · **Leverage** · **Utilize** · Transform your business · We're excited to announce* |
| `preferredPhrases` | *One platform · 99.999% uptime · AI-powered · Omnichannel support · Intelligent routing · All your communications, one place* |
| `sampleCopy` | **"One platform. Every conversation."** / CTAs *"See how it works"*, *"Start free trial"* |

⚠️ **Their guidance contradicts itself** — `avoidedPhrases` says avoid *"Seamless (overused)"* while
`preferredPhrases` lists *"Seamless collaboration."* Decide beforehand whether to stay off the word or
surface the conflict as a feature. Surfacing it is stronger with a design-ops audience — but only if you
raise it deliberately rather than having the voice check stumble into it.

**And it flows automatically.** Nothing in the demo restates the brand voice, the guidelines, or the
button reference images. Every generation inherits them from the workspace. Say this out loud.

## The catalog is strong — 79 components, 2 patterns

**11 heroes**, verified live 2026-07-29: `hero-simple`, `hero-split`, `hero-split-media`,
`hero-with-media`, `hero-featured`, `hero-background`, `hero-background-bubble`, `hero-logo-graphics`,
`hero-icon-details`, `hero-split-personalizable`, `hero-form`. Plus Cards, CTA, Content, Data, Carousel,
Logo Cloud, Pricing, Quotes + Stats, Navigation, Footer, Media, and atoms.

**Only 2 playground patterns**, so lean the reuse beat on **components**, not patterns.

---

## Beat 1 — The contrast opener (90 sec) ⭐

**Do this first. It's the whole pitch in one move.**

MCP **disconnected**:

> "Write a hero headline and subhead for a cloud communications platform."

Generic SaaS mush — *"Transform Your Business Communications" / "Revolutionize how your teams connect"*.
Both phrases are on 8x8's explicit banned list.

Now connect the MCP:

> "I want to build a hero. We're selling our integrated contact center + business phone platform to IT
> and CX leaders. Pull our brand voice and draft the copy."

`handoff_get_brand_voice` + `handoff_get_design_guidelines`. The banned phrases are gone because it read
the list. Count the words — headline lands in 4–8, CTA in 2–4, because that's the rule.

## Beat 2 — "What do we already have?" (2 min) ⭐ *the thesis beat*

> "Before we design anything new — what do we already have that could build this hero?"

`handoff_search_components`. **Verified light and fast** — 11 heroes, ~1KB.

*"The goal isn't to generate more design. It's to stop rebuilding things you already own."*

## Beat 3 — Refine the copy conversationally (90 sec)

> "The subhead is doing too much. Tighten it, and lean on the 'one platform' idea."
>
> "Give me three CTA options."

Iterate on *words* while it's cheap — before any pixels exist. **The copy is the brief**, and in the next
beat the brief is literally the input.

---

## Beat 4 — The brief becomes a specification (3 min) ⭐ *the new payoff*

Paste the agreed copy into the **workbench's main prompt** and send.

**This is the beat that changed.** Previously this generated a picture and a spec was reverse-engineered
from it at the end. Now the composer runs **spec-first**, and the canvas narrates it:

> Writing the specification… → Generating the images it calls for… → Composing the design from those images…

The design appears as soon as the composite lands. A fourth stage — **token conformance** — then measures
the finished image against 8x8's real tokens and adds that section to the spec, without making you wait
for it.

Say what each stage means as it goes:

1. **Writing the specification** — the component's contract: name, type, props, content, behaviour,
   accessibility, and *what imagery it requires*. No image exists yet.
2. **Generating the images it calls for** — each declared asset rendered on its own, at its own aspect
   ratio and resolution. *"These are the real files, not crops of a screenshot."*
3. **Composing the design from those images** — the comp is assembled **from** the assets, so the photo
   on screen and the file a developer downloads are the same bytes. **Verified holding on 8x8.**

> ⏱ **Dead air.** Stages run one per cron tick (`* * * * *`), so budget a few minutes total. This is the
> beat to talk over — and unlike a spinner, the stage labels are the product's claim made visible.

Then open the artifact's **Spec** tab:

- **Build from what exists** — composition score plus the specific 8x8 components that could build this,
  each with what it covers and a link into the component page. *The thesis beat closing the loop.*
- **Assets** — each image with its provenance: `1536 × 1024 · 3:2 · focal center-right`, `fills photo`.
  *"Generated to a declared requirement, at the size the slot needs."*
- **Brand voice** — per-string pass/warn/fail, banned phrases flagged. **Ties back to Beat 1.**

- **Design tokens** — colour/type/spacing values read off the rendered design, matched against 8x8's real
  tokens with an on-system coverage score, and off-system values called out with what to snap to. This is
  measured *after* the design exists, so it may land a tick after the image does. If the tab shows no
  tokens section yet, refresh once.

## Beat 5 — Revise the *specification*, not the picture (2 min) ⭐

> "Tighten the headline and make the CTA say 'See it live'."

In the Spec tab's **Revise the specification** box. What comes back:

- a **diff** of exactly what changed in the contract
- a **new spec version**, with your sentence recorded as the reason
- three possible outcomes, and the honest one matters: a request that's really art direction ("make it
  feel more premium") comes back as *art direction*, and a genuinely ambiguous one comes back as
  *needs clarification* rather than being silently guessed at

Then **Re-render from spec** to rebuild the images and the comp from the revised contract.

*"That's the difference. We didn't re-roll a picture and hope. We changed the contract, and the design
was rebuilt from it — and there's a version history saying why."*

## Beat 6 — It's a specification, not a screenshot (2 min)

> *"That's not a picture in a Slack thread. It's a specification — it tells you what you already own,
> what imagery you need at what size, and where the copy drifted from your own voice. And the design is
> a rendering of it, not the other way round."*

Optional close: `handoff_generate_component_from_design` → code in their stack (**react-tailwind**).

## Beat 7 — Land it (30 sec)

*"Everything you just watched works the other way round too — designers work in the workbench, and it's
the same artifact, the same guidance, the same spec. Sharing, team visibility and permissions are already
in there."*

Show `/library` for three seconds. **Don't demo the permission model.**

---

## Pre-flight (Wednesday, not Thursday morning)

| # | Check | Why |
|---|---|---|
| 1 | **Reconnect the MCP connector** in Claude | ⚠️ **Discovered 2026-07-29.** Connectors cache their tool list at connect time. A session connected before the deploy does **not** see `handoff_design_from_brief`, `handoff_revise_spec`, or `handoff_get_design_pipeline`. Reconnect and confirm all three appear, or Beats 4–5 have no MCP path. |
| 2 | Run **one full spec-first design** end to end on 8x8 | The whole of Beats 4–6. Confirm the stage labels advance and the final image renders (it comes back as a private-Blob proxy path — a broken image here means a basePath problem). **Then wait one more tick and re-open the Spec tab to confirm the tokens section appears** — the conformance stage is new and unverified on 8x8. |
| 3 | Confirm the **reuse section** names real 8x8 components | Catalog is confirmed rich; what's unverified is whether the model picks well. |
| 4 | Exercise **Revise the specification** once | Beat 5. Try one clear spec change and one art-direction request, so you know both answers look right. |
| 5 | Pre-build a **fallback artifact** fully rendered | Insurance for Beats 4–6. |
| 6 | MCP connected with a **device-login JWT**, not the sync secret | Generation hard-fails on a service token. |
| 6b | ⚠️ **Fix the three conflicting lines in Design.MD** | Design.MD is fed into every generation as authoritative prose, and it has drifted from the token system: primary teal given as `#00A3BF` (**not in the token set** — real values are Deep Teal `#04888a` and Teal 500 `#1aa39e`), headings as *"DM Sans or Inter"* (the registry's face is **PP Telegraf**), cards at 8px radius (actual 12px). A design generated against this comes back the wrong colour and the wrong typeface no matter what the pipeline does. Edit in workspace settings. |
| 7 | Rehearse Beat 1's "before" prompt | You want the generic version visibly full of banned phrases. |

---

## Known gaps

| Gap | What to do about it |
|---|---|
| ~~No Design tokens section on a spec-first design~~ — **built 2026-07-29** | A `conformance` stage now runs after `composite`, measuring the rendered image against the registry's tokens and merging the section in. It only ever measures something real, which is why it cannot run earlier. Unverified on 8x8 — see pre-flight #2. |
| 🟡 **Placement is verified, not enforced.** The composite model is *instructed* to place the generated assets rather than redraw them; confirmed by eye on 8x8, but nothing checks it. | Re-verify on the fallback artifact. If a demo run redraws, switch to the pre-built fallback. |

## Known risks

| Risk | Mitigation |
|---|---|
| ~~Four MCP tools return context-blowing payloads~~ — **resolved 2026-07-29** | A response cap runs at the single choke point every tool returns through: inline base64 becomes a descriptor, and an over-budget response drops whole records with the trim stated in the payload. `list_design_artifacts` also now returns a projection instead of full rows. Measured: 34MB → ~2KB. |
| ~~Asset extraction has never succeeded on 8x8~~ — **retired** | Extraction is gone. Assets are generated from the spec's declared requirements, at the right size, verified working. |
| ~~Spec generation has never completed~~ — **resolved** | Works on 8x8. |
| Cron latency before each stage starts | Three stages means three waits. Beat 4's narration is written for it. |
| First design comes back visually weak | Beat 5 reframes it — critique *is* the demo, and now the critique edits the contract. |
| Asked about per-person invites | Honest answer: team visibility + share links today, named grants next. Don't claim more. |
