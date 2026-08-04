# QA script — playground chat and MCP

**For:** whoever is testing the page-building behaviours by hand.
**Covers:** the fixes made 2026-08-02/03 in response to QA feedback, plus the surfaces they touch.

Every scenario leads with the exact **Prompt** or **Call** to use — copy it rather than paraphrasing, so
results are comparable between testers. **Look for** is what should happen now. **Fails if** is the old
behaviour, so a regression is recognisable rather than merely disappointing.

## Before you start

- Playground: `https://8x8-handoff.vercel.app/playground`. Signed in — image generation is gated on a real
  user, and an anonymous session silently cannot generate.
- Test brief: `test/fixtures/qa-partner-brief.docx`, or regenerate with `node scripts/make-qa-brief.mjs`.
  It carries a three-column Old/New table, a Component column naming blocks in the *reversed* word order,
  and one component that does not exist.
- Note anything surprising even when it passes. Several bugs this month were found in the gap between "it
  worked" and "it worked for the right reason".

**How to judge a result.** The model is not deterministic. One bad run is not proof of a bug and one good
run is not proof of a fix — if something fails, run it twice more and report *how many of how many*. Three
reports this month were sampling noise; two looked like noise and were real.

**Where the evidence is.** The reply's prose is often wrong about what happened. The changeset rows, the
proposal card and the page itself are the truth.

**Check which build you are testing first.** A fix on `main` is not a fix in front of you until the
registry redeploys, and the MCP endpoint has been observed lagging behind. The cheapest probe is B4: if
`handoff_search_components { "query": "split content" }` returns `[]`, the deployment predates this round
and Part B will fail for that reason rather than a real one. Confirmed lagging on 2026-08-03.

---

## Part A — Browser

### A1. A Word brief becomes the page, from the right column

**Prompt**
```
Build this page.
```
**Setup** Empty canvas → **Paste or attach your copy (Word, text, Markdown, CSV)** → **Attach a file** →
`qa-partner-brief.docx` → **Use this copy** → send the prompt above.

**Look for**
- The transcript shows **"Supplied copy from qa-partner-brief.docx (235 words)"**, not the document.
- Copy from the **New Copy** column: "Partner with 8x8", "Grow your business with the 8x8 partner
  programme.", "Silver, Gold and Platinum tiers…".
- Blocks matching the **Component** column: `hero-split`, `content-split`, `two-column-content`,
  `card-rows`, `stats`, `faq`.
- A closing note listing optional fields left empty.

A run on 2026-08-03 gave exactly `header, hero-split, content-split, two-column-content, card-rows, stats,
faq, timeline, footer`. Reference, not requirement — header and footer are site chrome and normal.

**Fails if**
- **Old Copy** appears on the page: "Become an 8x8 reseller", "We have a partner scheme", "Margins are
  good". That was the reported bug.
- The first rows are skipped.
- Everything becomes `simple-copy` — six identical blocks was the symptom.

**Worth noting, not a failure.** "Zig Zag Timeline" does not exist; the model picked `timeline`, which is
fair, and did not flag it as a substitution. If it substitutes something *unreasonable* silently, report it.

### A2. The pasted brief looks like a document before you send it

**Setup** Same as A1, but stop after the copy appears in the box — read it.

**Look for** `#` headings, `-` bullets, and a table whose header has a `| --- |` line under it, with rows on
contiguous lines.

**Fails if** table rows are separated by blank lines. That is not a table, the header stops meaning
anything, and it is why the Old Copy column got used.

### A3. Attaching a file is findable and keyboard-reachable

**Setup** Open the copy panel. Tab to **Attach a file** and press Enter. Cancel, then drag the `.docx` onto
the chat footer instead.

**Look for** a bordered button with a paperclip, reachable by Tab; `.docx` selectable in the dialog;
dropping works anywhere in the footer.

**Fails if** Tab never reaches it — it was a `<label>`, invisible to keyboard and screen readers — or
`.docx` is greyed out.

### A4. An unreadable format says something useful

**Setup** Try to attach a `.pdf`, then a legacy `.doc`.

**Look for** a message naming the format and pointing at paste. For PDFs it should not imply Word also
fails; for `.doc` it should name the legacy format specifically.

**Fails if** it contradicts itself, e.g. ".docx files can't be read … Word (.docx) works".

### A5. Pulling a URL still works

**Prompt**
```
8x8.com/partners
```
**Setup** Click **Pull content from a URL**, paste the above, click **Pull**.

**Look for** a short label in the transcript ("Pull content from …") rather than the whole page, and copy
used as reference rather than the layout being reproduced.

**Fails if** hundreds of words appear in the transcript, or images from that page end up as block imagery —
foreign URLs are not usable as assets.

### A6. A page-wide change edits, and does not rebuild

**Prompt**
```
Use # for all the links on this page, and "Learn More" for every CTA label.
```
**Setup** An applied page with imagery and links already in it — A1's output is ideal.

**Look for**
- A **changeset** with an **Apply changes** button, not a fresh page proposal.
- Rows naming each block and the fields changing.
- Your imagery and copy survive.

