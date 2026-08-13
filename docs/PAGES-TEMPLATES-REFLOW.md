# Pages, Templates and the anonymous build loop — the reflow

Working document, opened 2026-08-13 on `feature/pages-templates-reflow`, after a UX session with Natko and
Domagoj about hardening the prototype.

> **Primary directive (Brad):** *UX that makes sense to me as a dev doesn't make sense to end users.*

Everything below is measured against that. Where the current model exists because it is *correct*, and the
correctness is invisible to the person using it, the correctness moves somewhere they never have to look at.

---

## 1. The model

Three nouns in the product. Not four.

```
Design                 an image + context from the workbench            (unchanged)

Page  ◀── owns ──┐     someone's document. Editable forever.
  │              │
  │ promote      │
  ▼              │
Template ──▶ share link ──▶ anonymous build session ──▶ NEW Page ──┘
             (always current,           (same editor as today)      │
              multi-use)                                            └─▶ return link, emailed
```

| Product word | What it is | Storage today |
|---|---|---|
| **Design** | workbench output | `handoff_design_artifact` |
| **Page** | a working document; anyone's, including one an anonymous guest made | `handoff_pattern` |
| **Template** | a Page marked as "others may build from this" | `handoff_pattern` |

**"Build" and "brief" stop being nouns.** A build *was* a distinct kind of thing with its own panel, its own
lifecycle and its own review surface. It becomes a Page that happens to know where it came from.

### What a person does

1. Creates a page. Edits it, generates with AI, whatever — unchanged.
2. Marks a page as a template (or starts a new one as a template — same editor either way).
3. Shares the template. One link, multi-use, always reflecting the template **as it is right now**.
4. A stranger opens the link, gets the guest editor exactly as today, and submits.
5. Submitting **creates a Page**, owned by the template's owner, carrying who made it, from which template,
   when, and what the validation said at that moment.
6. The stranger gets a private link back to *their* page — shown on completion and emailed — and can return
   and keep editing.
7. Re-opening the *template* link starts a second, separate page. It does not resume the first.
8. Owner and creator hold a threaded conversation on the page; the owner drives its status.

---

## 2. Decisions that have to be right

### 2.1 Snapshots die as a noun, survive as data ⚠️

Brad: *"we'll get rid of the snapshots. When a user creates a share link, it always just shares the current
state of the template."*

Agreed for the **UX**, with one correction to the **storage**.

The reason briefs are frozen today is written down (`INVITE-TO-BUILD.md`, "Why a middle layer at all"): a
reviewer opening a built page next month sees what its author actually started from. Drop the frozen copy
entirely and the page's own diff — "what did this person change versus what they were handed" — silently
re-bases against a template that has moved on. The validation record you want to capture becomes
unfalsifiable, which is worse than not capturing it.

**So: no brief object, no versions to manage, no snapshot in the product — and a fork-time copy written onto
the created page as provenance.** Nobody names it, lists it, versions it or cleans it up.

⚠️ **Correction from building R.2: the record is written *twice*, not once.** This section originally said "one
row, written once, at submit" — which cannot work. The copy has to be taken when the guest is *handed* the
template, because the template stays live; capturing at submit captures whatever it had become by then, which is
exactly the drift the record exists to prevent. So it is **append-only in two moments**: `buildProvenance` at
fork records what they were given, `completeProvenance` at submit records what happened when they let go. Neither
overwrites the other. Verified by moving the template between the two — `npm run verify:guest`.

| | Today | Reflow |
|---|---|---|
| Frozen copy exists | yes, as a **brief** you create and version | yes, as a **field on the created page** |
| Who sees it | authors manage briefs v1/v2/v3 | nobody; it backs the diff |
| Sharing targets | a brief | the template, live |
| Diff stays honest | yes | yes |

### 2.2 One creation path

Two buttons — "New page" / "New template" — is the dev-shaped version of a distinction that only exists at
share time. **Creating always makes a Page**; *Make this a template* is a promotion, and the Templates lane
fills itself. A "New template" entry point may exist as a shortcut, but it must open the same editor with the
kind preset — never a different-feeling flow.

Corollary: **demotion must work too.** Un-marking a template with pages already built from it does not orphan
them; provenance already points at the id.

### 2.3 Two kinds of link, one mechanism

The vocabulary already exists — `ShareCapability` is
`view | create_from_template | edit_own_submission | use_asset_library | submit_for_review`, and
`handoff_share_link` already carries capabilities, `tokenHash`, `maxUses`, `expiresAt`, `revokedAt`,
passphrase + lockout.

