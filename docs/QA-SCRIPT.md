# QA script — playground chat and MCP

**For:** whoever is testing the page-building behaviours by hand.
**Covers:** the fixes made 2026-08-02/03 in response to QA feedback, plus the surfaces they touch.

Every scenario below replaced a specific reported failure. The **Fails if** line is the old behaviour —
if you see it, the fix regressed, and that is worth reporting immediately. The **Look for** line is what
should happen now.

## Before you start

- Work in the 8x8 registry playground: `https://8x8-handoff.vercel.app/playground`.
- Signed in. Image generation is gated on a real user, so an anonymous session silently cannot generate.
- Get the test brief: `test/fixtures/qa-partner-brief.docx` in this repo, or regenerate it with
  `node scripts/make-qa-brief.mjs`. It is built to exercise several things in one upload — a three-column
  Old/New table, a Component column naming blocks in the wrong word order, and one component that does
  not exist.
- Keep a note of anything surprising even if it passes. Several bugs this month were found in the gap
  between "it worked" and "it worked for the right reason".

**One thing to know about judging results.** The model is not deterministic. A single bad run is not proof
of a bug and a single good run is not proof of a fix — if something fails, try it twice more before
writing it up, and say how many times out of how many. Three of the reports this month turned out to be
sampling noise, and two turned out to be real things that looked like noise.

---

## Part A — Browser

### A1. A Word brief becomes the page, using the right column

1. Empty canvas. Click **Paste or attach your copy (Word, text, Markdown, CSV)**.
2. Click **Attach a file** and choose `qa-partner-brief.docx`.
3. The copy appears in the box. Read it: headings should be headings, the bullets should be bullets, and
   the table should look like a table with a `| --- |` line under its header.
4. Click **Use this copy**, then send `Build this page.`

**Look for**
- The transcript shows **"Supplied copy from qa-partner-brief.docx (N words)"** — not the whole document.
- The page uses copy from the **New Copy** column: "Partner with 8x8", "Grow your business with the 8x8
  partner programme.", "Silver, Gold and Platinum tiers…".
- The blocks match the **Component** column: `hero-split`, `content-split`, `two-column-content`,
  `card-rows`, `stats`, `faq`.
- The reply says what it used instead of **Zig Zag Timeline**, which does not exist.

