# Invite to Build — briefs, built pages, and the publication record

**Status:** spec, 2026-08-05. Decisions locked with Brad in conversation; nothing built yet. Supersedes the
"template" product vocabulary in [GUEST-AUTHORING.md](GUEST-AUTHORING.md) (that note's *mechanics* still
apply — write-capable links, guest principal, guardrails, review verdicts).

Roadmap slot: **E.6**, after E.5. Absorbs **E.4** (guardrails move into the wizard).

---

## The model

```
Page  ──1:N──▶  Build brief (v1, v2, v3…)  ──1:N──▶  Invite link  ──1:N──▶  Built page
 │                    │                                    │                    │
 │                    │                                    │                    └─ standalone; approve → publish
 │                    └─ frozen snapshot of the page + brief text + guardrails
 └─ the author's own working document; keeps changing
```

Four nouns, each doing exactly one job:

| Product word | What it is | Storage |
|---|---|---|
| **Page** | someone's working document | `handoff_pattern`, `source: 'playground'` |
| **Build brief** (v1, v2…) | a **frozen, versioned** snapshot of a page plus the instructions to build from it | `handoff_pattern`, `source: 'template'` |
| **Invite link** | one shareable, revocable, passphrase-protected way in. **Many per brief** | `handoff_share_link` |
| **Built page** | what a guest made. **Standalone** — no merge back | `handoff_pattern`, `source: 'guest'`, `template_id` → brief |

**The word "template" never appears in the product again.** It stays as the storage value because churning
the schema for vocabulary is how migrations multiply. Anything a human reads says brief, invite, or built
page.

### Why a middle layer at all

A brief is frozen so that a built page's diff stays stable — a reviewer looking at v2 next month sees what
the author actually started from. Changing your mind means creating **v3**, which is version history by
construction rather than a feature to build. And because links hang off briefs rather than being them, a
brief is **resharable**: new link, new expiry, same inviolable record, without disturbing the built pages
already attached to it.

---

## Schema deltas

`handoff_pattern`:

| Column | Purpose |
|---|---|
| `source_page_id text` | For a brief: the page it was snapshotted from. FK → `handoff_pattern.id`, **ON DELETE SET NULL** (a brief is a record of what outsiders were sent; it must outlive its parent) |
| `brief_version integer` | **Stored, not derived.** Deleting v2 must leave v3 as v3 — a computed ordinal renumbers and silently invalidates every "we sent them v3" conversation |
| `submitted_by_email text` | On a built page: the email its author gave, for state-change notifications |

Already present and unchanged: `template_id` (built page → its brief), `share_link_token` (which link
admitted the author), `status`, `visibility`.

`handoff_share_link`:

| Column | Purpose |
|---|---|
| `passphrase_hash text` · `passphrase_salt text` | `scrypt` from `node:crypto` — zero dependencies. **Not** the SHA-256 used for link secrets: right for a high-entropy token, wrong for four human-memorable words |
| `attempt_count integer` · `locked_until timestamp` | Per-link backoff (see below) |

New table `handoff_publication` — the distribution log:

```
id · pattern_id · destination ('wordpress'|'hubspot'|'sanity'|'export'|…)
external_id · external_url · status ('ok'|'failed') · error
published_by_user_id · created_at
```

### Backfill, and a decision that paid off

Existing briefs (rows already at `source: 'template'`) have no `source_page_id` or `brief_version`. Both are
recoverable: `savePageAsTemplate` writes `{ action: 'save-as-template', fromPageId }` into `edit_history`, so
a one-pass backfill can reconstruct the parent link and order the versions by `created_at`. This is the
payoff for keeping provenance in the audit trail instead of overloading `template_id` — that shortcut would
have inverted the meaning of the column every diff reads.

---

## Lifecycle and visibility: two dropdowns, and one thing that is neither

**Lifecycle** — `draft · in review · approved · archived`. `approved` stays **admin-gated**
(`canApprove`); a non-admin sees it disabled with the reason, never a silent 403.

**Visibility** — `Only me · My team · Anyone with the link (view only)`.

**"Published" is deliberately NOT a lifecycle state.** It is a **publication record**. A page can go to
WordPress *and* HubSpot, be pushed then reverted, or succeed in one and fail in another — none of which fits
in one enum value, and the plugin roadmap guarantees more than one destination. A "Published" chip is
*derived* from "has ≥1 successful publication". This is the seam **Phase D (outbound export)** already
reserved.

**Briefs have no independent visibility.** They inherit their parent page's, and they are not listed in the
library at all — reachability comes from the parent page and from invite links. The column is set to match the
page at creation so nothing reads a contradiction out of it, but it is not a control. If a "view all briefs"
screen ever exists, it filters by the pages you can already see.

**Invitations are not a visibility level.** They are a separate control with its own list, deliberately
styled differently. Our `public` already means "anyone with the link, read-only" — if invitations sit inside
that dropdown, "Public" reads as "this is how I let outsiders build", which is wrong and unsafe.

---

## The invite wizard

