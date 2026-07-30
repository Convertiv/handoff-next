# Design — editing and refinement in the playground

**Status:** proposed, 2026-07-30. Phase 2 of `PLAYGROUND-PLAN.md` covered pre-apply refinement; this is
the rest of it.

## The problem with what exists

Three ways to change a page, none of which talk to each other:

| | Works on | Mechanism |
|---|---|---|
| Proposal card swap/reword | blocks in a **pending proposal** | scoped server call, one block |
| Follow-up chat turn | the **canvas**, sort of | re-proposes the *whole page*, user applies with replace |
| Left-rail editor, drag, delete | the **canvas** | manual, per field |

The middle row is the weak one. Say *"make the headline shorter"* to a nine-block page and you get nine
blocks back, of which eight are unchanged — expensive, slow, and it silently re-rolls copy you were
happy with. Ask to *"add a pricing section"* and there is no mechanism at all.

And a page you saved and reopened is not editable by chat in any meaningful way, which is the case that
matters most: the second session with a page is where the real work happens.

## The model: the canvas is the truth, and the chat proposes operations against it

One mechanism instead of three. Every AI change is an **edit operation** on the canvas:

```
update  { index, componentId, values }   change some fields, keep the rest
replace { index, componentId, values }   swap the block for a different one
insert  { index, componentId, values }   add a block at a position
remove  { index, componentId }           delete a block
```

Building a page from nothing is the degenerate case — `propose_page` stays for that. Everything after
the first apply is operations.

**`update` is the point.** *"Make the headline shorter"* becomes `update block 2 { titleSlot: "…" }` —
one field, one block. It cannot accidentally reword the pricing section, it costs a fraction of the
tokens, and the diff is legible. That is the difference between refinement and regeneration.

### Why operations carry `componentId` as well as `index`

Positional reasoning is where this gets things wrong — *"before the footer"* on a page with two
footers. Rather than trying to prompt around it, every operation names both the index **and** the
component it expects to find there, and the apply step verifies they match before touching anything.

A mismatch means the model's mental model has drifted from the canvas — someone dragged a block, or a
previous op shifted the indices. Rejecting the operation and saying so is right; editing the wrong
block silently is not. Cheap guard, same shape as the enum and asset-source checks that already earn
their place.

Operations apply **in descending index order** so an insert or remove cannot invalidate the indices of
operations that follow.

### What the user says, and what it becomes

| Request | Operation |
|---|---|
| "make the hero headline shorter" | `update` 2 · `{ titleSlot }` |
| "the CTA should say Book a Demo" | `update` 8 · `{ buttonSlots }` |
| "I don't like the bubble hero" | `replace` 2 · a different hero |
| "add a pricing section before the CTA" | `insert` 8 |
| "drop the FAQ" | `remove` 6 |

All of these already work as sentences today and produce a whole-page re-proposal. The vocabulary is
not new; the mechanism is.

## Saved pages fall out for free

Load a saved page → the canvas populates → composition awareness already sends what is on it → the same
operations apply → "Update page" saves through the existing path. No separate saved-page editing mode,
which is exactly what we should avoid building.

## The changeset card

The proposal card becomes a **changeset**: *"Update block 2 · Replace block 5 · Add a pricing section
after 7"*, with the affected blocks' thumbnails. Apply all, or reject individual operations before
applying — mirroring what the per-block controls already do.

**Undo matters more here than anywhere else so far.** Applying to a pending proposal costs a click;
applying to a page someone has been editing for twenty minutes costs their work. The client holds the
pre-apply block list and offers a single Undo on the card. That is a few lines and it is the difference
between people trusting the chat with a real page and not.

## Scope for a first cut

**In:** `update`, `replace`, `insert`, `remove`; index + componentId verification; descending-order
apply; the changeset card; undo.

**Out for now:**
- **`reorder`.** Drag already does this well, and it is the operation most likely to be got wrong.
- **Multi-turn op planning.** One turn, one changeset.
- **Retiring the pre-apply per-block controls.** They overlap with `replace`, but they work and removing
  them is a separate decision. They should be re-expressed in the same op vocabulary internally so the
  two paths cannot drift.

## Risks

- **Wrong-block edits** are the main one, and the componentId check is the answer. Worth logging every
  rejection: a model that consistently mis-indexes is a prompt problem we would otherwise never see.
- **Partial application.** If op 3 of 5 fails verification, do the others still apply? Proposal: yes,
  apply what verifies and report what did not — an all-or-nothing rule would let one stale index throw
  away four good edits. The card must then be honest about what actually happened.
- **`update` on a field the model has not seen.** It only knows field names from `list_blocks`; the
  merge already reports invented keys, so this surfaces rather than silently dropping.