| | Template link | Page return link |
|---|---|---|
| Points at | the template | one created page |
| Capabilities | `create_from_template`, `use_asset_library`, `submit_for_review` | `view`, `edit_own_submission` |
| Uses | many | one recipient, many visits |
| Created by | the owner, deliberately | the system, at submit |
| Delivered by | the owner (copy/paste) | shown on completion **and emailed** |

Both revocable from the page/template they belong to. **This is the whole of the new sharing work** — the
machinery anticipated it.

### 2.4 Ownership, attribution, and what a stranger's word is worth

- **Owner** = the template's owner. Every page built from their template is theirs, appears in their library,
  counts against their quotas.
- **Creator** = the anonymous guest, identified by the email they gave and by the link they hold.
- The emailed return link is what makes the email address mean something — it is the same proof a magic-link
  sign-in offers, and no more. Provenance should record it as *self-asserted, confirmed by delivery*, never as
  an identity.

### 2.5 The review surface moves onto the page

Validation, findings, voice check and lifecycle live in `BuildPanel` today. They become **the page's own
review surface**, which raises one question that must not be answered by accident: **a page that nobody built
from a template must not be dragged through a submission workflow.** Findings are advisory on every page;
*submission*, *decision* and *notification* only exist where a page has provenance.

---

## 3. Data model deltas

Additive first, destructive later — the same discipline that made the last two schema moves cheap. Migrations
are hand-written and idempotent (never `db:generate`; the snapshot has drifted).

**`handoff_pattern`**

| Column | Change | Why |
|---|---|---|
| `kind` | **new** — `'page' \| 'template' \| 'brief'` | What it *is*, separated from `source` (how it got here: playground / ai / import / guest). Conflating the two is what made `source: 'template'` mean three things. `brief` is transitional and retired at R.5 — relabelling existing briefs as templates would put v1, v2 and v3 of one page in the Templates lane. |
| `template_id` | **repointed in R.2, not R.0** | Today it means "the brief I was built from" and the review diff reads it. R.0 stages the new value inside `provenance.templateId`, where nothing reads it yet, so main stays deployable; R.2 moves the readers and the column together. |
| `provenance` | **new** jsonb, nullable | `{ templateId, templateUpdatedAt, forkedAt, submittedAt, shareLinkToken, submittedByEmail, blocks, findings }` — the fork-time copy and the validation record as it stood at submit. |
| `source_page_id`, `brief_version` | **deprecated** | Brief-only. Keep the columns until the backfill is proven, then drop. |

**`handoff_page_note`** — new, threaded.

```
id · pattern_id · parent_id (self, nullable) · author_user_id (nullable)
author_guest_email (nullable) · body · created_at · resolved_at (nullable)
```

Exactly one of `author_user_id` / `author_guest_email` is set. Threading is one level deep unless a real need
for more appears — a nested tree in a side panel is a dev-shaped affordance.

**Backfill.** Existing rows: `source: 'playground' → kind: 'page'`; `source: 'template'` (briefs) →
their built pages absorb the brief's blocks into `provenance.blocks`, then the brief rows are retired.
`source: 'guest' → kind: 'page'`, `template_id` rewritten from brief → the brief's `source_page_id`.
**Write the backfill so it can be re-run**; the first pass will be wrong about something.

---

## 4. Surfaces

| Surface | Change |
|---|---|
| **Library** | ✅ Three kinds in the type facet: Designs · Pages · Templates. Note the axis: *lanes* are Yours/Shared/Team/Public (access), *kinds* are the facet. `AssetCard` reads `kind`, not `type`. |
| **Page editor** | Unchanged. This is the point — one editor for pages, templates and guest submissions. |
| **Page → provenance** | New panel on a page that has provenance: who, from which template, when, the validation as submitted, and a link to the template as it is *now*. |
| **Page → notes** | Threaded conversation, owner + creator. Status control stays where it is (`MetaControl`). |
| **Share dialog** | ✅ Collapsed: one screen, *Share this template* → link. Instructions and content limits moved onto the **template** (editable later without touching the link). "Max uses" is gone — it counted sessions; the cap is 50 **pages**, stated rather than configured. |
| **Guest flow** | Unchanged up to submit. After submit: a completion screen carrying the return link, and the same link by email. |
| **Admin** | New **CMS integrations** tab (§5). |

---

## 5. CMS integration

Two tracks. **They are not the same size and should not ship in the same order.**

