# 8x8 demo — MCP runbook

**Run this in a Claude session with the 8x8 Handoff MCP connector enabled.** Every step is a prompt you
paste verbatim, the tool that should fire, and the one thing to check before moving on.

Companion to `DEMO-8X8-WORKBENCH.md` (the presenter narrative). That one is *what you say*; this is
*what you type*.

> **Reconnect the connector first.** Connectors cache their tool list when they connect. A session
> connected before the spec-driven deploy cannot see `handoff_design_from_brief`, `handoff_revise_spec`
> or `handoff_get_design_pipeline`, and Steps 5–8 will silently fall back to the old image-first tools.
> Step 0 catches this.

**Timing:** Steps 0–4 are instant. Step 5 is the long one — four pipeline stages, one per cron tick
(`* * * * *`), so budget **5–9 minutes** end to end. Step 8 is another 3–5.

---

## Step 0 — Confirm you're pointed at 8x8, on the new build

```
Using the Handoff MCP, get the project context. Then list which handoff_* tools you have available
that relate to designs — just the names.
```

Fires `handoff_get_project_context`.

**Check all four:**

| | Expect |
|---|---|
| `handoffOrigin` | `https://8x8-handoff.vercel.app` — if it's anything else you're on the wrong registry |
| `stackProfile` | `react-tailwind` (**not** `bootstrap-handlebars` — older notes say Handlebars and are wrong) |
| `hasBrandVoice` / `hasDesignGuidelines` | both `true` |
| tool list | includes **`handoff_design_from_brief`** and **`handoff_revise_spec`** |

❌ **If those two tools are missing, stop and reconnect the connector.** Everything from Step 5 depends
on them.

⚠️ **Also fix Design.MD before generating anything.** It is passed into every generation as
authoritative prose and currently contradicts the token system in three places:

| Design.MD says | Reality |
|---|---|
| primary teal `#00A3BF` | not in the token set — Deep Teal `#04888a`, Teal 500 `#1aa39e` |
| headings "DM Sans or Inter" | the registry's face is **PP Telegraf** |
| cards 8px radius | actual 12px |

This is why a design comes back blue with the wrong typeface. It is not a pipeline bug and no amount of
re-rendering fixes it — the generator is doing what the guidelines told it. Edit them in workspace
settings first.

---

## Step 1 — The contrast opener ⭐

**This one needs the MCP OFF.** Use a separate session with the connector disabled, or disable it here
and re-enable after.

```
Write a hero headline and subhead for a cloud communications platform.
```

**Check:** the output contains phrases from 8x8's banned list — *Transform*, *Revolutionize*,
*Seamless*, *Empower*. If it comes back unusually good, re-roll; you want the generic version.

Now re-enable the MCP and continue.

## Step 2 — Same question, with their voice

```
I want to build a hero. We're selling our integrated contact center + business phone platform to IT
and CX leaders. Pull our brand voice and design guidelines from Handoff, then draft the headline,
subhead and CTA.
```

Fires `handoff_get_brand_voice` + `handoff_get_design_guidelines`.

**Check:** no banned phrases; headline 3–8 words; CTA 2–5 words, imperative first. Those are 8x8's own
rules and nobody restated them.

## Step 3 — What do we already have? ⭐ *the thesis beat*

```
Before we design anything new — search the component catalog and tell me what we already have that
could build this hero. Don't fetch full component source, just search.
```

Fires `handoff_search_components`. Returns ~11 heroes, ~1KB.

**Check:** it names real ids (`hero-split-media`, `hero-form`, …) rather than describing generic heroes.
Each result now carries `componentUrl` and `previewImageUrl`.

> ⚠️ **Don't let it call `handoff_get_component` on a real block.** `badge` — an *atom* — is 466KB of
> source. The cap now clips it to something usable instead of erroring, but it still burns context for
> nothing.

### Step 3b — Show it, don't list it ⭐

```
Build me a small HTML page from those results: a card grid, one card per component, showing the
thumbnail from previewImageUrl, the title, and the group, with each card linking to componentUrl.
Inline the thumbnails as data URIs so they render.
```

This is the thesis beat made visual — a wall of what 8x8 already owns, each tile clicking through to
the real component page.

**Two things that will bite, in order of likelihood:**

1. **Thumbnails may be blank.** `previewImageUrl` is `null` for any component with no stored image, and
   whether 8x8's catalog has them is **unverified** — check this on your rehearsal run. If they're all
   null, drop the thumbnail and render a linked card grid with title/group/type; it still reads well.
2. **Remote images don't load in an Artifact.** Artifacts run under a strict CSP that blocks external
   hosts, which is why the prompt says *inline them as data URIs* — Claude fetches each image and embeds
   it. Skip that instruction and you'll get a grid of broken-image icons.

## Step 4 — Refine the copy (no tools)

```
The subhead is doing too much. Tighten it and lean on the "one platform" idea. Then give me three CTA
options, and recommend one.
```

Pure conversation. **The copy is the brief** — the next step feeds it in literally.

---

## Step 5 — Brief → specification → assets → design ⭐ *the payoff*

Paste the agreed copy into the brief. Edit the text below to match what Step 4 produced:

