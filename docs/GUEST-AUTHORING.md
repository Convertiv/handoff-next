# Guest authoring — templates, write-capable share links, and a review queue

**Status:** 2026-08-05. Requested by SS&C (Craig, Andrew) during the playground demo on
`ssc-handoff.vercel.app`. **Slice 0 shipped. Slice 1 backend foundation landed** — migration
`0025_guest_authoring`, capability vocabulary, guest principal + policy guards, the two-part token
model, share-link create/resolve/consume/revoke, the guest write core, the signed session cookie, the
guest HTTP routes (`/api/handoff/guest/enter`, `…/submission`, `…/submission/submit`, `…/assets`), and
the `/s/[token]` authoring UI. **Slice 1 is complete and verified end-to-end in a browser** (migration
`0027_guest_authoring` applied; full flow driven, rows inspected, negative cases checked, test data
removed — see DEVLOG 2026-08-05). **Slice 2 (review inbox + approve, browser and MCP) is built and
server-verified**; its UI still needs a visual pass by a signed-in maintainer. Slice 3 (guardrails) is
next.

**Known limitation:** the guest sees fields in Postgres `jsonb` key order (sorted by key length, then
bytewise), not authoring order — so a headline can appear below its body copy. Ordering the insert cannot
fix it; it needs an explicit field order from the template or the descriptor layer. Slice 3.

### How a guest edit is stored

Edits go into the **override layer** — `data.previews.default.values[i]` — never into
`components[i].args`. Three reasons: the template's own args stay pristine, the review diff *is* the
values array, and it matches the precedence the playground already uses when loading a saved pattern.

The trap, encoded in `applyOverride` with tests: `mergeBlockArgs` is a **shallow** merge, so an override
holding a partial `{ slot: { props: { src } } }` would replace the template's whole element node and drop
`type`/`width`/`className` — the block stops rendering. Edits are therefore applied to the *merged* args
and the affected **top-level key is written whole**. This is the 2026-07-31 element-shape bug arrived at
from a new direction.

Editable fields are derived from **real values** (`collectEditableText` / `collectImageSrcs`), not from
field descriptors, for the same reason: descriptors misreport shape, and an image src usually lives at
`props.src` rather than where the descriptor claims. Structural strings (`className`, `type`, `href`, …)
are excluded so a guest can't silently break a block, and a `picture` with several sources counts as one
slot. Picking a new image also carries the asset's alt text into a sibling `alt`, because a swapped image
keeping the old alt describes the wrong picture.

**Scope:** a power user saves a *template*; they send a link to someone with no Handoff account; that
person builds a page from the template inside guardrails; the result lands in a queue where Craig and
Andrew approve it into the library. Available over MCP as well as in the browser.

---

## The one-sentence version

**Today a share token grants read. They want it to grant scoped write.** Almost everything else this
feature needs is already in the schema; the work is capabilities on the token, an actor who isn't a
user, and a queue view for the two people doing the approving.

---

## What already exists (do not rebuild any of this)

Worth being precise here, because the gap is much narrower than the ask sounds.

| Need | Already there |
|------|---------------|
| The template/page primitive | `handoff_pattern` ([schema-pg.ts:122](../src/app/lib/db/schema-pg.ts)) — `components`, `data`, `thumbnail`, `source` (`playground \| build \| import \| ai`) |
| Review lifecycle | `handoff_pattern.status` — `prototype \| draft \| review \| approved \| archived`, authoritative list in [`lib/authz/vocab.ts`](../src/app/lib/authz/vocab.ts) |
| Visibility | `handoff_pattern.visibility` — `private \| shared \| team \| public` |
| Permission computation | `computePermissions` in [`lib/authz/policy.ts`](../src/app/lib/authz/policy.ts), already returns `canApprove` |
| Share links | `handoff_share_link` (token, resourceType `pattern \| design_artifact`, `expiresAt`, `revokedAt`) + create/revoke/get at [`api/handoff/share`](../src/app/app/api/handoff/share/route.ts) + public viewer `app/s/[token]`, noindex, safe field subset |
| Submission audit trail | `handoff_pattern_change` — append-only, one row per create/update/delete, carries `pushed_by_user_id`, `pushed_by_name`, `trigger`, `message`, `ai_summary` |
| One write path for HTTP *and* MCP | `pattern-write.ts` — `assertCanMutatePattern` lives inside the write core precisely so another caller can't bypass it |
| Per-user grants | `handoff_resource_grant` exists and is **read-only in the codebase — nothing inserts a row** (see [DEMO-8X8-WORKBENCH.md:217](DEMO-8X8-WORKBENCH.md)). Don't claim it works. |

