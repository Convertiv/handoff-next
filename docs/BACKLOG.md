# Backlog

Work worth doing that is not in flight. One heading per item, newest first. Items graduate out of here
into a branch; delete them when they land.

---

## In-iframe accessibility checking for authored pages

**Raised** 2026-08-05 (deferred out of guest-authoring Slice 3 — Brad: "a nice stretch goal"). **Size**
substantial: it changes the preview contract, not just a lib.

Slice 3 shipped the guardrails that need no rendered output — length limits, required fields, missing alt
text, weak link text — in `src/app/lib/authoring-guardrails.ts`. What is left is everything that needs the
**rendered DOM**: heading order, tab order, focus visibility, and real computed contrast (as opposed to
contrast derived from token pairs).

### Why it is not a small addition

The preview iframe is deliberately **opaque-origin sandboxed** (`srcdoc` + `postMessage` + CSP — a fixed
vulnerability, not an accident, see `project-preview-render-isolation`). A parent-frame checker therefore
**cannot read the preview DOM at all**. The checker has to run *inside* the iframe and post results out,
which means:

- it ships with the preview bundle and becomes part of the preview contract (versioning, size, failure
  modes when an older preview lacks it);
- results arrive asynchronously over `postMessage` and have to be correlated with the block that produced
  them;
- a preview that fails to load must read as "not checked", never as "passed".

### Shape when it is picked up

- Advisory only, annotating the review queue alongside the Slice 3 findings — the same severity split
  already implemented (`GuardrailFinding.severity`), so the plumbing exists.
- Reuse the existing finding shape so the review UI needs no new rendering.
- Token-pair contrast (no DOM needed) is the cheap half and could ship first, from the token resolver.

## Document the authoring model for the Handoff site, and write developer guides

**Raised** 2026-08-04. **Size** substantial — a documentation project, not a task.

There is now a real architecture behind how a component becomes something a person or a model can author,
and it exists only as design notes in `docs/` and as comments in the code. Anyone arriving at this
codebase — or any developer preparing a component library for Handoff — has to reverse-engineer it, which
is exactly what took a week of QA reports to surface.

### What needs documenting

Each of these is currently a design note written for whoever was in the problem at the time, not for a
reader coming fresh.

| Concept | Where it lives now | What a reader needs |
|---|---|---|
| **Slot probing** — why prop shapes are measured by rendering rather than declared | `docs/SLOT-PROBING.md`, `docs/SLOT-PROBING-OPERATIONS.md` | Why it exists at all; what a `capabilities` record means; how to read an `accepts` list; what `unresolved` does and does not prove |
| **The encoding library** — the fixed vocabulary of prop shapes | `src/app/lib/slot-capabilities.ts` comments | The list, what each means, how to add one, why it is closed rather than open |
| **The `of:` authoring vocabulary** — what one array item is | `src/app/lib/authoring-shapes.ts`, `docs/AUTHORING-BRIDGE.md` | The terms, which carry a shape and which deliberately do not, how to declare `item:` |
| **The props → authoring bridge** | `docs/AUTHORING-BRIDGE.md` | The whole argument, and what a component author should write in `blocks/<id>/<id>.js` |
| **`probeContext`** — the escape hatch for components that render nothing empty | one line in `preview/types.ts`, and 11 worked examples in 8x8's blocks | That it exists; how to tell it is needed; that an empty `unresolved` list can mean the probe never loaded |
| **Field annotations** (`fields`, `editorType`, `render`, `of`, `item`) | scattered; the best explanation is a comment inside 8x8's own `image-gallery.js` | A single reference: every key, what reads it, what happens if you omit it |
| **The agent contract** — what the chat and MCP see and why | `docs/AGENT-TESTING.md`, `docs/PLAYGROUND-ASSETS.md` | How a block's schema becomes an MCP scaffold; why measured shapes beat declared ones |
| **Eval suite** — how behaviour is tested | `docs/AGENT-TESTING.md` | How to add a case; why rates rather than pass/fail; how to avoid a case that cannot fail |

### Guides worth writing, by audience

1. **"Preparing your component library for Handoff"** — for a developer with an existing React library. What
   Handoff reads, what it measures, what it cannot infer, and the smallest set of annotations that produces
   a good authoring experience. This is the one with the most leverage and does not exist in any form.
2. **"Why your slot is not editable"** — a debugging guide. Read the capability record, tell a genuine
   *unauthorable* slot from a probe artefact, add a `probeContext`. Would have saved two of this week's
   reports.
3. **"Authoring contracts vs prop contracts"** — the conceptual piece. `docs/AUTHORING-BRIDGE.md` is the
   draft; it needs rewriting for someone who has not been in the problem.
4. **"Building with the MCP tools"** — for an agent author. Which tool answers which question, the
   browse-then-inspect split, why an asset search returns a summary.

### Notes for whoever picks this up

- The design notes are honest but are written *inward* — they justify decisions to someone who knows the
  history. They are raw material, not drafts.
- Several carry measured numbers (encoding counts, eval rates, payload sizes). Those date fast. Either
  re-measure when writing or attribute them to a date, as the notes do.
- The site needs a home for this. It is neither component documentation nor foundations — it is
  "integrating with Handoff", which may be a new top-level section.
- Worth writing *after* the sequencing in `docs/AUTHORING-BRIDGE.md` Part 6 settles, because the item-shape
  vocabulary and `sync-handoff-blocks.ts` changes will alter what an author is told to write. Documenting
  it now risks documenting a shape that is about to change.

### Related, and possibly first

`docs/AUTHORING-BRIDGE.md` Part 6 lists the code work this documentation would describe. The last item
there — whether the projection should be shared with the production wrapper — is an open architectural
question that changes what the guides say. Worth resolving before guide 1 is written.