### 5.1 Track A — the migration prompt (first)

If someone has both the Handoff MCP and the HubSpot or Sanity MCP connected, emit a **"move this page to the
CMS" prompt**: the page's blocks and content in a machine-readable payload, plus instructions for working out
the mapping.

Why first: it is days rather than weeks, it needs no OAuth, no token storage and no admin surface — and it
**teaches us the mapping shape from real runs**. Every failure is a note about what an adapter would have to
know. Building the adapter first means encoding guesses.

### 5.2 Track B — OAuth adapters (after A has taught us something)

Admin gains a **CMS integrations** tab: provider credentials come from env per deployment, an operator
activates a provider, and a user then connects their own account.

- **HubSpot** — OAuth is the normal path. Pages are assembled from a template with DnD areas plus module
  content, so the mapping is *Handoff block → HubSpot module* + field-to-field. The lazy alternative (dump
  HTML into a rich-text module) works and destroys editability; it is a fallback, not the design.
- **Sanity** — ⚠️ worth confirming before building: third-party **writes** are normally token-scoped
  (project + dataset), not user OAuth. The mapping target is a document type with a `blocks[]` array. 8x8
  already ships `studio/schema.json`, which is a machine-readable target — the first mapping should be
  derived from it rather than authored by hand.

**The mapping is the product, not the OAuth.** It needs to be a first-class, inspectable artifact — block id →
target type, field path → target field, with a **dry-run diff** so an operator sees what would be created
before anything is. This is roadmap **D.1**'s `publish(target, resource)` abstraction; this is its first real
consumer, and it should not grow a second, parallel one.

---

## 6. Security and abuse

Not optional, because this is the first surface where **an unauthenticated stranger causes a row to be
written**.

- **The emailed return link is a bearer credential in an inbox.** ✅ Revocable by the owner from the share
  screen; only the hash is stored; scoped to one page with `view` + `edit_own_submission` and nothing else; a
  re-submission revokes the previous one so a page has at most one live return link. **Deliberately no
  expiry** — it is the author's only way back, and an expiry would strand it silently; revocation is the
  control, and it is deliberate rather than accidental.
- ✅ **Rate limits** on enter / create / submit (`lib/rate-limit.ts`), plus the 50-page cap per link. ⚠️ The
  limiter is **in-memory and per-isolate** — it slows a burst, it does not bound the damage. The durable
  ceiling is the page cap, counted in the database.
- **A bot check on the anonymous submit path**, at least where a link is public rather than sent to a named
  person.
- **Never log link secrets**, and keep them out of URLs in analytics.
- Owner-facing: a template's link list must show uses, last use and a one-click revoke.

---

## 7. Sequencing

Each phase leaves the product working. Nothing here needs the phase after it.

| Phase | What | Notes |
|---|---|---|
| **R.0** | ✅ Schema: `kind`, `provenance`, `handoff_page_note`; idempotent, re-runnable backfill | No UI change, and `template_id` deliberately untouched. Verified against Postgres 16 — `npm run verify:reflow`. |
| **R.1** | ✅ Library shows three kinds; promote/demote in `MetaControl` | Guest submissions stop being hidden — they are pages now. Promotion is gated on `canChangeVisibility`, not `canEdit`. |
| **R.2** | ✅ `shareTemplate` + `ShareTemplate` screen (three steps → one), fork/submit provenance, 50-page cap, diff reads the fork copy | Old briefs keep working until R.5 — `createInvitation` is marked legacy, not deleted. Verified with `npm run verify:guest`. |
| **R.3** | ✅ Return link (minted at submit, shown once, emailed), completion screen, owner-side link list + revoke, guest rate limits | ⚠️ A returning author may edit while `draft` **or** `review` — a submitted page is under consideration, not sealed. Stops at `approved`/`archived`. |
| **R.4** | ✅ Provenance panel, threaded notes on both sides, the level collapse, and the owner editing a submitted page in place. | `npm run verify:notes`, `npm run verify:collapse`. |
| **R.5** | ✅ Briefs retired: `template_id` repointed, brief rows archived, and every brief surface deleted — panel, level, wizard actions, queries. `npm run verify:briefs`. | ⚠️ **The columns are NOT dropped.** They are the evidence 0030 reasons from, and it has never run against a real registry. See R.5b. |
| **R.5b** | ✅ Dropped `source_page_id`, `brief_version`, their indexes and the FK; `PageBuild.briefId` gone; `/briefs/*` deleted | Ran once 0030 had applied on the real registry and a guest had built, returned and edited (Brad, 2026-08-13). The one irreversible step in the reflow. |
| **R.6** | ✅ CMS Track A — the content manifest **and** the migration prompt that wraps it. `/api/handoff/patterns/[id]/manifest?format=json\|markdown\|prompt`, plus both on the playground's export menu. | The manifest turned out to be the primitive: §7a's "content manifest for review" and the CMS prompt are one artifact rendered two ways. |
| **R.7** | CMS Track B — integrations tab, first adapter, mapping artifact + dry run | Sequenced by what R.6 taught. |