Roadmap alignment: this is **B.2** (share links with tokens) and part of **B.3** (per-resource grants)
in [WORKBENCH-PLAYGROUND-ROADMAP.md](WORKBENCH-PLAYGROUND-ROADMAP.md). It is not a new track.

---

## Gap 1 — A token that writes, and an actor who isn't a user

`VISIBILITY_META.public` currently reads *"Anyone with the link — read-only."* That sentence is the
feature request.

Two changes, and they are inseparable:

**Capabilities on the link.** `handoff_share_link` gains a `capabilities` column (jsonb) rather than a
boolean `canEdit`, because the demo already implies at least four independent axes: create a page from
this template, edit that page, generate images, submit for review. A budget and a use counter belong
here too (see Gap 5).

**A guest principal.** Every write path in the app resolves `session.user.id` and every authz decision
takes a `MutateActor { userId, role }`. A guest has neither. The seam is `MutateActor` — widen it to
carry a token-derived principal (`{ kind: 'guest', shareToken, capabilities }`) and teach
`computePermissions` about it. Do **not** mint a fake user row per visitor; that pollutes `users` and
every "everyone in this workspace" query built on it.

**Attribution is not optional.** The moment a guest writes, `handoff_pattern_change.pushed_by_user_id`
is null and the review queue cannot say who submitted anything — which is the entire point of routing
work back to Craig and Andrew. So the guest session captures a display name (asked for on entry, no
account, unverified and labelled as such) and writes it to `pushed_by_name` with
`trigger: 'guest'`. An unverified name plus the token that admitted them is enough provenance for a
human reviewer; it is not an identity claim, and the UI must not present it as one.

**Known wall:** [QA-SCRIPT.md:13](QA-SCRIPT.md) already records that *an anonymous session silently
cannot generate*. That is exactly what a guest hits today, and it fails silently. Fix the silence
(Slice 0) before handing the link to anyone outside the building.

---

## Gap 2 — A template is not a saved page

A `handoff_pattern` today is a page someone saved. A template has to answer two questions a saved page
never does: **which blocks may change**, and **what will each field accept**.

Resist a parallel template schema. Put field constraints on the **field descriptors** — the
[FIELD-BRIDGE](FIELD-BRIDGE.md) layer — so one declaration validates in three places: the EditSheet as
the guest types, `pattern-write` on submit, and MCP when a model fills the same field. Three
hand-rolled copies of "headline max 60 characters" is how they drift.

Minimum viable template:

- `source: 'template'` on the pattern (the enum already has room).
- A `templateId` pointer on derived patterns, so review can diff child against parent and a reviewer
  sees *what the guest changed*, not a wall of blocks.
- Per-block `locked: boolean` and an `allowedComponentIds` allow-list for the addable slots, stored in
  the pattern's `data`.

**Trap, learned three times already:** never trust `editorType`/`shape` over the actual preview value
(DEVLOG 2026-07-31). Constraints must be derived and validated against the real value shape, the same
way `summarizeFields` does.

---

## Gap 3 — The review inbox — ✅ BUILT (Slice 2)

`/review` (maintainer-gated), `GET /api/handoff/review` (queue), `GET /api/handoff/review/[id]` (diff),
`POST /api/handoff/review/[id]` (verdict), plus `handoff_list_review_queue` and `handoff_review_page` over
MCP.