**Fails if** you get a whole new page and a **Replace Page** button. Accepting that discards every earlier
decision. This failed **3 of 3** before the fix — run it three times.

### A7. Changing a block's type swaps it

**Prompt A**
```
Change the "Why partner" section to a stats block instead.
```
**Prompt B**
```
The programme tiers would work better as a table than as cards. Change it.
```
Run both, separately, on the applied page.

**Look for** a **Swap N** row with **two thumbnails and an arrow** — outgoing and incoming — and friendly
names like "Content Split", not `content-split`.

**Fails if** a second block is added alongside the old one, or the block keeps its type and only its fields
change. Measured **3 of 5** before the fix, so sample this properly.

### A8. Adding one section adds one section

**Prompt**
```
Add a form section after the hero so partners can register their interest.
```

**Look for** a single **Insert** row.

**Fails if** the whole page is re-proposed. Note the form itself will not render — `hero-form` has no
form-selection property, see **Known gaps**.

### A9. A refused image is reported, not silently swapped

**Prompt**
```
Set the hero desktop image to https://www.8x8.com/assets/hero.jpg — use that exact URL.
```

**Look for**
- An amber line: **"Desktop image on hero-background is a placeholder — the image chosen was not in the
  asset library…"**
- And in the reply: **"⚠️ 1 image slot still holds a placeholder…"**
- Both appearing *even though the model's prose claims it set the image*.

**Fails if** the changeset applies with no mention of the substitution. That is "it listed these components
as edited and there are still no images".

### A10. Real imagery is found and used

**Prompt**
```
Build a landing page selling our phone systems to university clients, with good imagery.
```
**Setup** Empty canvas.

**Look for**
- Real library images on the page, not grey `placehold.co` boxes.
- Optional image slots left alone are **empty**, not grey boxes.
- A closing note: **"Optional fields left empty, if you want them: …"**.

**Fails if** every image is a placeholder while the reply claims the page is authored. Asset search matched
titles only until this month, so "campus building" returned nothing against a library that had the
photographs.

### A11. A generated image reaches the page

**Prompt**
```
Generate a real image for the hero and put it in.
```
**Setup** An applied page with an empty hero image slot.

**Look for** the image queues, the changeset carries it, and the real image replaces the placeholder in the
canvas within a minute or two.

**Fails if** images land in the asset library and never appear on the page, or the reply claims placement
and no op references them.

### A12. Undo puts it back

**Setup** Apply any changeset, then click **Undo**.

**Look for** the page returns to exactly its prior state, including imagery.

**Fails if** undo is missing after applying, or restores only some blocks.

---

## Part B — MCP

Run these from an MCP client pointed at the 8x8 registry. The chat and MCP now share the search policy, the
purpose lines and the scaffold, so several of these confirm a fix reached **both** surfaces — which is the
thing most likely to drift.

### B1. Asset search finds what exists

**Call**
```
handoff_search_assets { "query": "campus building", "type": "image" }
handoff_search_assets { "query": "student phone",   "type": "image" }
handoff_search_assets { "query": "library study",   "type": "image" }
```

**Look for** results for all three. Matching is per-word across title, alt text, description and tags.

**Fails if** any returns nothing. All three returned nothing before this month, against 127 images.

### B2. Asset search falls back, and says so

**Call**
```
handoff_search_assets { "query": "university staff", "type": "image" }
```

**Look for** results **and** a note that the match was partial — nothing matches both words, so this comes
from the looser any-word pass.

**Fails if** it returns nothing, or returns results with no note. The chat and MCP share this policy; if one
falls back and the other does not, they have drifted apart again.

### B3. Component listings say what each block is for

**Call**
```
handoff_search_components { "query": "copy" }
handoff_browse_components {}
```

**Look for** a **`use`** line on every entry. `simple-copy` should read *"Use for simple copy blocks such as
legal pages, terms, and informational text"*.

**Fails if** entries carry only `id, title, group, type, tags`. Choosing from names alone produced six
consecutive `simple-copy` blocks for a ten-section brief — it reads as a safe default for any text, and its
own guidance says otherwise.

### B4. Component search ignores word order

**Call**
```
handoff_search_components { "query": "split content" }
handoff_search_components { "query": "content split" }
handoff_search_components { "query": "statistics" }
```

**Look for** `content-split` in the first two, and `stats` in the third — which matches on its
*description*, not its name.

**Fails if** `split content` returns `[]` while `content-split` sits in the catalog. Verified failing on the
deployed build on 2026-08-03: it was a whole-phrase substring over id, title, group and tags only.

### B5. Scaffold args report measured shapes

**Call**
```
handoff_scaffold_args { "componentId": "image-gallery" }
handoff_scaffold_args { "componentId": "grid-columns" }
```

**Look for**
- `images` described as **`array of { src, alt } — every src from the asset store`**.
- `grid-columns.columns` described with its item shape including **`imageSlot: { src, alt }`**.
- Slots the probe found nothing for marked `editable: false`, with a note to leave them alone.