```
Use handoff_design_from_brief to create this design.

Brief: A hero for 8x8's integrated contact center and business phone platform, aimed at IT and CX
leaders. Two-column layout: copy on the left, a supporting photograph on the right.

Headline: <paste from Step 4>
Subhead: <paste from Step 4>
Primary CTA: <paste from Step 4>
Secondary CTA: See how it works

Title it "8x8 Platform Hero".
```

Fires `handoff_design_from_brief`. Returns `artifactId`, `pipelineId`, `stages`, and **`artifactUrl`** —
open that in a browser now and leave it up; the page fills in as the stages land.

**Check:** `stages` is `["spec", "assets", "composite", "conformance"]` — four stages. Three means you're
on an older build.

Then poll:

```
Poll handoff_get_design_pipeline for that artifact every 45 seconds and tell me the stage as it changes.
Stop when it's finished or a stage fails.
```

**The poll returns the design itself.** Once the `composite` stage is done, `handoff_get_design_pipeline`
attaches the rendered image to its response, so it appears inline in the conversation — along with
`artifactUrl` and an absolute `imageUrl` you can open or download. No need to leave the session to see
what was made.

**Expected progression** — each stage takes a tick to pick up plus 1–2 minutes to run:

| Stage | What's happening |
|---|---|
| `spec` | Writing the contract — name, props, content, behaviour, and *what imagery it needs*. No image exists yet. |
| `assets` | Each declared image rendered on its own, at its own aspect ratio. |
| `composite` | The design assembled **from** those images. |
| `conformance` | The rendered design measured against 8x8's real tokens. |

⚠️ **If the `spec` stage fails with "too thin a subject"** — that's the guard working. The brief was too
vague for the model to write real art direction. Add a sentence describing the photograph you want and
re-run Step 5.

## Step 6 — Read the specification

```
Get the component spec for that artifact and summarise: the component name and type, what existing 8x8
components it says to build from, how many images it declares and at what sizes, and the brand voice
findings.
```

Fires `handoff_get_component_spec`.

**Check:**
- **reuse** names real 8x8 component ids
- **assetRequirements** has ≥1 entry with a rich `subject` and a real `aspect`
- **voice** has per-string findings
- **tokens** — may not be there yet if `conformance` hasn't finished. Re-run this step after it does.

Then open `artifactUrl` and show the **Spec** tab. It's the same data, laid out.

> `handoff_get_design_artifact` also returns the image inline, plus `artifactUrl` and an absolute
> `imageUrl`. Use it if you want the design back on screen mid-conversation.

## Step 7 — Revise the specification, not the picture ⭐

```
Use handoff_revise_spec on that artifact: "Tighten the headline to five words and change the primary
CTA to 'See it live'."
```

**Check the response has all three:** `target: "spec"`, a `diff` of what changed, and a new `version`
with your sentence as the reason.

**Then show the honest answer** — this is the better half of the beat:

```
Now try: "Make it feel more premium."
```

**Check:** comes back as `art-direction` or `unsure`, **not** an applied edit. Say why out loud — a
patcher that guesses on an ambiguous request produces edits nobody asked for.

## Step 8 — Re-render from the revised spec

```
Use handoff_generate_design_assets on that artifact with recomposeDesign true, then poll the pipeline
until it finishes.
```

Runs `assets → composite → conformance`. **This replaces the current image** — that's the point.

**Check:** the new design reflects the revised headline and CTA. The final poll returns the new image
inline, so you can compare it against the one from Step 5 without leaving the session.

## Step 9 — The guarantee

Open the artifact's **Assets** section, download the hero image, and compare it to the same region of
the composite.

**Check:** they match. Not "similar" — the same photograph. That's what asset-first buys: the image in
the comp and the file the developer gets are the same bytes.

> This is verified but **not enforced** — the composite model is *instructed* to place the asset rather
> than redraw it. Check it on your rehearsal run; if a run ever redraws, fall back to a pre-built
> artifact.

---

## Fallbacks

| If | Do |
|---|---|
| `handoff_design_from_brief` is missing | Reconnect the connector. No workaround — the old `handoff_generate_design_image` is the image-first path and produces the orphan-asset behaviour this demo exists to replace. |
| A stage fails | The error names the stage. `spec` → brief too thin, add art direction. `assets`/`composite` → usually transient, the queue retries once; re-run Step 8. |
| Everything is too slow | Switch to the pre-built artifact and narrate from it. Steps 6, 7 and 9 all work on an existing design. |
| The image doesn't appear inline | You'll get `imageNote` saying it was too large, with `artifactUrl` to open instead. Nothing is broken — the design exists either way. |
| `conformance` produces no tokens | Non-fatal by design. Most likely the registry has no DTCG spacing/radius tokens, so it degrades to colour/type. Don't raise tokens as a beat if it's empty. |
| Asked about per-person invites | Team visibility + share links today, named grants next. Don't claim more. |

## Do not

- Call `handoff_get_component` on a real block mid-demo (513KB).
- Use `handoff_generate_design_image` for a new design — that's the legacy image-first path.
- Run `handoff_transition_to_dev` on a spec-first design — it re-derives the spec by *reading the
  composite*, overwriting an authored spec with a description of its own rendering.