**The gate moved, which was the prerequisite.** It used to live in the `setPatternMeta` *server action*,
so MCP could not set status without duplicating it. It now lives in `decidePatternMetaChange` /
`decideReview` (client-safe, tested) and is enforced by `applyPatternMeta` / `reviewPattern` in the write
core. The server action, the HTTP routes and the MCP tools are all thin wrappers over that one gate.

Decisions taken while building it:

- **Reject requires `canApprove`, not `canEdit`.** Otherwise the submission's *owner* — the link creator,
  who owns every guest page by design — could clear the queue without being a maintainer.
- **Reject returns the page to `draft`**, which is exactly what re-opens guest editing
  (`canGuestEditPattern` requires `draft`). So "send back with a note" is the same mechanism as "ask for
  another pass" — no separate state needed.
- **Only a page actually in `review` can be decided**, enforced again in the UPDATE's `WHERE` so two
  reviewers racing can't both record a verdict. The loser gets a 409, which is what a stale queue view
  deserves.
- **Approving never changes visibility.** Promoting a page to a wider audience stays a separate,
  deliberate act — which is also why open question 1 below is still open rather than answered by accident.
- The queue is **one query** (lateral join for the latest guest change) using the `pattern_status_idx` from
  `0027`; a fifty-row queue would otherwise be fifty extra round trips.

### The original gap, for context

The status enum is there; the queue is not. What's needed:

- A list view over `status = 'review'` with owner, template, submitted-by, and a diff against the
  parent template.
- Approve → `status: 'approved'` (and whatever visibility promotion the library expects). Reject →
  back to `draft` with a comment; comments have no home today, so either add one to
  `handoff_pattern_change.message` on a `reviewed` action or accept that rejection is verbal at first.
- **Where the gate lives matters.** The roadmap notes the approve gate currently sits in a *server
  action*, and there is no MCP visibility/status setter. Since SS&C want MCP, that gate has to move
  into the write core before an MCP approve tool exists — the same reason `assertCanMutatePattern` is
  inside `pattern-write.ts` and not in a route handler.
- `handoff_promote_preview` is the closest existing analogue (Loop A approve → `semantic:'canonical'`).
  Match its shape so there's one approval idiom, not two.

---

## Gap 4 — Guardrails, and the iframe wall

Content-length limits fall out of Gap 2 for free. Accessibility checking does not, and there is a hard
architectural constraint to design around **now**:

**The preview iframe is deliberately opaque-origin sandboxed** (`srcdoc` + `postMessage` + CSP — it was
a fixed vulnerability, not an accident). A parent-frame checker **cannot read the preview DOM**. Any
check that needs rendered output — heading order, tab order, computed contrast, focus visibility — has
to run *inside* the iframe and post results out, which means the checker ships with the preview bundle
and becomes part of the preview contract.

Split accordingly:

- **No DOM needed (do first):** content length, alt-text presence, empty-required-field, link text
  quality, contrast computed from *token pairs* rather than rendered pixels. All of this is available
  from field values and the token resolver.
- **In-iframe agent (do second):** heading order, tab order, focus visibility, real computed contrast.

Guardrails are advisory-plus-blocking, and which is which should be explicit: length limits block
submission, accessibility findings annotate the review queue. A guest who cannot submit because of a
contrast warning on a component they did not write is a support ticket.

---

## Gap 5 — Cost and abuse (this is an unauthenticated write endpoint)

Anonymous image generation is metered spend behind a URL that will end up in an email thread.

- Per-link **generation budget** (count, not just rate) stored on the share link, decremented by the
  worker.
- Rate limits on every guest-writable route.
- **Hash the token at rest** once it can write. It is currently the primary key in plaintext, which is
  defensible for a read-only viewer and not for a write capability.
- Expiry is optional in the schema today — make it **required** for write-capable links, with a short
  default.
- Guests write only into `review`; they cannot read other patterns, list the library, or touch
  anything they did not create through the link. Enforce in the write core, not the route.

---

## Slices