---

## 7a. Later — worth building, not scheduled

Captured 2026-08-13 so they are not lost in a chat log. None is committed to; each is written with the thing
that makes it non-trivial, because that is the part that gets forgotten first.

### Change digest / content manifest for review

**Both halves shipped in R.6.** The manifest is `buildPageManifest` + `manifestToMarkdown` (`?format=markdown`);
the digest is `changeDigest`, derived from the same `BlockDiff[]` the review list renders and shown above it.
The name-collision warning below still stands.

**The idea Brad liked most of the three.** The review diff answers "what changed" one field at a time. A
**digest** would answer it in a sentence — *"3 headlines, both CTAs, and the hero image; nothing structural"* —
and a **content manifest** would flatten the page into every string and asset it ships with, which is the thing
you actually hand a legal or brand reviewer.

Neither needs new storage: `provenance.blocks` versus current is already the input, and `collectEditableText`
already walks it. The manifest is arguably the more useful half, because it is reviewable **outside** the app —
export it and someone can mark it up in a document.

⚠️ **Name collision to avoid:** `docs/CHANGE-DIGEST-2.0.md` is a *release* digest — what changed in the
codebase between two commits. Unrelated. Pick a different word (page digest? content summary?) before this
ships, or two very different things will share a name in the same repo.

### Template links callable over MCP

Let an agent hold a template link and build from it — the same loop a person does through `/s/<token>`, driven
by tools.

⚠️ **The security question is not "can an agent call it" but "whose link is it".** A share link is a bearer
credential; putting one in an MCP config puts it wherever that config syncs. Worth thinking about before it
exists: links minted *for* an agent, scoped and separately revocable, so revoking the robot does not revoke the
humans — and so a leaked agent config is not an unbounded write endpoint. The 50-page cap and the per-link rate
limits already bound the damage; the attribution does not exist yet (every page would say "a guest made this").

### Limited LLM calls for guests

Guests currently get no AI at all — `aiAssistantEnabled` is false on every guest surface, and `ImageField`
hides generation because the endpoint needs a session.

⚠️ **This is the one with real cost exposure.** Everything else a guest can do writes rows; this spends money,
on an endpoint reachable by anyone holding a link. It needs a budget per link (not per session — sessions are
free to create), a hard ceiling that is not in-memory (`lib/rate-limit.ts` is per-isolate and says so), and a
decision about who pays when a link is shared more widely than intended. Ties to the same "links minted for an
agent" question above: a per-link budget is the same mechanism either way.

---

## 8. Open questions

1. **Can a template be built from more than one link, with different rules?** (e.g. a passphrase-protected
   link for one client, an open one for another.) The table supports it; the UI has to decide whether to
   admit it.
2. **What does a guest see on return — their page, or their page plus the template's later changes?** Their
   page, surely. But do we *tell* them the template moved?
3. ~~**Does an owner edit a guest's page directly, or comment on it?**~~ **Decided: directly** (Brad,
   2026-08-13) — and shipped in R.4. Editability is the ordinary `canEdit`, computed on the record server-side,
   so an owner and an admin get it and a view-only teammate does not. AI assistance stays **off** on someone
   else's submission: fixing a typo is what was asked for; turning a generator loose on work just submitted for
   review is a different act.

   One consequence, made visible rather than absorbed: the review diff compares the fork copy against the page
   *as it stands now*, so once the owner edits, it no longer means "what this person changed". The panel now
   says so (`pageEditedSinceSubmission`). The alternative — a second page-sized copy stored at submit — was
   rejected as doubling every provenance record to answer what a sentence answers.
4. **Where do templates live for a big client — one library lane, or a catalog with its own browsing?** Fine
   at ten, not at two hundred.
5. **Does promoting a page to a template snapshot it?** Under §2.1 the answer is no, and it must stay no,
   or the brief comes back wearing a hat.
6. **Anonymous quotas** — per link, per template, per deployment. Someone has to name the number.