**Fails if**
- Copy from the **Old Copy** column appears on the page ("Become an 8x8 reseller", "We have a partner
  scheme", "Margins are good"). That was the original bug.
- The first two rows are skipped.
- Everything becomes `simple-copy` — six identical blocks was the reported symptom.
- It substitutes a block for Zig Zag Timeline and says nothing about it.

### A2. Attaching a file is findable, and a Word doc is accepted

1. Open the copy panel. Look at the row of controls.
2. Tab to **Attach a file** with the keyboard and press Enter.
3. In the file dialog, confirm `.docx` files are selectable, not greyed out.
4. Cancel, and instead drag the `.docx` onto the chat footer.

**Look for** the button is a bordered button with a paperclip, reachable by keyboard; the dialog offers
Word files; dropping works anywhere in the footer.

**Fails if** the control cannot be reached by keyboard (it was a `<label>`, invisible to keyboard and
screen readers), or `.docx` appears greyed out in the dialog.

### A3. Asking for a `.doc` or `.pdf` says something useful

1. Try to attach a `.pdf`, then a legacy `.doc`.

**Look for** a message naming the format and pointing at paste — and for PDFs, not claiming Word files
also fail.

**Fails if** the message contradicts itself, e.g. ".docx files can't be read … Word (.docx) works".

### A4. A page-wide change edits the page instead of rebuilding it

1. Start from an applied page — A1's output is ideal, with imagery and links already in it.
2. Send: `Use # for all the links on this page, and "Learn More" for every CTA label.`

**Look for**
- A **changeset** — a list of changes with an **Apply changes** button — not a fresh page proposal.
- Each row names a block and the fields changing.
- Your existing imagery and copy survive.

**Fails if** you get a whole new page and a **Replace Page** button. Accepting that discards every earlier
decision — image choices, link edits, copy corrections — which was the most destructive bug reported.
This failed **3 of 3 times** before the fix, so it is worth two or three attempts.

### A5. Changing a block's type swaps it, rather than adding or editing

1. On the applied page, send: `Change the "Why partner" section to a stats block instead.`
2. Then, separately: `The programme tiers would work better as a table than as cards. Change it.`

**Look for** a row reading **Swap N**, with **two thumbnails and an arrow** — the outgoing block and the
incoming one — and friendly names, not `content-split`.

**Fails if** a new block is added alongside the old one, or the block keeps its type and only its fields
change. Measured at 3 of 5 before the fix, so sample this one properly.

### A6. You can see a swap before accepting it

1. With any changeset on screen, look at the rows.

**Look for** thumbnails on swaps and inserts; a field list on updates (no thumbnail, because the block is
unchanged); friendly component names throughout.

**Fails if** rows are plain text like `Replace block 3: hero-split → content-split` — the original
complaint was that you had to accept a swap to see it.

### A7. A refused image is reported, not silently swapped

1. On the applied page, send: `Set the hero desktop image to https://www.8x8.com/assets/hero.jpg — use that exact URL.`

**Look for**
- An amber line: **"Desktop image on hero-background is a placeholder — the image chosen was not in the
  asset library…"**
- A note in the reply: **"⚠️ 1 image slot still holds a placeholder…"**
- Both appearing even though the model's own prose claims it set the image.

**Fails if** the changeset applies with no mention of the substitution. That is the "it listed these
components as edited and there are still no images" report.

### A8. Real imagery is found and used

1. Empty canvas. Send: `Build a landing page selling our phone systems to university clients, with good imagery.`

**Look for**
- Real images from the asset library on the page, not grey `placehold.co` boxes.
- Optional image slots that were left alone are **empty**, not grey boxes.
- A closing note: **"Optional fields left empty, if you want them: …"**.

**Fails if** every image is a `placehold.co` placeholder while the reply claims the page is fully
authored. The asset search matched only titles until this month, so searches like "campus building"
returned nothing against a library that had the photographs.

### A9. Generating an image places it

1. On an applied page with an empty image slot, send: `Generate a real image for the hero and put it in.`

**Look for** the image queues, the changeset carries it, and after a minute or two the real image replaces
the placeholder in the canvas. No stranded images.

**Fails if** images generate and land in the asset library but never appear on the page, or the reply
claims they were placed and no op references them.

### A10. Adding one section adds one section

1. On the applied page, send: `Add a form section after the hero so partners can register their interest.`

**Look for** a single **Insert** row.

**Fails if** the whole page is re-proposed. Note: `hero-form` has no form-selection property in the
published component, so the form itself will not render — that is an 8x8 schema gap, not this app. See
**Known gaps** below.

---

## Part B — MCP

Run these from an MCP client pointed at the 8x8 registry endpoint. The MCP shares most of the code the
chat uses, so several of these are confirming the fix reaches both surfaces — but **two of them do not
reach MCP yet**, and those are called out.

### B1. `handoff_search_assets` finds assets by more than title

Call it with each of: `campus building`, `student phone`, `library study`.

**Look for** results for all three. They match on alt text, description and tags now, not just the title,
and every word of the query is required.

**Fails if** any returns nothing. Before this month all three returned nothing against a 127-image
library.

> **Known difference:** the chat's `search_assets` falls back to a looser any-word match when the precise
> one finds nothing, and tells the model the match was partial. **MCP does not have that fallback** — it
> returns the precise result or nothing. Worth deciding whether it should.

### B2. `handoff_scaffold_args` reports measured field shapes

Call it for `image-gallery`, then `grid-columns`.

**Look for**
- `image-gallery.images` described as **`array of { src, alt } — every src from the asset store`**.
- `grid-columns.columns` described with its item shape including **`imageSlot: { src, alt }`**.
- Fields the probe found no encoding for marked `editable: false` with a note not to touch them.

**Fails if** a nested image slot is described as `HTML string`. That guess is why a gallery could generate
three images and place none of them.

### B3. `handoff_scaffold_args` marks required fields

Call it for `faq`, `stats`, `image-gallery`.

**Look for** `required: true` on `questions`, `stats` and `images` respectively, and absent on optional
fields like `bodySlot`.

**Fails if** nothing is marked required — the gap guard depends on it, and without it every optional field
reads as an unfinished page.

### B4. `handoff_browse_components` lists the whole catalog

Call it with no arguments.

**Look for** all ~77 components.

> **Known gap:** MCP's browse returns `id, title, group, type, tags` and **no purpose line**. The chat's
> `list_blocks` now carries one line of authored should-do guidance per block — which is what stopped it
> collapsing every section to `simple-copy` — and MCP consumers still choose without it. Same defect, a
> different surface, not yet fixed.

### B5. Instance writes still respect the contract

Call `handoff_create_preview` or `handoff_update_page` with a component's args.

**Look for** an invented image src being refused or replaced rather than stored, and an unknown field name
reported rather than silently dropped.

---

## Part C — Known gaps, so they are not reported as new

| Thing | Status |
|---|---|
| **Hero Form does not render, and has no form picker** | Not an AI or app bug. The published `hero-form` contract is `anchor`, `theme`, `direction` and six slots — there is **no form property at all**, so nothing can supply a form and no editor can offer to choose one. Needs a schema change on the 8x8 side. |
| **The same prompt gives different layouts run to run** | Partly inherent to the model. Narrowed by the catalog and brief-naming fixes; a brief with a Component column is the reliable way to pin it. |
| **MCP asset search has no loose fallback** | See B1. |
| **MCP browse has no purpose line** | See B4. |
| **PDF attachments are refused** | Deliberate. PDF text extraction returns positioned runs, so reading order interleaves wrongly on the multi-column exports marketing copy arrives as — it would produce copy that looks fine and is subtly scrambled. |
| **`.doc` (legacy binary) is refused** | Deliberate; the converter reads `.docx` only. |
| **A config field shows up in "Optional fields left empty"** | Known noise. `imageTheme` and similar enums are typed as text and read as content, so they occasionally appear in that note. Harmless — the note asks for nothing — but it makes the list longer than it should be. |
| **18 nested slots report as not editable** | Correct. They are mostly `cardSlot`, where the whole item *is* a component element and there is no authorable shape to offer. |

---

## Recording results

| # | Scenario | Result | Runs | Notes |
|---|---|---|---|---|
| A1 | Word brief → page, right column | | /3 | |
| A2 | Attach findable, docx accepted | | /1 | |
| A3 | .doc / .pdf message | | /1 | |
| A4 | Page-wide change edits | | /3 | |
| A5 | Type change swaps | | /3 | |
| A6 | Swap is visible before applying | | /1 | |
| A7 | Refused image reported | | /2 | |
| A8 | Real imagery found | | /3 | |
| A9 | Generated image placed | | /2 | |
| A10 | Add one section | | /2 | |
| B1 | MCP asset search | | /1 | |
| B2 | MCP measured shapes | | /1 | |
| B3 | MCP required fields | | /1 | |
| B4 | MCP full catalog | | /1 | |
| B5 | MCP contract respected | | /1 | |

For anything that fails, the useful report is: **what you sent, what you got, and how many of how many
runs.** The prose in a reply is often wrong about what happened — the changeset rows and the page itself
are the evidence.

## The automated suite, for context

Thirteen of these behaviours also run as an eval suite — `npm run eval -- --all` — currently 26/26 across
two runs each. It asserts on structure (which tools ran, which ops were produced, which blocks were used)
and never on wording. It cannot see the browser, which is what this script is for: everything in Part A
that involves clicking, keyboard access, thumbnails or what a card actually shows is invisible to it.