**Slice 0 — Queue observability (prerequisite, do first).** The demo failed because `CRON_SECRET` was
unset on the SSC project, so the drain 503'd every tick, jobs sat `pending` forever, and the client
polled for 15 minutes before saying anything. The reaper that would have marked them failed lives
*inside the same dead route*. A guest watching an infinite spinner with nobody to ask is strictly worse
than that happening in front of you. Ship a definite, fast, honest failure first.

**Slice 1 — Write-capable share links.** `capabilities` on the link, guest principal through
`MutateActor`, guest attribution in `pattern_change`, a `/s/[token]` authoring route. Acceptance: a
logged-out browser opens a link, builds a page from a template, submits, and the submission shows a
name and the originating token in the changelog.

**Slice 2 — Review inbox + approve.** Queue view, approve/reject, diff-against-template, approve gate
moved into the write core, then the MCP tools. Acceptance: Craig approves from the browser and from
Claude, and both produce the same rows.

**Slice 3 — Guardrails.** Field constraints first (blocking), in-iframe a11y agent second (advisory).

---

## One link, many recipients — what actually happens

Send one link to two people and **each gets their own page.** The link is a grant against the
*template*; entering it starts a session, and the first edit creates a child pattern carrying
`template_id` (what it came from) and `share_link_token` (which link admitted its author). Two
recipients produce two children from the same template, each editable only by its own session, both
landing in the review queue separately. Nobody sees or overwrites anyone else's work — that isolation is
the `share_link_token` check in `canGuestEditPattern`.

The part to be honest about: **the unit of identity is a browser, not a person.** The session is a signed
cookie, so —

- the same person on a laptop and a phone gets **two** drafts;
- two people sharing one browser profile share **one** draft;
- clearing cookies orphans the draft — the page still exists and the owner still sees it, but that guest
  can no longer reach it and will start a new one.

That is inherent to authoring without accounts, and it's exactly why the review queue shows a
self-declared name and the link that admitted them rather than an identity. `maxUses` therefore caps how
many *sessions* a link admits, not how many people — and a reload does not spend one (resume happens
before consume).

Once a guest submits, their page locks (`canGuestEditPattern` requires `draft`). Entering the link again
starts a **new** page rather than dead-ending on the locked one; the submitted page is untouched.

## Decisions taken (were open questions)

- **No guest image generation** (Brad, 2026-08-05). Guests pick from the existing asset library only.
  Enforced by *absence* — there is no `generate_image` capability to grant, and a test pins that.
- **A guest submission is owned by the link's creator**, with the guest's unverified name as submitter.
  The page has to belong to a real user so it lands in a library and cleans up with that owner; a
  null-owner row would be team-editable by everyone (`canMutatePattern`). The guest's claim on the page
  is `share_link_token`, not ownership — which is exactly why that column exists.
- **The link is a template grant, not a page grant.** `resourceId` points at the template; each guest
  creates a child carrying `template_id` + `share_link_token`. One link, many submissions.

- **A guest resumes via a signed session cookie** (Brad, 2026-08-05), one per link
  (`handoff_guest_<linkId>`), carrying only `{ linkId, submissionId, name, exp }`. Capabilities are
  re-read from the link row on every request so revocation is immediate, and the session can never
  outlive the link's own expiry.

## Still open

1. **Is `shared` visibility the same thing as a share link?** The schema has a `shared` visibility
   *and* a share-link table, while roadmap B.1 describes the enum as `private → team → public`. Guest
   submissions currently start `private`, which sidesteps it — but the review queue's promote step
   (Slice 2) has to answer it, or the lanes will lie.
2. **Should an orphaned draft be reclaimable?** A guest who clears cookies leaves a `draft` nobody can
   reach. Options: let the owner adopt or delete it from their library, or sweep unsubmitted guest
   drafts after N days. Neither exists yet; the rows are harmless but they accumulate.
3. Is this per-deployment or per-team? Tenancy is currently team-within-deployment.

---

## Why this matters beyond the ask

It moves Handoff from a design-system *reference* to the surface where content actually gets produced,
with the library as the approval gate — on primitives that already exist. That is a wider wedge than
the playground alone, and it is the first feature where the guardrails are the product rather than a
nicety.