**Fails if** a nested image slot reads `HTML string`. That guess is why a gallery generated three images and
placed none.

### B6. Scaffold args mark required fields

**Call**
```
handoff_scaffold_args { "componentId": "faq" }
handoff_scaffold_args { "componentId": "stats" }
handoff_scaffold_args { "componentId": "image-gallery" }
```

**Look for** `required: true` on `questions`, `stats` and `images` respectively, and absent on optional
fields like `bodySlot`.

**Fails if** nothing is required. The gap guard depends on it — without it every optional field reads as an
unfinished page, which is what made it fire on every page ever composed.

### B7. Asset results are a summary, not a database dump

**Call**
```
handoff_search_assets { "query": "campus", "type": "image", "limit": 50 }
```

**Look for** each result carrying `id, title, assetType, mimeType, storageUrl, altText, description, tags,
width, height` — and nothing else. `handoff_get_asset` is where full detail lives.

**Fails if** results carry `sourceMetadata`, `svgContent`, `createdAt`, `storageKey` or `sourceType`.
Whole rows came to 102,000 characters for 50 images, 59% of it the generation prompt repeated per asset —
roughly 26k tokens for one search, in which the useful fields were a rounding error.

### B8. Instance writes still respect the contract

**Call**
```
handoff_create_preview {
  "componentId": "hero-background",
  "title": "QA contract check",
  "args": {
    "titleSlot": "QA check",
    "desktopImageSlot": { "src": "https://cdn.made-up.example/hero.jpg", "alt": "Invented" },
    "buttonSlot": [{ "url": "#", "text": "Learn More" }]
  }
}
```
Two deliberate mistakes: an image src from nowhere, and `buttonSlot` where `hero-background` has
`buttonSlots`.

**Look for**
- The invented src refused or replaced with a placeholder, not stored.
- `buttonSlot` corrected to `buttonSlots` and the value kept — a one-letter slip should not discard the
  change.

**Fails if** the made-up src is stored as given, or the button value vanishes with no mention.

*This one writes.* Delete the preview afterwards if you do not want it in the registry.

---

## Part C — Known gaps, so they are not filed as new

| Thing | Status |
|---|---|
| **Hero Form does not render and has no form picker** | Not an app or AI bug. The published `hero-form` contract is `anchor`, `theme`, `direction` and six slots — **no form property at all** — so nothing can supply a form and no editor can offer to pick one. Needs a schema change on the 8x8 side. |
| **The same prompt gives different layouts run to run** | Partly inherent. Narrowed by the catalog and brief-naming fixes; a Component column in the brief is the reliable way to pin it. |
| **PDF attachments refused** | Deliberate. PDF text comes back as positioned runs, so reading order interleaves wrongly on the multi-column exports marketing copy arrives as — it would produce copy that looks right and is subtly scrambled. |
| **`.doc` refused** | Deliberate; the converter reads `.docx` only. |
| **A config field appears in "Optional fields left empty"** | Known noise. `imageTheme` and similar enums are typed as text and read as content. Harmless — the note asks for nothing — but it lengthens the list. |
| **18 nested slots report as not editable** | Correct. Mostly `cardSlot`, where the whole item *is* a component element and there is no authorable shape to offer. |
| **Two components share the title "Content Split"** | `content-split` and `feature`. A brief naming it resolves to `content-split`, decided by its matching id rather than by catalog order. Worth tidying in the registry; not a defect here. |

---

## Recording results

| # | Scenario | Result | Runs | Notes |
|---|---|---|---|---|
| A1 | Word brief → page, New Copy column | | /3 | |
| A2 | Brief reads as a document in the box | | /1 | |
| A3 | Attach findable and keyboard-reachable | | /1 | |
| A4 | Unreadable format message | | /1 | |
| A5 | URL pull | | /1 | |
| A6 | Page-wide change edits | | /3 | |
| A7 | Type change swaps (both phrasings) | | /3 | |
| A8 | Add one section | | /2 | |
| A9 | Refused image reported | | /2 | |
| A10 | Real imagery found | | /3 | |
| A11 | Generated image placed | | /2 | |
| A12 | Undo restores | | /1 | |
| B1 | Asset search finds what exists | | /1 | |
| B2 | Asset search falls back and says so | | /1 | |
| B3 | Listings carry a purpose line | | /1 | |
| B4 | Component search word order | | /1 | |
| B5 | Measured field shapes | | /1 | |
| B6 | Required fields marked | | /1 | |
| B7 | Asset results are summarised | | /1 | |
| B8 | Contract respected on write | | /1 | |

A useful failure report is **what you sent, what you got, and how many of how many runs**.

## The automated suite, for context

Thirteen of these behaviours also run as evals — `npm run eval -- --all` — currently 26/26 across two runs
each. They assert on structure: which tools ran, which ops came back, which blocks were used. Never on
wording, because the reply was the one thing that read fine while the page was wrong.

What the suite cannot see is everything in Part A involving a click, a keypress, a thumbnail or what a card
actually shows. That is what this script is for.