Launched by **Invite to build** on the page. **Takes over the page** — not a modal — because it needs room
to explain what is about to happen to someone who has never done it.

1. **What are they building?** Title · short description · **instructions to the builder** · **content
   guardrails** (per-field limits, required fields, alt-text severity). Guardrails belong here because the
   person writing the brief is the person who knows the rules — this is E.4, absorbed.
2. **Who, and for how long?** Days until expiry · max uses · passphrase protection (on by default) ·
   the builder's email, collected **with a visible note that we will email them about their submission**.
3. **Here it is.** The link and a generated **four-word passphrase**, shown once. Copy-both affordance, and
   the standing warning that the secret is not recoverable.

Finishing step 3 **creates the brief** (frozen snapshot at that moment) and its first invite link.

Afterwards a dropdown arrow appears beside the button, listing briefs as **v3 · title · date**, each with its
links and built-page count.

### Passphrase handling

Four words is fine *given rate limiting*. Per-link `attempt_count` with **exponential backoff and a
temporary lock — never a permanent ban**, because a permanent one lets an attacker lock out the legitimate
recipient with ten wrong guesses. Per-link rather than per-IP: serverless has no shared memory (so it needs
a row either way), and IPs are unreliable behind NAT and mobile. The owner can reset the lock.

---

## Surfaces

All three share **one 30/70 shell** with a swappable left panel.

**1. The page** (`/playground/{id}`) — unchanged editing, plus the two dropdowns, **Invite to build**, and
the briefs list.

**2. Brief viewer** — static, uneditable. Right 70%: the frozen preview. Left 30%: **built pages** (author
name + date). No chat, no block list. Empty state matters: most briefs have nothing yet.

**3. Built page viewer** — clicking a built page swaps the preview for *their* version and the left panel for
their notes. Here is where **approve / reject** lives, plus **download as JSON or HTML** (PDF on the
roadmap — it needs headless Chromium, which is a different order of cost). `/review` remains the
cross-brief inbox for "everything waiting"; this is the per-brief view. One gate, two entry points.

**4. Guest builder** (`/s/{token}`) — the real editor, full page, left 30% edit tools, right 70% visual
editor. **Sticky footer**: page title · "Editing as {name}" · **Submit for review**, which opens a
**required** note (client-side enforcement is enough for now). E.5 already reused the editor; this is its
chrome.

---

## Soft delete replaces hard delete

`removePattern` **hard-deletes today** and is reachable from `deletePattern` → `PatternBrowserClient`. It
becomes an **archive**: `status: 'archived'`, excluded from default list queries.

Archiving a page **hides its briefs and built pages** too. They are not destroyed — the review queue can
still reach them, because they record what outsiders were sent and what came back.

---

## Notifications — roadmap, not critical path

A transactional sender already exists in the stack, so the transport is not the question. The work is the
notification **state machine** hung off lifecycle transitions: submission received · submission updated ·
review requested · pushed to production.

Two things that are cheap now and expensive to retrofit, so they are specified here even though the feature
is later:

- **Disclosure at collection** (wizard step 2). Emailing non-users later, having collected the address with
  no such statement, is a consent problem you cannot prove your way out of.
- **Only ever email an address that completed a submission from that session**, rate limited. Otherwise
  anyone with a link can make us send mail to a stranger.

---

## Also deferred

- **PDF export** — headless Chromium; its own item.
- **Abandoned drafts** in the built-pages list ("2 in progress") — a guest who wanders off leaves a `draft`.
- **Revise / annotate / LLM audits** (voice, SEO, accessibility, performance) on a built page.
- **Plugins**: push a built page to HubSpot, WordPress, Sanity — these are `handoff_publication` writers.

---

## Sequencing

Five substantial pieces arrived at once; this is the order that keeps a demo-able loop at every step.

1. **Brief + versioning + resharable links** — the object model, the migration, the backfill. ✅ 2026-08-05
   (migration `0028_invite_to_build`, `savePageAsTemplate` stamps `source_page_id` + `brief_version`; links were
   already resharable since they point at a resource id — only the UI to reshare is missing).
2. **The invite wizard** (with guardrails in step 1).
3. **Brief viewer + built-page viewer**, with approve/reject moved in.
4. **Guest builder chrome** — sticky footer, required note.
5. **Soft delete** — small, independent, can land anywhere after 1.
6. **Notifications** — its own slice, off the critical path.

SS&C get a working loop at the end of 3.

---

## Settled questions, recorded so they are not relitigated

- **Built pages are standalone.** Approval does not merge anything back into the source page. No merge
  engine, no conflict resolution — a built page is just a page with a parent, so publish/export/audit all
  reuse machinery pages already have.
- **The email allowlist is dropped.** Verifying a guest's email means OTP; checking a typed address against a
  list is theatre. Passphrase + max uses + expiry, and the email is recorded for notification, not access.
- **"Snapshot" was rejected as the product word** — it names the mechanism. "Brief" names the purpose, and it
  is literally what wizard step 1 writes.
