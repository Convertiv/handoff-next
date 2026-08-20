# handoff-app — DEVLOG

Reverse-chronological running journal (newest at top). Decisions, state, gotchas, learnings.
Complements `CLAUDE.md`/`ROADMAP.md` (stable) and `docs/` specs. Whoever works this repo appends here.

---

## 2026-08-19 (latest) — nobody was holding the migration lock, because there wasn't one

`outsystems-handoff` still had no tables after the direct-endpoint change. What that change bought was
visibility: migrations now reached DDL and failed on a *specific statement*, eight times —

    auto-migrate: migration failed: Failed query: CREATE TABLE "account" ( … )
    getUserCount failed (42P01) — treating as 0 users.

**The comment in this file was the bug.** `autoMigrate()` claimed *"Drizzle's migrator is idempotent and
uses advisory locks so concurrent startup races are handled."* It does not take a lock of any kind —
`drizzle-orm/pg-core/dialect.js` migrate() creates `drizzle.__drizzle_migrations`, reads the last applied
row, and runs every pending migration in ONE transaction. Nothing serializes two runners. Believing
otherwise is why nothing guarded the race, and the claim had propagated into project memory too.

On a fresh registry that is fatal rather than merely untidy: every cold-starting lambda runs `autoMigrate()`
from `instrumentation.register()`, so under any traffic several instances migrate the same empty database at
once. Migration 0000 is drizzle-*generated*, so its `CREATE TABLE "account"` has no `IF NOT EXISTS` (the
hand-written 0014+ ones do). Losers roll back their entire transaction, and nothing ever commits. Compounding
it, Vercel freezes an instance once its response is sent, so a run that outlives its first request gets
suspended mid-transaction — which is where a `CONNECT_TIMEOUT` *after* successful queries comes from, on
either endpoint.

**Fix: take the lock ourselves.** `pg_advisory_lock(4242042001)` around `migrate()`. Session-scoped on
purpose — it releases on `client.end()` and also when a frozen instance's connection dies, so a holder that
never returns cannot wedge the registry permanently. `max: 1` is what makes it correct: the lock and the
migration transaction ride the same session. The wait is bounded by the existing `lock_timeout = '30s'`; a
loser waits for the winner, then runs migrate() itself and commits an empty transaction. Past that it logs
and returns rather than piling up.

**Method note, since this took three passes.** Both wrong turns came from trusting a stated mechanism instead
of reading it: first the standing note that a DB-required build error was "environmental", then this file's
claim about advisory locks. The log tally was what actually moved things — counting `connecting` vs
`session timeouts set` vs `schema is up to date` localized the failure each time, and the count of
`schema is up to date` was **zero** through all of it.

---

## 2026-08-19 — …and then it has to reach the database it was given

Sequel to the entry below. With Neon attached and `DATABASE_URL` set, `outsystems-handoff` still had no
tables. The migration was not being skipped — it ran eight times and failed to connect every time:

    instrumentation.register() — runtime=nodejs, hasDB=true
    auto-migrate: using /var/task/src/app/lib/db/migrations
    auto-migrate: connecting (pooler=true)…
    auto-migrate: session timeouts set, starting migrate()…
    auto-migrate: migration failed: write CONNECT_TIMEOUT ep-…-pooler.c-11.us-east-1.aws.neon.tech:5432

8 × connecting, 6 × "session timeouts set", **0 × "schema is up to date"**, then 42P01 on `user`,
`handoff_component`, `handoff_registry_navigation`.

**Read the failure point, not just the error.** It gets past `SET lock_timeout` / `SET statement_timeout`,
so DNS, TCP, TLS, auth and query execution against Neon all work — and postgres-js cancels its connect
timer at the first ReadyForQuery, so a `CONNECT_TIMEOUT` *after* those SETs cannot be the first connection.
It means the session was dropped and a REPLACEMENT connection never came up inside `connect_timeout`.
"CONNECT_TIMEOUT" reads like "can't reach the database"; it wasn't (the pooler host resolves and accepts on
5432 from outside). It was a session dying mid-migration.

**Migrations now go over the DIRECT endpoint, never the pooler** — `DATABASE_URL_UNPOOLED`, then
`POSTGRES_URL_NON_POOLING`, then `DATABASE_URL`. The pooled host is PgBouncer in transaction mode: it does
not hold session-level `SET`s and is the wrong place to push a ~24-file DDL transaction. Neon says as much
in its own docs, and the Neon/Vercel integration provisions both names, so there is nothing to add to the
env. `connect_timeout` 15s → 30s for a just-provisioned compute. The log line now reports
`endpoint=direct|pooled` and warns on the pooler fallback, so the next boot says which path it took.

Could not fully separate "pooler dropped the session" from "cold compute exceeded 15s" — that needs the
connection string, and Vercel returns it as `[SENSITIVE]`. Routing off the pooler covers both, so the
distinction stayed academic. The runtime read path is unchanged and still pooled, which is correct: that
one wants PgBouncer.

**⚠️ The conclusion in this entry was WRONG — see the entry above it.** The pooler was not the cause:
after moving to the direct endpoint the same `CONNECT_TIMEOUT` appeared on the direct host
(`ep-…-avtlabf5.c-11…`, no `-pooler`). Migrating over the unpooled endpoint is still right per Neon's
docs and it stays, but it fixed nothing here. It did get far enough to expose the real failure.

**Also spotted while reading the logs, unrelated:** `/api/registry/logo.svg` 500s with
`TypeError: Invalid URL, input: '/logo.svg', base: 'outsystems-handoff.vercel.app'` —
`app/api/registry/logo.svg/route.ts` feeds `HANDOFF_APP_URL` straight into `new URL()` and this project's
value has no scheme. Env fix for now; the route should probably normalize. And something polls
`/api/handoff/ai/design-jobs/run` every 60s, 503ing against the empty schema.

---

## 2026-08-19 — a registry has to build before it has a database

`outsystem-handoff.vercel.app`, first deploy: `next build` died prerendering `/guidelines` with
*"DATABASE_URL is required for this operation."* Chicken-and-egg — you can't attach a Neon database to a
Vercel project that has never deployed, so the very first build of any new registry has no DB env at all.

The gate already existed in `lib/server/registry-cache.ts` and leaked. `getCachedPageBySlug()` branched on
`isPostgres()`, but only to decide whether to wrap the read in the Data Cache — the no-DB branch still called
`getHandoffPageBySlug(slug)`, and that does an unconditional `getDb()`. So "workspace mode" walked straight
into `requireDatabaseUrl()` and threw. It now returns `null`, which the doc catch-alls already treat as
"no DB-backed override for this slug" and fall through to the filesystem markdown.

**Everything else on the boot path was already gated properly** — `getMergedRuntimeConfig`, the root layout's
user-count and site-password checks, `auth()` (lazy adapter, `null` DB without Postgres), `autoMigrate()`
(logs `skipping (workspace mode)`), and the data-provider factory falling to `StaticDataProvider`. One leak,
not a class of them.

**Verified the way this failure demanded:** moved `src/app/.env.local` aside so Next couldn't refill the var,
unset `DATABASE_URL`, ran the real `npm run build:registry` → *Compiled successfully, 141/141 static pages,
exit 0*. Note that @next/env **will** re-populate a var you export as empty (it overwrites anything matching
its original snapshot), so `DATABASE_URL= npm run build` does not reproduce this — the env file has to go.

**Correcting a note that was protecting the bug.** The standing "verify locally before pushing" guidance said
this exact failure — prerendering `/guidelines`, DATABASE_URL required — was *environmental, not a code error,
Vercel has the env*. It was a code error, and reading it as environmental is what let it reach a first deploy.
A DB-less `build:registry` is a legitimate pass and should stay green.

**Deploy branch, for the record:** every registry site deploys from **`main`** (Brad, 2026-08-19). Corrected in
`docs/DESIGN_SYSTEM_ROADMAP.md` and `docs/SSC-MIGRATION-STATUS.md`. Separately, workspaces still pin
handoff-app as a git dep at `handoff-next#feature/mcp-prototype` — a different fact, left alone here, but
worth confirming since it's plausibly stale too.

---

## 2026-08-13 — everything about a page belongs on the page

Brad, on the checks fix: *"if there are checks or provenance those things should be visible on the page itself,
even if you get to it from the library, not from the template."* Stated as a rule, so the right response was to
sweep the class rather than patch the instance.

Audited what `BuildPanel` shows that a library-opened page did not:

| Surface | Before | Now |
|---|---|---|
| Provenance | chip on the page | ✅ already fixed earlier today |
| Checks | template route only | ✅ fixed in the entry below |
| **Notes** | **`BuildPanel` + guest view only** | ✅ `Notes` control + left-rail panel at page level |
| Change digest | review endpoint, reviewer panel | left as is — see below |
| Pages-from-this-template | template only | correct: it *is* template-specific |

`PageNotes` was mounted in exactly two places, and neither was the page. Someone opening their own page from
the library could not read a note left on it, let alone answer — while the person who left it was looking at
the same thread from the other side.

**The digest stays put, deliberately.** It is a diff against what the guest was handed, so it answers "what did
they change?" — a reviewer's question about someone else's submission, not something a page says about itself.
`PageOrigin` already carries the provenance that matters on the page. Worth revisiting if it turns out people
want it on their own pages too; noting the reasoning so the next person does not read the absence as an
oversight.

**The rule, for whoever adds the next thing:** the template → Pages → open path was built first and quietly
became the home for anything page-related, which is how three working features ended up invisible from the
route everyone actually takes. Anything mounted there wants one question asked of it — *what does this look
like from the library?*

---

## 2026-08-13 — name it up front, and the checks come back

Two follow-ups from Brad testing the previous fix, both the same shape: **the feature existed and the surface
did not.**

**1. The title was invisible exactly where you make things.** `PageTitle` gated on `editingPatternId`, which is
null until save-on-first-block mints the record — so the blank canvas, the one screen where a person is
obviously making a new thing, was the one screen with no name on it. It now renders before the record exists:
the context holds the name locally and `setPageTitle` defers the write, so typing on an empty canvas works and
creation uses whatever the toolbar holds.

Brad also asked for a naming *flow*, not just an editable label, and chose "at creation, for both."
`NameNewRecordDialog` sits behind New → Page and New → Template: one field, `Skip` and `Create`. The name
travels as a query parameter rather than creating anything, because nothing exists yet — save-on-first-block
still owns creation and this only changes what it writes for `title`. Capped at 200 chars on the way in, since
it arrives from a URL and lands in a row.

**2. The validation panel was only reachable through the template.** `auditBuild` and `checkPatternGuardrails`
ran inside the `?build=` branch alone — the path you take when opening a submitted page *from the template it
came from*. Open the same page from the library, which is what everyone does, and both arrays were empty and
`BuildPanel` never rendered. The checks were running the whole time; nothing said so.

They now run on the page's own record when no submission is selected, and `PageChecks` gives them a home at
page level — a `Checks` control in the toolbar, a panel in the left rail, the same `FindingsList` the reviewer
sees. Deliberately **not** `BuildPanel`: that panel is a reviewer's surface carrying who submitted, when, their
message, and approve/reject, none of which exists for a page you made yourself. What both want is the findings
list, so that is what is shared.

**The control shows at zero findings.** Hiding it when nothing is wrong is precisely what made the checks look
deleted — "we checked and found nothing" is the answer to "did this run at all?"

`CATEGORY_LABEL` moved from inside `BuildPanel` to `AUDIT_CATEGORY_LABEL` in `build-audits.ts`, beside the
categories it names. Two panels render findings now, and a label map copied into each is a label map that
drifts.

**Worth noticing: this is the third time in two days.** The provenance chip, then the title, now the checks —
each a working feature reachable only through a route almost nobody takes. The common cause is that the
template → Pages → open path was built first and became the implicit home for anything page-related. Anything
added there should be asked: *what does this look like from the library?*

Still unverified in a browser, same reason as the entry below.

---

## 2026-08-13 — nothing could be named

Brad, testing before handing the app to Natko: *"you can't currently create new pages — there's no way to name
it or save it."* He was right, and the second half turned out to be the tell for the first.

**Saving was fine.** Save-on-first-block mints the record and autosave persists the canvas, exactly as E.2
intended. What was gone was the **title**, and with no name and no save button the canvas gave no evidence it
had saved anything — so "I can't name it" and "it doesn't save" are the same complaint.

**How it went missing.** Two correct decisions, taken months apart, that nobody held up against each other:

1. E.2 removed the save dialog, because a page that saves itself does not need one.
2. R.2 replaced `InviteWizard` with `ShareTemplate` — and `WizardDialog`, the old wizard's shell, was the last
   thing mounting `SavePatternDialog`.

`SavePatternDialog` held the only title field in the app. After R.2 nothing rendered it, so nothing rendered a
title field. `updatePattern` still accepted one; there was simply no caller. The live callers were autosave
(which **deliberately** never sends the title — it writes an empty string for every field it does not own, and
would wipe the name on every keystroke) and `MetaControl` (visibility, lifecycle, kind). So every record created
after R.2 was born `Untitled page` and stayed that way permanently.

Worth naming the shape: **the regression was an orphaned component, not a broken one.** `SavePatternDialog`
still compiles, still passes typecheck, is still imported by `WizardDialog` — which is imported by nothing. A
dead mount point is invisible to every gate we run.

**The fix.** `PageTitle` in the canvas toolbar: click-to-edit, commits on Enter or blur, Escape reverts.
`pageTitle` is now state in `PlaygroundContext` with a `setPageTitle` that writes through `updatePattern`,
optimistic and reverted on refusal — refusal being real, since `patchPattern` counts `title` as a content field
and a legacy frozen template (`source === 'template'`) rejects a rename the way it rejects an edit. The record
minted by save-on-first-block now names itself in state on the spot, so the toolbar is right before the server
re-render.

**No rename on the library card**, deliberately. `AssetCard` carries a rule Brad has enforced three times — *a
card is a link, it takes no actions; if something seems to need a card affordance, it needs a home on the object
instead*. The title now has that home, which is what the rule asks for.

Decision logic went to `lib/page-title.ts` (`decideRename`, `isPlaceholderTitle`) rather than living inside the
component — same pure-decision/IO split as `decidePatternMetaChange`. 8 tests. Suite 1178 → 1186.

**Not verified in a browser.** An authenticated pass needs Brad's credentials, and the configured
`DATABASE_URL` is the hosted SSC registry, so clicking through would leave test records in the environment
Natko picks up tomorrow. Lint (0 errors), `next build` and 1186+9 tests are what stands behind this. First
thing to confirm by hand: create a page, name it, reload.

---

## 2026-08-13 — what the HubSpot connector can actually do

Checked against the real SS&C clone rather than assumed — portal `50110677`, **353 website pages**, names like
"BPO and Lift-Outs", so it is genuinely their content.

| Surface | Through the HubSpot MCP |
|---|---|
| Landing pages | full module-level read **and** write |
| Blog posts | read + write |
| **Website pages** | **name and dates only** — `SITE_PAGE.write` is `NOT_AVAILABLE`, and `manage_landing_page` refuses a site-page id outright |

The decisive test was pointing `manage_landing_page action=MODULES` at a real site page: *"couldn't find an
editable landing page draft"*. So the connector cannot write website pages **and cannot read their structure
either** — it cannot even inform the mapping. Track B goes to the CMS Pages REST API, which is where Brad had
already landed independently.

**What the connector settled for free:** the page model the R.6 prompt assumed is correct. `manage_landing_page`
speaks in module types, module definitions and verbatim field patches, and enforces read-before-write and one
write at a time — the same discipline the prompt asks an agent for, arrived at independently. The mapping
concept holds; only the transport changes.

Also worth recording: **the first attempt to write this entry died mid-edit.** The sandbox lost access to
`~/Documents` — `ls` and `git` both returned `Operation not permitted` — and the doc update and its commit
never landed. The working tree was clean afterwards, so nothing was half-written; the finding lived only in the
conversation until access came back. A reminder that a conclusion is not durable until it is committed.

---

## 2026-08-13 — R.5b: the brief columns are gone

The one irreversible step in the reflow, taken once its precondition was actually met: 0030 applied on the real
registry, and a guest built a page, returned to it through their link and edited it. Everything before this
could be undone with an UPDATE; a dropped column cannot.

What went: `source_page_id`, `brief_version`, the partial-unique index that enforced one version per parent, the
lookup index behind the deleted `listBriefsForPage`, the self-referencing FK, and `/briefs/[id]` — a redirect
that could only work by reading the column it now lacks.

What that cost is brief-era bookkeeping alone: which page a brief was cut from, and which version it was. The
pages built through those briefs keep their own record — `provenance` holds the copy they were handed and the
template they came from, which is the thing a reviewer actually reads.

Two readers had to move with the columns:

- **`notifyBuildSubmitted` is one hop now.** The legacy second hop walked brief → parent page via
  `source_page_id`. Anything still pointing at a brief is an orphan whose parent no longer exists, so there was
  never an owner to reach; it returns instead of pretending.
- **`removePattern` no longer cascades.** Archiving a page used to archive the briefs cut from it *and* the
  pages built through them. Nothing creates briefs, and a page made from a template is its own document with
  its own life — archiving a template no longer reaches into what other people made from it. That is the reflow
  stated as behaviour rather than as a doc.

Three of my own verifier fixtures still described the old world — inserting dropped columns, and asserting on a
`briefId` field that no longer exists (`undefined === null` is false, which is how it announced itself). Updated
to describe a deployment that has run 0030 and 0031, which is the only shape that exists now.

All five verifiers green against the full chain.

---

## 2026-08-13 — the return link greeted its own author with an error

Three things off a real test on the deployed registry.

**1. The return link tried to *create*.** Opening it landed on the name/email form and then failed with
*"This link does not allow creating a page from this template."* Two halves, both mine:

- The **client** called `ensureSubmission()` unconditionally on entry, which POSTs "create a page from this
  template" — a request a return link has no capability to make. It now checks the `mode` the enter route
  already returns and reads the page instead.
- The **server's** resume check demanded `status === 'draft' && shareLinkToken === guest.shareLinkId`. A
  returning author fails *both*: their page is `review`, and it carries the **template** link's token rather
  than the one they hold. So it fell through to create. It now resumes whenever the session owns the page and
  the guest holds a link pointing at it, while a template-link holder still falls through once their draft is
  submitted — which is the case that rule was written for.

This is exactly the gap the R.3 follow-up left open: the predicates and the DB layer were verified, the client
flow was not, and I said so at the time. Verifying the pieces is not verifying the path.

**2. Provenance was invisible on the page.** The R.4 panel lives in the review surface, which is only reachable
by opening a page *through its template*. Opened from the library — the ordinary way — a guest's page looked
like any other. `PageOrigin` is a chip on the page's own toolbar that renders nothing when there is no
provenance, which is most pages.

It reads the **pattern detail** endpoint, not the review one. Review would answer the question and computes a
diff, the guardrails and the audits to do it — an expensive way to render a chip, on every page open, days
after removing an N+1 from the neighbouring surface. `patternRowToDetailResponse` now carries a flattened
provenance (never the fork blocks, which are page-sized).

**3. The passphrase is opt-in now.** It is real protection for a link mailed to one named person and friction
everywhere else, and the common case is a link dropped into a channel where everyone is meant to build. The
link is already a high-entropy secret. Both defaults moved — the control *and* the action — because a checkbox
that says "off" while the server mints one anyway is a disagreement nobody finds until it confuses somebody.

---

## 2026-08-13 — why the library was slow: an N+1 I shipped

**The library.** Every card asks for `/api/handoff/patterns/<id>/thumbnail.svg`, and that route was fetching
each distinct **component contract** on the page to decide what to draw — one `getComponent` query apiece, on
top of a session read, a pattern read and a grant read. Fifty cards averaging six distinct blocks is roughly
**450 queries and 50 session reads, fired in parallel from the browser at a pool of ten connections**, every
time the tab opened. Mine, from the QA pass that added page thumbnails.

The fix removes the fan-out rather than caching around it: the silhouette is now read from **the page's own
stored blocks** (`argsSlots` over `collectEditableText`/`collectImageSrcs` — the same collectors the audits and
the manifest use). Zero component lookups; the pattern row already carried everything. It is also a truer
picture, since it reflects what is filled in rather than what the contract permits, and it picks up the override
layer so the card matches what the canvas renders.

**The system component list is a different problem, and not mine.** `/api/components` calls
`provider.getComponents()`, which runs `getDbComponents()` — `db.select().from(handoffComponents)`, *every
column including the jsonb*. The codebase already documents the cost, one function below it: *"the full-row
`getDbComponents()` transferred every component's `data` blob (~97% of which is `sharedStyles`) on every page
load."* A light projection exists (`getDbComponentSummaries`) and backs the menu; the system index does not use
it, because it renders `previews` and `image`, which the summary omits.

The fix is a **third projection** — metadata plus `previews.default.url` — rather than either extreme. Left
undone deliberately: `/api/components` is a shared public route with consumers beyond this page, and narrowing
its response at the end of a long session is how a list somewhere else quietly loses a field. It wants its own
pass with the consumers enumerated.

---

## 2026-08-13 — preview feedback: language, a real New→Template, and two paging bugs

**The preview's missing CSS/JS is Vercel, not us.** The canvas iframe is an opaque-origin sandbox
(`sandbox="allow-scripts"`, no `allow-same-origin`), so every `/api/component/*.css|js` request inside it is
cross-origin and **carries no cookies**. Behind Vercel Deployment Protection those requests get the SSO
challenge instead of the asset, while the top-level page loads fine because the browser has the cookie for it.
The same wall is why the guest flow could not be tested — a visitor at `/s/<token>` has no Vercel session
either. One setting unblocks both.

**"Build" is gone from the interface.** There are pages and templates. The toolbar control says *Pages*, the
panel header says *Pages from this template*, and the back link says *Back to template*. `BuildList`/`BuildPanel`
keep their filenames — renaming files is churn, and the words on screen are what matter.

**New → Template creates one from scratch.** `writePattern` takes a `kind`, so the record is *born* a template
rather than being made one by a second call that could fail and leave a template that is not one. Sharing a page
still promotes it; that stays the common path. Only two kinds are writable through create — `brief` is not a
thing anyone can mint.

Two paging bugs, and the second one is mine:

1. **The assets page never paginated at all.** The endpoint has always taken `limit`/`offset` and the client
   sent neither, so it showed the server's default hundred with no way to reach asset 101. Now a 60-row page
   with Load more, de-duplicated by id — offset paging plus an upload between two fetches would otherwise show
   the same asset twice.
2. **The library's kind facet filtered client-side**, over whatever had been paged in. Introduced in R.1:
   picking "Templates" showed nothing whenever the first page happened to be all pages, and Load more was the
   only way to find out, one blind click at a time. It filters in SQL now, so the pager pages the filtered set.
   Both callbacks were also missing `typeFacet` from their dependencies, so changing the facet would not have
   refetched even with the query fixed.

Verified against a real database, including the case that proves the bug was real: a template that sits outside
the first unfiltered page is returned by the filtered query and would never have appeared client-side.

---

## 2026-08-13 — the change digest: what changed, in a sentence

`changeDigest` turns the review diff into *"3 titles and 2 bodies changed, across every block."* — shown above
the field list rather than instead of it. The field list answers "what about this field"; a reviewer opening a
page is first asking "is there anything here worth my time", and those are different questions.

**Derived from the same `BlockDiff[]` the list renders.** A digest computed from its own second pass over the
content would eventually say "3 titles" above a list showing four, and the sentence is the part people quote.
Same rule the manifest follows, for the same reason.

Two things surfaced by printing real sentences instead of trusting the code:

1. **"2 bodys".** The first pluraliser appended an "s". The very first sentence it generated was wrong in a way
   that makes a reader discount everything after it. It now knows consonant-y → -ies and sibilant → -es, which
   covers the labels that actually occur (Body, Category, Address, Box).
2. **Two of my own test expectations were wrong, not the code.** One assumed insertion order where the digest
   deliberately breaks ties alphabetically — a summary that changes when nothing changed is one people stop
   trusting — and one put "and" before the third group when it belongs before the tail. Both corrected to
   assert the behaviour that was designed, with the reasoning recorded.

Counts are grouped by label because that is how a person describes a page: "Title" changed in three blocks is
*three titles*, not three unrelated edits. Removals get their own clause, since deleting reads differently from
editing.

---

## 2026-08-13 — R.6: the content manifest, and the prompt that wraps it

**The manifest turned out to be the primitive.** §7a listed "content manifest for review" and "CMS migration
prompt" as two ideas; they are one artifact rendered two ways. `buildPageManifest` flattens a page to every
string and image it ships, in reading order; `manifestToMarkdown` is what you hand a brand or legal reviewer who
should not have to click through a canvas; `cmsMigrationPrompt` wraps the same thing in instructions for an
agent holding the target CMS's MCP. One definition of "the content of this page", three renderings.

It reuses `collectEditableText` and `collectImageSrcs` rather than walking the args itself, for the reason that
keeps recurring in this reflow: a second definition of the page's content would drift from the one the audits
and the voice check run against, and nobody would notice until the two disagreed in front of a client.

**The prompt is mostly prohibitions, and that is the design.** The failure mode of an agent with write access to
a CMS is not refusal — it is inventing a field, guessing a module, or dropping the third paragraph and reporting
success. So: create nothing that was not asked for, quote every value verbatim, list what you could not place,
propose the mapping *before* creating anything, and confirm before anything destructive. That last list is the
most valuable output of a run: it is exactly what Track B's adapter would have to handle, learned rather than
imagined.

**Prompt first, adapter second** remains the sequencing argument. An adapter has to know the mapping and nobody
knows it yet; writing it from imagination produces an integration that is confidently wrong in ways nobody
notices until content is live.

Two things caught by generating a real one and reading it rather than trusting the code:

1. I had given `ManifestImage` an `alt` field. `collectImageSrcs` does not report one — alt text is a *string*,
   so it arrives as a field — which meant every image on every page would have printed "no alt text", a
   confident claim the collector never made.
2. "1 images · 289 chars". This document gets handed to people, and that is the kind of small wrongness that
   makes a reader trust the rest of it less.

One lint error worth recording: the export handler's `useCallback` landed *after* an early return, making the
hook conditional. `next build` passed; `npm run lint` is what caught it.

---

## 2026-08-13 — R.5: briefs are gone

Two commits. The data half repoints `template_id` from the brief a page came through to the template it came
from, gives provenance to anything the legacy wizard made after 0029, and archives every brief row. The code
half deletes the surfaces: `BriefPanel`, the brief level, the briefs API route, `createInvitation`,
`savePatternAsTemplate`, `savePageAsTemplate`, `updateBriefInstructions`, `listBriefsForPage`, the invitations
dropdown, and the `?brief=` resolution in the route.

**The columns are deliberately still there.** `source_page_id` and `brief_version` are what 0030 reasons from,
and it has never run against a real registry — nothing is deployed past 0028. Dropping them in the same pass
would trade a reversible state for an irreversible one to save a migration nobody is waiting on. R.5b, after
this runs somewhere real.

**The find that justified the whole slice.** `notifyBuildSubmitted` walked build → brief → page. A page built
the *new* way already had a template in `template_id`, and a template has no `sourcePageId`, so the second hop
returned nothing and the function bailed. **Owner submission emails have been silently dead for every
new-model page since R.2** — nothing threw, an email just never arrived. It now reads provenance first, falls
back to the column, and only takes a second hop when what it landed on is a brief.

Three of my own guard-rails fired during the deletion, which is the part worth recording:

1. A section-cut in `pattern-write.ts` bounded by `/* ---- */` dividers swallowed `setTemplateBuilderNotes`
   along with `savePageAsTemplate`. The build caught it; I restored the file and re-cut with explicit
   assertions about what may and may not disappear.
2. The re-cut's `rindex("/**")` then walked back into the *previous* function's docblock — the assertion caught
   that one before it hit disk.
3. Two verifiers and one unit test encoded the pre-R.5 API (`levelFor`'s arity, `briefBelongsToPage`,
   `listBriefsForPage`). Updated with why, rather than deleted.

All five DB verifiers re-run green after the deletions, which is the point of having them: the write core they
drive is the thing this pass cut into.

---

## 2026-08-13 — R.4 finished: the level collapse, and the owner editing in place

**The collapse.** A submitted page opens straight from the template it came from: `?build=` alone is a level,
gated by the page's own provenance (`submissionBelongsToTemplate`) rather than a chain through a frozen brief.
The brief hop survives only for legacy rows, and `briefId` on a listed page is now null for everything built the
new way — that null is what decides whether opening it needs the old URL shape.

`listBuildsForPage` became a UNION over both descent paths, and running it is what showed why it had to be. A
page backfilled by 0029 has provenance **and** a brief chain, so the obvious version lists it twice; and the
legacy half filters on the brief's own status, which under a LEFT JOIN silently becomes "drop every new-model
page" — a null brief is not "not archived".

**Owner edits in place**, the last piece of "a build is a page". No new write path: dropping the read-only
adapter and passing `initialPatternId` puts the record on the ordinary authenticated autosave, whose core
already enforces `assertCanMutatePattern`. The shell only decides what to *offer*, and it decides from the same
`computePermissions` the write enforces with — because a control that offers what the server will refuse is the
failure this project has hit twice. AI stays off on someone else's submission; that is a different act from
fixing a typo, and off is the reversible default.

**The cost of that, made visible.** The review diff compares the fork copy against the page as it stands now,
and is read as "what did this person change". The moment the owner edits in place that sentence stops being
true. The honest fix was a sentence, not a schema: `pageEditedSinceSubmission` compares `submittedAt` to
`updatedAt` — with a second of slack, because submitting *is* a write and without it every submission would
announce it had been edited afterwards. Storing a second page-sized copy at submit would have separated the two
properly and doubled every provenance record to do it.

One test asserted the rule the collapse reverses — a build named without a brief used to fall back to the page
level. Rewritten rather than deleted, recording why it flipped and what still stops `?build=` rendering an
arbitrary record inside someone's shell.

`verify:collapse` — 25 checks over both data shapes: the double-listing, the archived filter, the shell's
membership rule, and the write path (the owner's edit lands, a stranger's is refused, and neither is offered
what the core would refuse).

---

## 2026-08-13 — R.4 in layers: notes, and where a page came from

Rebuilt from the stash in three layers, each one green before the next started. The first attempt had tangled
the notes work together with an authz fix; that fix shipped on its own, and this is what was left.

**Layer 1 — rules and IO, split.** `authz/notes.ts` decides and is pure; `db/note-queries.ts` fetches the row,
asks it, and obeys. The same split `decidePatternMetaChange` and `pattern-write` already use, and the reason is
now concrete rather than stylistic: R.3 shipped a broken return link precisely because a rule had a second copy
living next to the query that needed it.

Four decisions worth naming:
- **Read and write are the same answer.** A thread you can read but not answer is a notice board.
- **Commenting needs `canEdit`.** Writing to a page's record is a bigger claim than `canView` makes.
- **The author's access follows `canGuestEditPattern`** rather than restating it, so a return-link holder can
  join the thread on their submitted page — and a decided page closes it to them.
- **The owner sees the address a guest gave; a guest never sees another's.** A privacy rule, so it is a pure
  function with its own test rather than a line in a query.

**Layer 2 — one route for two callers.** `?link=` picks the guest path, a session picks the other. A separate
guest endpoint would be two places deciding who may say what, which is the shape of the bug this whole slice
just cleaned up.

**Layer 3 — both sides of the conversation.** The panel gained a *Where this came from* block — template,
when they started, when they submitted, whether the template has moved since, and whether the diff is against
what they were handed or against the template as it stands. That block is the visible half of the fork copy
that replaced briefs, and the reason keeping it is worth the storage. Notes render underneath it, and on the
author's own screen after they submit — which is the half that makes the feature worth having: "can you shorten
the headline?" used to have nowhere to go but email.

Two self-inflicted things caught by running rather than reading: a verification assertion that read the
author's view of the thread and asserted the owner's answer against it, and a reference to a `submissionId`
that the guest component never held.

`npm run verify:notes` — 17 checks against real Postgres for what only a database answers: the one-author
CHECK, the cascade, and the two cross-page guards (a reply reaching another page's thread; a foreign note id
resolved through a page the caller *does* have rights on). 12 unit tests alongside.

**Still open in R.4**: collapsing the workbench's `level`, so a page with provenance is reviewable from the page
itself rather than through the build route. That is routing surgery and deserves its own pass.

---

## 2026-08-13 — R.3 follow-up: the return link did not actually work

Found while starting R.4, and fixed first because it is a defect in shipped work rather than new scope. R.3
minted a return link, emailed it, and displayed it — and a visitor who opened it could not reach their page.
Two independent reasons, both the same shape: **a rule with two copies, only one of which learned about R.3.**

1. **The session was never bound to the page.** `/enter` set `submissionId` from a *resumed* session only, so a
   return-link visitor arrived with none — the editor had no page to load and would try to **create** one, which
   a return link has no capability to do. It now binds the session to the page when the link points at a `page`
   rather than a `template`, and reports `mode: 'return' | 'build'` so the UI need not infer it from
   capabilities.
2. **The read route re-derived ownership inline** as `row.shareLinkToken === ctx.guest.shareLinkId`. A returning
   author's page was created through the *template* link, so the token on the row is not the token they hold:
   the check refused the person the link was issued to. `isGuestOwnPage` is now exported and both places call it.

A third copy of the same class of thing: the guest UI decided editability with `status === 'draft'`, which would
have shown a returning author a read-only screen — their page is in `review`, and that is precisely the state a
return link is meant to open. The route now answers `canEdit` from `canGuestEditPattern`, and the client trusts
it.

**Caught myself mid-edit**: I briefly gave `canGuestSubmitPattern` the same review-status relaxation as editing.
Wrong — editing a submitted page is what a return link is *for*, but re-submitting would fire the owner's
notification again and rewrite the submit half of the provenance record. The moment they let go of it is a fact.
Restored to `draft` only, with the reason written down.

Seven new predicate tests, and `verify:guest` now asserts the mismatch directly: the page carries the template
link's token while the return link points at the page, so the checks that would have failed before are the ones
in the file.

**R.4 was stashed rather than discarded** (`stash@{0}`) — notes + provenance panel, restarting on top of this.

---

## 2026-08-13 — R.3: the way back

Submitting now mints a **return link** — scoped to that one page, `view` + `edit_own_submission` and nothing
else — shown on the completion screen and emailed. Owners get a list of live links with revoke, on the share
screen where the question "who can still get in" actually arises.

**Two kinds of link now claim different things, and the authz had only one way to recognise a guest.** A
template link's claim is the token stamped on what it created; a return link's claim is the *page it points
at*, because that page was created through a different token. `GuestPrincipal` gained `resourceId` — read from
the live link row every request, so revocation ends a claim immediately — and `isOwnSubmission` accepts either.

**A returning author may edit at `review`.** The old rule locked editing at submission so a guest could not
change what a reviewer was looking at. That rule is right for someone mid-build and wrong for someone we
*handed a link to precisely so they could come back*. Both stop at `approved`/`archived`: a decision has been
made, and editing under it rewrites what was decided.

**The return link deliberately does not expire**, which turned out to be impossible to express. `createShareLink`
reads `expiresAt: null` as "not supplied" and applies the default write-link TTL — correct for every other
caller, and `/api/handoff/share` relies on it, so the fix is an explicit `neverExpires` rather than changing what
null means. Caught by the verifier asserting the link had no expiry; without that check an author's only way
back would have quietly died after 14 days.

**Rate limits ship with it, not after it.** `lib/rate-limit.ts` — a shared sliding window, applied to enter,
create and submit. Its docblock is blunt about being per-isolate: it slows a burst, it does not bound the
damage. The durable ceiling is the 50-page cap, counted in the database. Submit's limit is the tightest because
each success sends mail to an attacker-supplied address.

**Bearer-credential handling, stated once**: only the hash is stored; a re-submission revokes the previous
return link so a page has at most one live key; the email says plainly that the link is a key, because someone
who does not know that cannot be careful with it and forwarding a thread is how these leak; and the screen shows
the link too, since the address was typed into a form and verified by nobody.

Not verified in a browser (auth), and **no email was actually sent** — `RESEND_API_KEY` is absent here, so
`sendTemplatedEmail` logs and skips. What is verified against Postgres: the link is minted, scoped,
non-expiring, resolvable, opens exactly one page, and stops resolving when revoked.

---

## 2026-08-13 — R.2 done: three steps became one

`ShareTemplate` replaces `InviteWizard`, which is deleted rather than deprecated — there is nothing left for it
to create.

**The old wizard's first two steps existed to describe an object that no longer exists.** A brief needed a name,
a description and a version because it was a thing with a life of its own. Sharing now points a link at a
template that already exists, so the screen asks what the *link* needs — how long, passphrase or not — and says
plainly what happens: anyone with it makes their own page, yours stays yours and stays live.

**Instructions and content limits stayed, but moved to the template.** They were arguments to "create an
invitation", which made them feel like properties of a link and meant changing your mind required cutting a new
brief. `setTemplateBuilderNotes` writes them to the template under the **same storage keys**
(`data.brief.instructions`, `data.guardrails`) — deliberately unchanged, because the guest editor, the submit
gate and the review route all already read them from whatever `template_id` points at, and that is now the
template. Renaming would have been churn that broke every reader at once.

**"Max uses" is gone from the UI.** It counted sessions, so a reload could look like it burned an invitation.
The cap is 50 pages, fixed, and stated rather than configured.

⚠️ **`isTemplate` in the playground context is not the reflow's kind.** It means "a frozen legacy brief,
read-only, clone to edit". Threading it into the share screen would have told every real template it was a plain
page and quietly skipped the promotion. The screen asks the API for `kind` instead, and treats unknown as
"promote" — the action is idempotent, and a share that silently does not work is the worse failure.

The toolbar says **Share**, not "Invite to build": there is no invitation and no named invitee.

Verified by extending `npm run verify:guest` — instructions and limits land where each reader looks, an emptied
instruction is removed rather than blanked, clearing one leaves the other alone, and a plain page refuses
builder notes (it must not become a back door into an arbitrary row's `data`).

Not verified in a browser: the screen is behind auth. What it *does* is covered; what it looks like is not.

---

## 2026-08-13 — R.2 data path: the fork copy, the cap, and a template that moves underneath you

The guest loop now produces a **Page** with provenance. `shareTemplate` replaces the brief half of
`createInvitation` — one link, pointed at the template itself, nothing versioned, nothing for the owner to
manage. `createInvitation` is marked legacy rather than deleted, so links already in inboxes keep resolving
until R.5.

**Provenance is written twice, and the doc was wrong to say once.** §2.1 said "one row, written once, at
submit". That cannot work: the copy has to be taken when the guest is *handed* the template, because the
template stays live — capturing at submit captures whatever it had become by then, which is the exact drift the
record exists to prevent. It is append-only in two moments now, and the doc is corrected.

**The verification is the interesting part.** `npm run verify:guest` drives the real write core against a real
Postgres and *moves the template between fork and submit* — because "a template edited mid-flight is harmless"
is the claim the whole design rests on, and it is unfalsifiable without actually doing it. The fork copy holds.
It also proves the diff reads that copy: `review/[id]` used to compare against `template.components`, which
under a live template would have re-based every past submission the moment its owner touched it — showing a
reviewer changes the guest never made, and attributing them to the guest.

**The cap is on pages, not visits.** `maxUses` counts sessions, so using it would have turned away the 51st
person to *open* a link before they had made anything. 50 pages per link, enforced where the row is written.

Two defects found by writing the checks rather than by reading the code:

1. **The fork record was stamping `submittedAt`.** `buildProvenance` defaulted it to now — correct when
   provenance was a single write at submit, wrong the moment it became two. A page abandoned in draft would
   have carried a submission time forever.
2. **`ssl: 'require'` was hardcoded**, so no local Postgres was reachable at all — every connection died with
   `ECONNRESET` before the first query. Now `sslmode=disable` in the URL opts out and nothing else changes;
   hosted deployments never carry it. This is also what unblocks running the registry locally.

Still to do in R.2: swap `InviteWizard` onto `shareTemplate`. UI only — the data path underneath it is done
and verified.

---

## 2026-08-13 — R.1: three kinds in the library, and promotion as a permission

`kind` moved into `authz/vocab.ts` beside visibility and lifecycle — same sort of thing, read by client
components, and two definitions of one enum is how they drift. `page-provenance.ts` re-exports it rather than
keeping its own copy.

**Promotion is gated on `canChangeVisibility`, not `canEdit`.** Marking a page as a template is what makes it
shareable with strangers; someone holding an edit grant on your page should not get to decide that. Same
reasoning that already put visibility there. `brief` is refused as both a source and a target — nothing may mint
one, and a legacy snapshot is not a page someone is working on.

**The picker is two radio options, not a "Make this a template" button.** A button implies a one-way door and
leaves demotion nowhere to live; a pair shows the current state and makes going back the same size of act as
going forward.

**Guest submissions stop being hidden from the library.** E.6 hid them as "someone else's work against your
brief, not an asset of yours" — but the reflow's whole point is that they *are* pages, owned by the template's
owner. Only briefs are filtered now.

Two bugs fell out on the way, both of the same shape — a default that was documented but not implemented.

1. **`patternRowToDetailResponse` never returned `visibility` or `status`.** `MetaControl` reads that response
   and falls back to `private` / `draft` when a field is absent, so the control has been showing every page as
   private-and-draft whatever the row said — invisible because the first thing anyone does with it is set a
   value. `kind` would have inherited it exactly.
2. **My own promotion rule compared `requested.kind` against a raw `current.kind`** whose doc comment said
   "absent reads as `page`". It didn't, so asking for `page` on a row that had no kind counted as a change and
   was refused for want of a permission. Caught by the test written to assert the no-op case.

Not verified in a browser: the library is behind auth, and creating an account is not something I do. The
policy, the vocabulary and the no-op rules are covered by tests; what the three facets *look like* is not.

---

## 2026-08-13 — R.0: the reflow's storage, proved against a real Postgres

`0029_pages_templates_reflow` + `lib/page-provenance.ts`. Additive only: nothing that exists today reads a
column this touches, so main stays deployable through it.

**`kind` is a new column, not a reused `source`.** `source` already answered "how did this arrive"
(playground / ai / import / guest) and had a third meaning stacked on it — `source = 'template'` means "this is
a brief". Separating *what it is* from *how it got here* is what stops the next feature adding a fourth meaning.
Briefs backfill to `kind = 'brief'`, **not** to `template`: three briefs of one page are not three templates, and
relabelling them would put v1, v2 and v3 in the Templates lane at R.1.

**`template_id` is deliberately NOT repointed yet**, against what the plan said. Today it means "the brief I was
built from" and the review diff reads it; repointing in R.0 would break that on a branch where R.2 has not
shipped. The new value is staged inside `provenance.templateId`, where nothing reads it. R.2 moves the readers
and the column together.

**Verified against Postgres 16 in Docker, not against a mock** (`npm run verify:reflow`, 20 checks). The
interesting parts of this migration are SQL — a CHECK constraint, a partial expression index, and two backfills
that join briefs to the pages built from them — and the last two schema moves each had a defect only a real
database would have shown. Fixtures include the edge case 0028 was bitten by: a brief whose parent page was
hard-deleted. It gets its copy and **no** template link, because an unrecoverable provenance record is worth
less than an absent one.

The check that earns the script: **run it twice**. Auto-migrate runs on every boot, so "idempotent" is a claim
the deploy tests whether we do or not. A hand-reclassified row survives the second pass too.

Two small things caught on the way. A round-trip test found `buildProvenance` and `readProvenance` disagreeing
about `undefined`-valued keys — storage drops them, so the two shapes differed in a way only an equality check
would ever reveal; both compact now. And `next build` rejected `@/transformers/preview/types` from inside
`src/app`, where root `tsc` had resolved it happily — the same path-mapping asymmetry as ever.

---

## 2026-08-13 — Two documents, no code: the reflow and the 8x8 answer

Branch `feature/pages-templates-reflow`, opened off main after a UX session with Natko and Domagoj.

**`docs/PAGES-TEMPLATES-REFLOW.md`** — Designs / Pages / Templates, and the anonymous build loop that ends in a
Page rather than a "build". Four product nouns become three: *brief* and *build* both stop existing, a template is
a page that others may build from, and a guest's submission is a page like any other with provenance attached.

The one place the spec is corrected rather than transcribed is **snapshots**. Dropping them from the UX is right —
versions of a brief are a dev-shaped thing to make somebody manage. But the frozen copy is what keeps a built
page's diff honest ("what did they change versus what they were handed"), and without it that comparison silently
re-bases against a template that has moved on. So: **no snapshot in the product, a fork-time copy on the created
page as provenance.** One row, written once at submit, that nobody names, lists or versions.

Worth recording how little new machinery this needs. `ShareCapability` already reads
`view | create_from_template | edit_own_submission | use_asset_library | submit_for_review`, and
`handoff_share_link` already carries capabilities, `tokenHash`, `maxUses`, `expiresAt`, `revokedAt` and passphrase
lockout — the two link kinds the new flow needs are both expressible today. The reflow is mostly a **renaming and
a collapse**, not a build.

**`docs/REACT-INLINE-EDITING-8X8.md`** — what it would actually take to run inline editing and review on 8x8,
checked against the client repo rather than inferred from the format flag.

- **Review already works.** Every check reads args, not DOM, and `collectEditableText` already descends
  serialized React element nodes — which is exactly 8x8's slot shape.
- **The content gate is empty**: 1003 `required` rules across 70 schemas, and zero length rules.
- **Inline editing has a cheaper route than the roadmap's tracer.** 8x8's Handoff wrappers already convert flat
  editable fields into slots through 14 shared helpers used by 41 of 58 blocks, and those helpers already create
  the DOM node for the value — they just do not know its name. Emitting `data-hf-field` on a node that already
  exists is deterministic, adds no element (the objection that killed spans for Handlebars), and lands in the same
  mark shape the overlay already consumes. F.3's sentinel tracer stays the answer for React catalogs with no
  wrapper layer; 8x8 has one and should not pay for it.
- **The blocker is a deployment, not code**: 8x8 still ships the static build. The catalog is already in a V2
  database — the F.-1 measurement ran over it from there.

---

## 2026-08-12 — QA first pass: the canvas stops being a web page you can walk out of

Seven QA notes off a review pass, all UX. Six landed; they were smaller than they looked, except one that turned out
to be a live bug rather than a polish item.

**A `<textarea>` was the wrong control all along (QA #4).** The inline overlay opened a fixed-height box over the
field, so a headline longer than one line scrolled inside its own box while you typed it — you were editing text you
could not see. Both overlays are `contenteditable` now (the richtext one already was, since F.2b); the only difference
left is what gets committed, `innerHTML` for richtext and `textContent` for text, plus `plaintext-only` so a paste
cannot smuggle markup into a plain string field.

**That swap exposed a dead feature.** F.2b gave richtext a `<div>` overlay and left `input.setSelectionRange(...)` —
a textarea method — running unconditionally right after the overlay was appended. It threw *before* `open` was
assigned, so every richtext edit was discarded silently: the editor opened, you typed, and nothing happened. It shipped
green because the emitted script is a **string**, invisible to `tsc`. Caret placement is now a `Range`, which works for
both. **The lesson is the same one the unescaped-backtick bug taught, so it is now enforced rather than remembered:**
`test/inline-edit-script.test.ts` executes the emitted script against jsdom with the parent's `postMessage` captured —
12 tests covering commit shape, limits, read-only behaviour and the link guard.

**Links in the canvas navigated the frame away (QA #2).** A preview is full of real anchors, and clicking one replaced
the page you were editing with somebody's homepage, taking the scroll position and any open overlay with it. Never a
security problem — the sandbox blocks *top-level* navigation, which is exactly why it always read as the editor
breaking. `link-guard-script.ts` intercepts clicks and submits in the capture phase, leaves `#` anchors alone, and says
why in a small toast.

**Clicking a finding now flashes the whole section, then leaves the field outlined inside it.** The section flash is
opt-in from the parent (`flash: true`), because the rail posts the same scroll message on every block selection and a
section that pulses each time you click down a list is noise. It also moved **above** the mark walker's early return:
that walker exits on a page with no `{{#field}}` marks — which is every React page — and block navigation had been
sitting below it, so a reviewer of a React page had no way to find what a finding was about.

**Clicking a finding could not show you the problem on the review canvas at all (QA #6).** The messages were being posted into
a frame with nothing listening: `canvasControls={level === 'page'}` meant the build/review canvas got no injected
script at all, and — quieter — no `.playground-block` wrapper either, so `scroll-to-block` had nothing to match. The
fix reuses the mark script with an **empty editable list** rather than writing a second walker: it collects marks and
answers navigation, and because nothing is listed as editable it adds no hit areas and no click-to-edit. Highlight now
takes a `reveal` flag — a click scrolls, a hover does not, because a rail that throws the page around on hover is
unusable.

**Pages in the library showed "No preview" on a grey box (QA #3).** The card has always had the picture slot and
`handoff_pattern.thumbnail` has always existed — nothing on the save path ever wrote one, so *every* page saved from
the playground looked broken. Rather than add a headless-browser capture pipeline for a card image, `patternThumbnailSvg`
draws the page's **silhouette** from the blocks it is already made of: one band per block, media/grid/copy/bar, with a
fade band when a page runs past six. Same bargain and same swap boundary as the component thumbnail — callers reference
a URL, so real captures can replace it later without touching a caller. The route authorises with the same
`computePermissions` check the pattern's own GET uses and 404s where that would refuse: a silhouette leaks structure,
and a card image should not confirm a page exists to someone who cannot see it.

Also: image field actions no longer clip — Remove became a trash icon on the preview itself (QA #1), which attaches the
destructive action to the thing being destroyed and leaves the row to the two actions about *choosing* a picture; the
findings list carries a coloured badge per check kind instead of a bullet (QA #5); and the brief/build rail went 300px
→ 360px, since those levels have no right-hand panel and the extra width comes out of empty space rather than the
canvas (QA #7).

**`tsc` passed the whole way through.** `next build` caught a JSX comment placed inside `{cond && ( … )}`, and jsdom
caught the `setSelectionRange` throw. Root `tsc` does not cover `src/app`, and it never covers an emitted string —
worth re-stating every time, because both gates are cheap and both found something here.

---

## 2026-08-12 — The last unsandboxed preview frame, found by looking for the pattern rather than the bug

The pattern detail page framed `/api/pattern/{id}.html` with **no `sandbox` attribute at all**, same-origin. Patterns
are composed from component previews whose values are guest-authorable — `RichTextField` accepts pasted HTML, and F.2b
just added inline richtext editing — so a `<script>` that rode in on authored content would have run with the viewing
admin's cookies and API access. Stored XSS, reachable by anyone holding a guest invite link.

**§14 had already been decided, shipped, and verified — for three surfaces out of four.** `Playground/Preview.tsx`,
`Component/Preview.tsx` and the `/api/component` route all got the opaque-origin treatment; the pattern page was
missed because it renders via `src=` rather than `srcdoc` and so didn't look like the other three. Worth stating
plainly: **a fix that's rolled out per-surface is not finished until you enumerate the surfaces.** The cheap version of
that is `grep '<iframe' | grep -v sandbox`, which now returns only the GTM `noscript` frame.

**Latent, not live** — `/api/pattern/{url}` 404s on the ssc-handoff deployment today, because that path is populated by
the static `handoff-app build` export and not by the registry deploy. Fixed anyway: the hazard lands the moment
static-built pages are served, and nothing about the code says "don't serve these yet".

**The height read was the thing holding the sandbox out**, exactly as it was in the original §14 audit. `onLoad`
reached into `contentWindow.document.body.scrollHeight`, which *requires* same-origin. It's now the same
report-your-own-height protocol the other surfaces use. Because a pattern document is a **static file under
`public/api/pattern/`**, there is no request handler to inject the reporter at — so it goes in at compose time in
`composePatternHtml`, and the CSP that the `/api/component` route sets per-response comes from a `headers()` entry in
`next.config.mjs` instead.

That reporter script now exists **once**, in `transformers/preview/height-reporter.ts`. It had been pasted into two
places and was about to become three, which is a genuine hazard and not just untidiness: the posted `type` and the
`event.data.type` the parent tests are a contract, and copies of a contract drift silently — a frame reporting under a
renamed type simply stops resizing, with no error anywhere to say so.

**Verified with a negative control, which is the part worth copying.** A harness framed a real `composePatternHtml`
document containing hostile authored content, over HTTP, and had the frame report what it could reach. Sandboxed:
`parent.document`, `document.cookie`, `localStorage` all `SecurityError`, and the frame sized itself to 664px. The same
harness with the attribute removed read the parent page's title straight out. Without that second run, "all three
blocked" is equally consistent with a probe that was broken.

---

## 2026-08-11 — A build could not be submitted, and the reason was in a Vercel log

Submitting a build returned *"Could not submit the page."* while the server log held `8 things need fixing…: Logo is
required. Primary is required. Items is required.` Two separate defects behind one symptom; full write-up under
`E.11` in `docs/WORKBENCH-PLAYGROUND-ROADMAP.md`.

**`required` was asking the wrong question.** It decided satisfaction with `typeof value === 'string' &&
value.trim().length > 0`, which makes it **unsatisfiable on every field that does not hold a string** — an image is
`{src, alt}`, a button `{url, label}`, a repeater an array. The lesson generalises: *a predicate written for one value
shape becomes a bug the moment the rule it enforces is applied more widely.* It only surfaced when E.9 wired
component-declared `required` into the gate; before that only a brief's text rules reached it, so the narrow
definition held.

**Measuring it on real data is what made it undeniable.** Feeding every SS&C component *its own shipped preview
values* — complete by definition — produced **68 false findings across 81 components**, labels matching the reported
error exactly. Same probe after `hasAuthoredValue`: **0**. Worth keeping as a technique: when a validator is suspect,
run it against the data the system itself ships and see what it rejects.

**Structured findings were computed and then flattened.** `throw new Error(summarizeBlocking(blocking))` reduced a
list of findings — each carrying `path`, `label`, `blockIndex`, `code` — to one sentence, which the route turned into
a 500. Everything a person needs in order to fix the problem existed, and was discarded at the last step.
`GuardrailBlockedError` now carries them and the route answers **422 + `findings`**. General rule: **an error a user
can act on should carry the data they need to act**, not a rendered summary of it.

Also reversed a decision: **richtext inline editing is back on the list (F.2b)**. I had parked it because the overlay
is a `<textarea>` that cannot carry markup — but that is a fact about our overlay, not a reason a guest should find
one paragraph mysteriously uneditable. Brad: *"it's weird to make most of the content editable but not this section
for opaque reasons."* The roadmap now states the real problem (seed from the mark's `innerHTML`, own the node via a
ref as `RichTextField` does, reuse `measuredLength` for the counter) instead of the excuse.

---

## 2026-08-11 (night) — Component JS had been dead on SS&C for two months

Pre-demo bug hunt. Two findings worth keeping, both diagnosed from evidence rather than from the error text.

**`ReferenceError: exports is not defined` on `/api/component/main.js` — every component's JS was inert.**
`buildJsBundle` (`transformers/preview/component/javascript.ts`) built with Vite library mode
`formats: ['cjs']` plus `rolldownOptions.output.exports = 'named'`, which emits
`Object.defineProperty(exports, Symbol.toStringTag, …)` as the first statement. A classic `<script>` has no
`exports` binding, so line 1 threw and **the whole file never executed** — `main.js` (Bootstrap + Popper) and every
per-component `<id>.js` alike. Accordions did not expand, carousels did not slide, tabs did not switch, and the only
evidence was one console error inside a sandboxed iframe.

Now `formats: ['iife']` with the rolldown `exports` override dropped. Verified by running the same Vite config over
SS&C's real entry: `cjs` + `exports: 'named'` reproduces the deployed prologue **byte-for-byte**, and `iife` produces
`(function(){…`. Not `esm`, which would need `type="module"` on an injection that is deliberately classic.

**It was not a regression from the content-length rebuild.** The artifact is byte-identical (343,235 bytes) across
2026-06-07, 2026-06-09 and today, so the breakage predates all of this work by two months.

**The importmap 404 beside it is cosmetic**, and worth not chasing again: `hvendor-importmap.json` is a React
vendor-split artifact, absent by design on a Handlebars registry, and the fetch is guarded
(`r.ok ? r.json() : null` + `.catch`). It *reads* as a CORS failure only because
`api/component/[...path]/route.ts` sets `Access-Control-Allow-Origin` for `.js`/`.mjs`/`.css` and not `.json`.

**Image generation on SS&C: generation was never broken, retrieval was.** Its generated assets carry
`storageUrl: https://cdn.handoff.com/assets/….webp` and **`cdn.handoff.com` is NXDOMAIN**. 8x8 works because it has
no S3 configured at all and therefore uses the blob path (`/api/handoff/assets/<id>/raw`). `getConfig()` in
`s3-assets.ts` requires all four `HANDOFF_S3_*` vars, so clearing `HANDOFF_S3_BUCKET` is enough to fall back to the
working path. Rows written earlier keep the dead URL — they need regenerating.

**Diagnostic worth reusing:** the shape of an existing `storageUrl` says which storage path a registry is on, and
comparing two registries through the MCP settles "works there, not here" in one call each.

## 2026-08-11 (evening) — E.9's real bug, and F.2's orientation half

Full write-ups in `docs/WORKBENCH-PLAYGROUND-ROADMAP.md` (F.2 "orientation half" + the E.9 addendum). Three things
here worth not re-deriving.

**A limit has to be measured the way it is displayed, and richtext broke that in both directions.** The server counted
`<b>Hi</b>` as 15 characters, and `RichTextField` had **no counter at all** — so an author could be blocked on submit
by a limit they were never shown, counting tags they never typed. `measuredLength`/`richTextToCopy` now sit in
`authoring-guardrails.ts` next to the limits, and are **regex-based rather than `DOMParser` on purpose**: the same
function must run in the browser and on the server, because the whole failure was the two disagreeing. A tag boundary
becomes a space (`<p>Alpha</p><p>Beta</p>` is not one word); `&nbsp;` is the only entity that really matters.

**"Where is this actually counted?" is the question that finds this class of bug.** Asking it turned up a second one
immediately: the canvas overlay built its counter from `guardrails.fields` only, so on a registry whose limits all
come from component contracts — SS&C, every single one — the canvas showed nothing while the rail showed a number and
the server enforced it. Now keyed **per block**, because two components can declare different limits for the same
field name and a flat map showed one block the other's number.

**The root `tsc --noEmit` is not sufficient for app-layer changes.** It passed clean while `next build` failed the
type check on a stale option type — `src/app` has its own tsconfig. Run the Next build when touching
`src/app/components`.

F.2's remaining work is richtext and images inline. Richtext stays in the rail by the earlier decision (the overlay is
a `<textarea>` and cannot carry markup) and now at least has a working counter; images need the media browser, which
is a rail thing.

---

## 2026-08-11 (later) — SS&C content limits: surveyed, rationalized, applied

Full write-up in `docs/WORKBENCH-PLAYGROUND-ROADMAP.md` under `F.-1b`/`F.-1c`; the record of all 420 fields is
`docs/SSC-CONTENT-LENGTH-PLAN.md`. Three things here worth not re-deriving.

**`rules.content.{min,max}` does not mean one thing.** On `text`/`richtext` it is a character length. On an `array`
it is a **row count** (`blog_header.authors` max 2, `hero_split.breadcrumb` max 4). On a `number` it is a **value
range** (`stats.items.*.duration` spans ±10,000,000). My first pass treated the last two as "not free text" and
proposed deleting all 78 of them. Nothing in the app enforces the count or the range today —
`componentFieldRules` extracts `content` for every type and only `TextField` consumes it — but **unenforced is not
meaningless**, and deleting an author's stated intent because the runtime ignores it is how information is lost.
Anything touching `rules.content` generically needs to know this.

**`min` on editorial copy is always wrong.** 389 of 420 SS&C fields carried one; not one of them can prevent a
layout break, and they reject legitimately short copy ("Go", "Q1 2026", "APAC"). They exist because
`config/templates/component/template.json` shipped `{min: 5, max: 25}` and it got pasted down every property list.
Requiredness is `rules.required`. 277 dropped while keeping a cap, 47 dropped with the whole rule; the 65 survivors
are all row counts and ranges.

**Editing these files needs an AST, not a serializer.** `handoff/integration/**/<id>.js` are hand-formatted (preview
arrays hold compacted one-line objects) so re-serializing reflows 81 of 83, *and* they are JavaScript rather than
JSON — `bar_chart.js` writes its description as a template literal, which defeats a JSON scanner too. Parse with
acorn, replace only the spans you mean, and check the span parses back to what you expected before writing.

**A rationalization creates its own false positives.** After applying, the F.-1 audit still reported 10 findings and
all 10 were correct-by-design: it flagged six `title` fields sharing a 60-character cap as a copy-paste smell, when
that consistency *is* the fix. Fixed both classes (89 → 4). Same lesson as the 107 → 14 render-audit pass — a report
with permanent noise stops being read.

**The last 4 findings then went to their role floors** (4 files, 10 fields) — audit now **0**, plan proposes **0**
further change. The roles came from each field's own `name`/`description` ("Column 1 Label", "The search
placeholder", "Bottom Link Text"), and `search`/`link`/`header` joined `ROLE_LIMITS` so the audit recognises them and
the findings stay closed. Two of the ten moved **up** (`menu…mega.link` 25 → 32), reversing what `F.-1b` recorded:
that cap came from the same paste as everything else in `menu`, and its own value fills 18 of 25 characters.
`filters.sort.*.sort` left at 45 — it holds `alp_asc`, a machine key, so no length is meaningful either way.

Left uncommitted in `ssc-handoff-next` for review. **Then rebuilt (83 components) and pushed to
`https://ssc-handoff.vercel.app` — 83/83 applied, sync events 3046 → 3129, counts unchanged at 83/16/67.**

**`push:all` was deliberately NOT run, and this is the thing to remember.** It POSTs `/api/registry/tokens` and
`/api/registry/dtcg` from `public/api/tokens.json` (local: **June 7**) and `design-system/` (local: **June 17–18**),
but the registry received a **figma-sync on 2026-07-17** — 225 tokens added, then 100 modified, then typography and
shadow keys twice more. Running it would have reverted a month of Figma token work on a live client registry. Brad
chose components-only. **`push:all` does not push components anyway** — it covers config, theme, navigation, pages,
tokens, DTCG, icons and logos; component contracts travel via `handoff-app push` → `POST /api/sync/upload`.

Three things that made the push safe to run, all checked first rather than assumed:

- **`handoff_recent_changes` shows no `component` events on the registry in 365 days.** A component push *replaces*
  `properties` and `previews` (`sync-queries.ts` `onConflictDoUpdate`), so registry-contributed previews would have
  been overwritten — there were none. All registry activity is patterns (UI/guest page builds), tokens and doc pages.
- **`--components` bare still includes 60 pages.** Passing explicit ids makes the push *selective*, which drops pages
  and patterns: `push --components <83 ids> --no-build` dry-ran as 83 components / 0 pages / 0 patterns. Note
  `entries.components` in `handoff.config.js` is a list of **directories**, not ids, so ids come from the integration
  folders.
- **`--dry-run` needs no cloud token**, so the exact change set is inspectable before anything is sent.

**Closed out against the registry itself:** the deploy to `feature/mcp-prototype` (a clean fast-forward, 154 commits,
two additive idempotent migrations) went out, and `?plan=1` on `ssc-handoff.vercel.app` came back **0 findings, 292
`keep` / 78 `not-a-length`, plan settled**. Three independent agreements now — local contracts, MCP spot check, and the
registry's whole-catalog sweep over the stored rows.

**`handoff/.handoff/sync-state.json` was stale — now repointed.** It read `remoteUrl: http://localhost:4002`,
`lastSyncVersion: 3`, `lastSyncAt: 2026-06-06` with 3 fingerprints whose `relativePath`s still named
`*.handoff.ts` files that no longer exist, against a remote at version 3129. A successful push does not update it,
because **`run-push` never reads this file at all.**

Set to exactly what `run-pull` writes for fresh state — `{remoteUrl: <live>, lastSyncVersion: 0, lastSyncAt: '',
fingerprints: {}}`. Cursor **0** is the only honest value: it means "nothing has been pulled from this remote", so no
registry change can be silently skipped. Hand-setting it to 3129 would declare the workspace current and permanently
skip real remote content — the 16 registry patterns are not in the workspace at all, and 7 of its 67 pages are not
local.

`run-pull` would in fact have repointed itself (`if (state.remoteUrl !== baseUrl) { … lastSyncVersion = 0 }`), so this
was pre-empting the CLI rather than fixing something it could not do.

**Correction to the note above: push skipping has nothing to do with `sync-state.json`.** It is governed by
`.handoff/.cache/build-cache.json` (3 entries, dated June 20). All 83 components re-uploaded because passing explicit
`--components <ids>` makes the push **selective**, and `run-push` disables the skip-cache for selective pushes by
design. A bare `handoff-app push` would consult the build cache — and would also sweep in 60 pages.

**A `pull` from cursor 0 is safe but noisy:** the dry run reports 260 component entries and 60 pages (the feed replays
every historical version), producing **180 conflicts across 60 unique pages**. Conflicts are parked under
`.handoff/conflicts/` rather than overwriting local files, so nothing is lost — but it is 180 files to triage. Brad's
call: leave the cursor at 0 and triage them. **Do not advance it to quiet the pull.**

**Flagged for later: `ssc-handoff.vercel.app` is a beta registry**; the live SS&C design system gets connected at some
point and this work has to come with it. Written up under *"Porting the length + validation work"* in
`docs/WORKBENCH-PLAYGROUND-ROADMAP.md` — the short version is that the tooling is code in this repo and travels for
free, while the 342 applied values only travel if the live site is fed by this same workspace.

**The applier is now committed rather than a scratchpad throwaway:**
`npm run contracts:lengths -- --workspace <dir> [--write]` (`scripts/apply-content-length-plan.ts`). Rewritten to use
the **TypeScript compiler API** instead of acorn — acorn resolves in this repo only *transitively* and is not a
declared dependency, so a committed script leaning on it could break on a future install, while `typescript` cannot go
missing in a repo that builds with `tsc`.

Verified by replaying the real change: `blog_header`, `bar_chart` and `menu` restored from `HEAD` into a fixture
workspace produced **byte-identical** output to what shipped, nothing outside `rules` moved, the template literal and
compacted preview objects survived, a re-run was a no-op, and against the live contracts it reports 0 edits. One nice
consequence — the roles added in `F.-1d` (`search`, `link`, `header`) mean the script now derives the targeted-pull
values on its own, so **a port is one pass, not a bulk pass plus a cleanup pass**.

**The report generator went in as `--report` on that same script, not a second one.** The reason is the failure it
already caused: the original read a separately-produced `plan.json`, the two drifted the moment a field was revised by
hand, and the published `docs/SSC-CONTENT-LENGTH-PLAN.md` had to be repaired to stop it describing labels that never
shipped. Rendering the document from the plan that was just applied makes that impossible.

Two things fell out of writing it:

- **Derive tables, don't type them.** The role-floor table now comes from `ROLE_LIMITS`, and deriving it immediately
  exposed `subtitle_muted` having no `IN_ROW_OVERRIDE` while `subtitle` did — the same field would cap at 160 inside a
  repeater row and 120 outside one. My hand-typed table had also gone stale within a day of adding three roles.
- **Never print an absolute path into a committed document.** The first draft put the run's `--workspace` in the
  header, which bakes a home directory into a client-facing file. Provenance moved to `--note`, which is also how a
  regenerated record states that it already shipped — a fixture run cannot know that.

`docs/SSC-CONTENT-LENGTH-PLAN.md` is regenerated output now (420 rows, 76 sections). Every headline number matches the
hand-made version; only the `drop-min`/`lower-max`/`keep` split moved, because the old one carried hand-written labels
for the ten targeted fields.

Two pre-existing issues surfaced on the way, neither mine: `validate:schema` reports `blog` and `hero_split` as
having no id/title/properties because it takes the **first** `.js` in the folder alphabetically
(`handoff/build/validate-schema.js:65,71`) and both dirs contain a `*.client.js`; and the build's own validators
report accessibility errors on ~10 components, unrelated to `rules`.

---

## 2026-08-11 — Inline editing didn't persist: the canvas draws Handlebars from a cached string

Brad on the F.2 core: "The inline editing interface works great. The content doesn't persist." Both halves were
true, and the cause is worth remembering because it will bite anything else that writes a block's args.

**`constructComponentPreview` renders a Handlebars block from `component.rendered` — a cached HTML string
(`Preview.tsx:359`) — and never re-renders it from `component.data`.** `rendered` is refreshed in exactly four
places: on add, on load/bulk-add, on `EditContext.handleSave`, and in the brief's export. The F.2 commit path wrote
`data` and skipped it. So: the record updated, autosave wrote the new value to the DB, the canvas rebuilt from the
stale string, and the text snapped back the moment it was committed. It looked like nothing saved.

**Rule of thumb: writing `data` without `rendered` is a no-op on screen for Handlebars.** The rail's `handleSave` had
this right from the start; the inline path now does the same, with the reason recorded at the call site.

Two things fell out of the fix.

**`setAtArgsPath` is its own module now** (`lib/set-at-args-path.ts`, 12 tests). What an absent intermediate should
become is the subtle part: `['items', 1, 'paragraph']` must create an **array**, not an object keyed `"1"`, or the
write is accepted and saved and the template's `{{#each}}` never sees it. Silent success — the failure class Phase F
exists to eliminate — and untestable while it lived inside a `useEffect`.

**The canvas now keeps its scroll position across a rebuild.** Every commit replaces the whole `srcdoc`; there is no
partial update, because a Handlebars block *is* a rendered string. That threw you to the top of the page on every
edit — survivable from the rail, unusable when you are typing in the canvas. The frame is opaque-origin, so it can
only be done from inside: the frame reports `scrollY` (coalesced to one message per animation frame), the parent keeps
it in a **ref** (never state — this fires on every scrolled frame) and bakes it into the next rebuild. Two gotchas:

1. **Restore twice** — once immediately, once after `load`. Images finishing changes the document height, and a
   `scrollTo` past the height the document had a moment ago is silently clamped, landing you short.
2. **Detect "the user moved" from input events, not from position.** A clamped restore also leaves `scrollY` far from
   the target, so comparing offsets cannot distinguish "they scrolled away" from "the restore fell short". It watches
   `wheel`/`touchstart`/`keydown`/`mousedown` instead.

It lives in the **block-controls** script, not the inline-edit one, so rail edits keep their place too.

981 tests, `tsc` clean, `next build` compiles. Still open in F.2: hover linking (the frame emits and accepts the
messages, the rail consumes none), applying the reported document order in the rail, a visible commit/cancel
affordance, and richtext/images.

---

## 2026-08-05 (evening) — Invite-to-build QA: controls moved to the page; two items queued for tomorrow

**Start here tomorrow: E.7 in `docs/WORKBENCH-PLAYGROUND-ROADMAP.md`.** Two decisions from Brad, both already
written up there; this entry is the why.

**What shipped today (QA-driven, on top of E.6):**

- **Visibility + lifecycle now live on the page** — `components/Playground/PageMetaControl.tsx`, replacing the
  old toolbar "Share" button. Reuses the existing `VisibilityPicker`/`LifecyclePicker` and reads `permissions`
  from the pattern detail endpoint, so it can never offer a change `applyPatternMeta` would refuse.
- **Share controls removed from `/library`** — the whole share section, plus the dead `shareUrl` /
  `onCreateShare` / `onRevokeShare` props and the `CopyButton` helper, out of `AssetInspector`.
- **Guests can finally reach the asset library.** The endpoint (`/api/handoff/guest/assets`) had existed since
  slice 1 — `MediaBrowser` just never called it. It asked the authenticated route, got a 401, silently fell
  back to static workspace assets, found none, and landed on the Placeholder tab. Verified end-to-end against
  a real invite link: 60 assets, picker opens on "Asset Library".
- **Bug found while testing that:** the image field offered guests a **"Generate"** button, posting to a
  session-only endpoint — against the explicit "asset library only, no generating" rule *and* a guaranteed 401.
  `aiAssistantEnabled: false` never reached the field layer.

**The load-bearing lesson, worth not re-deriving — the field layer has two hard constraints:**

1. **Fields must not import `PlaygroundContext`.** It imports `@/app/actions/patterns` (server actions →
   `server-only`), so importing it from a field drags that graph into *every* consumer of `renderFormFields`
   and they stop loading entirely. `tsc` does **not** catch this; `test/field-array-coercion.test.ts` did.
2. **Fields render outside any playground.** `ComponentWorkbenchDialog` renders `renderFormFields` and
   `MediaBrowser` in the component docs with no provider above them, and `usePlayground()` *throws* there.

Both are why surface-dependent state reaches fields through small provider-optional contexts whose defaults
describe the no-provider case — `FieldGuardrailsContext` (content limits) and `FieldMediaContext` (asset
source + whether generation is offered). `test/field-guardrails-context.test.ts` guards both constraints;
the module-graph assertion there was confirmed to actually fail when the coupling is reintroduced.

**Queued for tomorrow (E.7):**

- **E.7a — finish moving visibility + lifecycle out of the library.** Half-done today: the page editor has
  them, but `AssetInspector` still sets them too — the duplication the spec was written to prevent. **The
  thing to decide first:** design artifacts have no page view, so that sidebar is currently their *only*
  visibility/lifecycle control. Removing it outright strands them.
- **E.7b — `public` needs a copy-link affordance.** Taking share out of both surfaces left no UI that hands
  out a URL, so `public` ("anyone with the link, view only") has no delivery mechanism. Just the link,
  copyable, next to the visibility setting — not a return of the capability-picking panel. `ShareLinkPanel`
  now has zero consumers and is either the basis for this or gets deleted.

**Gotcha (local dev, cost ~20 min):** `.env` sits at the repo root but the dev server runs with cwd
`src/app`, so `next dev` never loads it — auth throws `ClientFetchError` and every page stalls at
"Loading...". Fixed with a gitignored `src/app/.env.local` symlink to the root `.env`.

Also still open in Phase E, unchanged: soft delete (`removePattern` is a real hard delete, reachable from
`PatternBrowserClient`), notifications, and the `handoff_publication` table — created in migration 0028 but
absent from `schema.ts` with zero readers or writers, so the derived "Published" chip cannot work yet.

---

## 2026-08-05 — Design note: direct manipulation in the playground editor (Phase F)

Design only, no code. `docs/PLAYGROUND-DIRECT-MANIPULATION.md` + Phase F in
`docs/WORKBENCH-PLAYGROUND-ROADMAP.md`. Prompted by the field editor being functional-but-klunky: schema-order
fields with patchy help text, opaque block parameters (`light`/`dark`, `left`/`right`, overlay), rough visuals.

**The load-bearing idea, worth not re-deriving:** inline editing on arbitrary components is possible, but not
by detecting props in the DOM — that is reverse-engineering the render. Instead **mark the values before
render and find the marks after**; the component's own render is the oracle. Zero-width sentinels for text, a
`?__hf=` query param for URLs. This is `slot-probe.ts`'s existing sentinel technique extended to record *where*
the mark landed, so it needs no component-side cooperation — which the "no Handoff sauce in production
components" constraint requires.

Deliberately **do not** trace enums/booleans/numbers: a sentinel corrupts a class name or flips a branch. That
exclusion is the design rather than a limitation — tracing works on exactly the props worth editing inline and
fails on exactly the ones where inline editing is meaningless. Hence hybrid: content inline, configuration as
*rendered* choices (F.1 — miniature renders per enum value, which is the actual fix for the opaque-parameter
complaint and needs no tracer at all).

Two traps recorded in the note. (1) Never `contenteditable` the component's own node — reconciliation eats it,
per the existing caret-loss comment in `RichTextField.tsx`; use a positioned overlay, which also makes the path
identical for React and Handlebars. (2) Don't build the tracer *for* inline editing. First consumers are hover
linking and document-order field sorting, where partial coverage still wins and a missing trace is invisible;
inline editing (F.3) is gated on coverage measured there.

Gotcha for whoever picks up F.3: `field-lens.ts` says stored preview values are serialized render *output*, not
input props. F.3 is the first phase that writes back into args, so it inherits that bug — capture has to be
repaired first. F.0–F.2 only read.

## 2026-08-05 — E.1 (share + review reachable) and E.3 (pages as documents)

Staged uncommitted for review; see `REVIEW-2026-08-05.md` for the click-through list.

**E.1 — complete.** `ShareLinkPanel` mints a **View only** or **Invite to build** link (label, expiry,
max uses) and lists active links with usage + revoke; it drops into `AssetInspector` via a new optional
`shareResource` prop, so both the library and the playground's pattern picker get it without duplicating
anything. New `GET /api/handoff/share/links` (gated on `canChangeVisibility`), plus `listShareLinks` and
`countReviewQueue`. `/library` now has a maintainer-only **Review queue** entry, badged, counted
server-side so the badge is right on first paint and non-maintainers never learn the number.

The UX consequence worth remembering: a write-capable secret is hashed, so it is showable **exactly once**.
The panel says so, and an existing hashed link renders "the full URL can't be shown again" instead of an id
that looks like a URL and 404s for the recipient. `secretRecoverable` exists precisely to allow that.

**E.3 — mostly done.** `/playground/{id}` is a real route (unknown id → 404, not a silent empty canvas that
eats whatever you type next). `buildPatternPayload` moved to `lib/pattern-payload.ts` so autosave and
`SavePatternDialog` cannot write differently-shaped records — that mapping is what the playground reads back
*and* what the guest diff compares, so drift there would surface as "loads differently than it saved".
Autosave is debounced 2s and writes `components` + `data` only: title/group/tags are edited elsewhere and
empty strings would wipe them.

Two details that would have been bugs:

1. *The load would have saved itself.* `loadPatternById` sets canvas and id together, so without a
   persisted baseline the first render after a load writes what it just read. Fixed with `persistedRef`
   treating the first observation as already-saved.
2. *Deleting the local-storage key would have destroyed unsaved work* on the deploy that shipped it. So the
   auto-restore is gone but the key is read **into an offer** — "unsaved canvas from a previous visit (N
   blocks)" with Restore / Start fresh, cleared either way, never shown for a page opened by id. That fixes
   "New loads old stuff" without a data-loss deploy.

Net lint effect: `PlaygroundContext` 5 → 4 warnings (the removed auto-restore effect), builder/picker
unchanged at 2, new files clean.

**E.2 deliberately not started.** It removes the only way to create a record and rewires saving on the
surface Brad uses daily, and authenticated pages cannot be visually verified from here. Everything it needs
is now in place (autosave, shared payload builder, `source: 'template'`/`template_id` unused in the UI).

---

## 2026-08-05 — Slice 3 guardrails, and where content limits actually belong

`lib/authoring-guardrails.ts` — pure, client-safe, 21 tests — running in the three places that must not
disagree: the guest editor as you type, `submitGuestSubmission` (the only one that counts), and the review
queue as annotations.

**Revised a decision from the design note.** It put constraints on the FIELD-BRIDGE descriptors. Wrong for
content limits: descriptors describe a **component contract** — code-owned, replaced on push — whereas
"headline maxes at 60 here" is an **editorial rule about a template instance**, authored by the person who
built the template. Same contract-vs-instance line the previews/properties split already draws. So config
lives at `template.data.guardrails`, resolving template-default → per-field override, and **the template
always beats a page's own copy** — otherwise a guest could relax their own limits by writing to `data`,
which is the whole game.

**The property I care most about: nothing is invented.** A limit applies only where configured; the engine
never infers a rule from a template value's length. Only the unambiguous checks are configuration-free
(missing alt, required-but-empty-*or-absent*, "click here" link text). Verified all five cases against the
DB — including *no guardrails configured → submits fine*, which is the one that proves it.

`required` needed its own pass: `collectEditableText` only reports strings that *exist*, so an absent slot
would satisfy a required rule by not being there — the exact failure the check exists for. My first version
of that pass was a tangle of double negatives; rewrote it plainly.

Small polish the verification surfaced: a finding read "**Src** has no alt text" — image slots were
labelling from `props.src`. Added `labelForImage` (skips `src` too, so it reads "Desktop Image"), kept
separate from `labelFor` so a text field genuinely named `alt` still labels "Alt". Pinned with a test.

Two UI decisions worth keeping: **no `maxLength` on the inputs** (silent truncation of pasted copy loses
text without saying so — the counter turns amber instead), and the submit button is disabled *with* the
reason next to it, since the server refuses the same content regardless.

**Not started:** the in-iframe a11y agent. Heading order, tab order, focus visibility and real computed
contrast need the rendered DOM, which the opaque-origin sandbox puts out of reach — that checker ships
inside the preview bundle and becomes part of the preview contract.

Also, Brad's three observations from testing are now **Phase E** in the roadmap: E.1 surface what Slices
1–2 built (nothing links to `/review`, and no UI mints a write-capable link — `POST /api/handoff/share`
already accepts `capabilities`/`label`/`maxUses` and nothing calls it with them), E.2 one save path with
promote-to-template as the headline action, E.3 `playground/{id}` as a real autosaved route with the
local-storage rehydrate removed. Sequenced E.1 → E.3 → E.2, because "one save path" only makes sense once
the record is the source of truth.

---

## 2026-08-05 — "The input argument must be ArrayBuffer ([object SharedArrayBuffer])" = sharp's wasm build meets the AWS SDK

Reported from the field-sidebar image generation. **Not our code being wrong — a valid Buffer the AWS SDK
refuses.**

The chain, each link verified rather than assumed:

1. The string is verbatim from `@smithy/util-buffer-from`'s `fromArrayBuffer`, whose `isArrayBuffer`
   check is `instanceof ArrayBuffer` — a SharedArrayBuffer fails it.
2. It is reached from `@smithy/core`'s **`toBase64`**, which — unlike the neighbouring `castSourceData` —
   has **no `Buffer.isBuffer` short-circuit**: `fromArrayBuffer(input.buffer, input.byteOffset, …)`. So a
   perfectly ordinary Buffer throws if its *backing store* happens to be shared.
3. Where does a shared backing store come from? **`@img/sharp-wasm32` is installed**, and its glue has
   `_emscripten_has_threading_support = () => !!globalThis.SharedArrayBuffer` plus explicit
   `isSharedArrayBuffer` handling — the threaded WASM heap **is** a SharedArrayBuffer, so
   `sharp(...).toBuffer()` on the wasm build returns bytes over it.
4. `HANDOFF_S3_*` is configured, so `storeImageAsset` takes the S3 branch and hands exactly those sharp
   outputs (the webp body and the thumbnail) to `putToS3` → SDK → `toBase64` → throw.

That is also why it never reproduces in dev: locally sharp resolves to `sharp-darwin-arm64` (native), and
every buffer here is ArrayBuffer-backed — confirmed by running the whole byte pipeline (sharp 0.35.2 webp
+ metadata + thumbnail + sha256 + base64) with clean results, and by checking `Buffer.allocUnsafe` and
`createHash().digest()` backing stores. No failed job row exists in the dev DB either, which fits: the
failure happened where the wasm variant is in use.

**Fix:** `toPlainBuffer` in `image-bytes.ts` — returns the buffer untouched when its backing store is
already an `ArrayBuffer`, otherwise copies the *view* (not the whole heap) onto
`Buffer.from(new ArrayBuffer(n))`, which is plain by construction. Applied in `putToS3`, the single point
where bytes enter the SDK, so every caller and both uploads are covered. Five tests, including one that
builds a genuinely shared-backed Buffer and asserts the SDK's own check would have rejected it first.

**Worth chasing separately:** the deploy is evidently using sharp's **wasm** build. That is not just this
bug's cause, it is also several times slower than native for every resize. The native Linux binary
(`@img/sharp-linux-x64`) should be present in the deployment install — worth checking whether optional
dependencies or a platform mismatch are dropping it.

Also, post-merge fallout worth noting: the ESLint flat-config work renamed `usePostgres` → `isPostgres`
(because `useX` tripped the react-hooks rule), so the Slice 2 code written before that merge no longer
compiled. Four call sites updated. And `npm run lint` works now — 0 errors repo-wide, and the review UI is
warning-free after moving its initial queue fetch into the (already maintainer-gated) server component
instead of a mount effect, which also removed a real missing-cancellation bug.

---

## 2026-08-05 — Slice 2: the review inbox, and moving the approve gate so MCP could exist

`/review` + `GET/POST /api/handoff/review[/id]` + `handoff_list_review_queue` / `handoff_review_page`.

**The structural move was the point.** The approve rule lived inside the `setPatternMeta` *server action*,
which is why the roadmap noted an MCP status setter would have to duplicate it. It now lives in
`lib/authz/review.ts` (`decidePatternMetaChange` / `decideReview` — client-safe, 11 tests) and is enforced
by `applyPatternMeta` / `reviewPattern` in the write core. The server action, the HTTP routes and the MCP
tools are now thin wrappers; none of them re-derives the rule. Same principle as `assertCanMutatePattern`
living inside `pattern-write`.

Decisions worth keeping:

- **Reject requires `canApprove`, not `canEdit`** — otherwise the submission's *owner* (the link creator,
  who owns every guest page by design) could clear the queue without being a maintainer.
- **Reject → `draft`**, which is precisely what re-opens guest editing. "Send back with a note" and "ask
  for another pass" are one mechanism, not two states.
- **Only a page in `review` can be decided**, re-checked in the UPDATE's `WHERE` so two reviewers racing
  can't both record a verdict; the loser gets 409, which is what a stale queue deserves.
- **Approving never touches visibility.** Attention ≠ access.
- Queue is **one query** — lateral join for the latest guest change, on `pattern_status_idx` from `0027`.

**Verified server-side with real actors** (the UI needs a signed-in maintainer, and I won't type
credentials): queue returns the submission with submitter/template/link/note/owner; non-maintainer reject →
`AuthorizationError`; maintainer reject → `draft`; rejecting again while `draft` → refused with the actual
status in the message; the row leaves the queue; approve → `approved`; visibility still `private`; changelog
carries the guest edit plus both verdicts with `trigger=review` and their notes. All three review endpoints
401 unauthenticated, and `/review` redirects to sign-in. Test data removed.

**`strict: false` bites here.** The app compiles with `strictNullChecks: false`, so a
`{ok:true}|{ok:false}` union does *not* narrow via `if (!decision.ok)` — TS collapses it and `.reason`
fails to typecheck. Fixed with an explicit `isMetaDenied` type guard, which narrows regardless. Worth
remembering before writing another discriminated union in this codebase.

Two bits of polish caught by looking at real output: the queue was rendering "Submitted by
**guest:**Casey Jordan" (the `guest:` prefix is provenance in `history_label`, not part of a name — now
stripped for display), and the template diff was inline in the route, so it moved into
`diffSubmissionAgainstTemplate` with six tests, including "diff against the template as it stands now, not
the submission's stale copy".

---

## 2026-08-05 — Guest authoring verified end-to-end, and a migration numbering trap worth knowing

Drove the whole flow in a browser against the dev DB: name gate → draft created from template → text
edit → autosave → asset swap → submit → locked. Then read the rows back. Everything held: `status=review`,
`visibility=private` (untouched), `source=guest`, owner = **link creator** (not null), `template_id` +
`share_link_token` set, one override entry, and — the thing most likely to have broken — the swapped image
kept `props.width: 1280` and `type: 'img'`, so `applyOverride` did protect the element node. The asset's
alt text followed the image and then showed up as an editable Alt field on its own, which is
`collectEditableText` doing exactly what it should. Changelog: 5 rows, every one `trigger=guest`,
`by=guest:Casey Jordan`, with the submit note as the "why". Link `use_count: 1` — reloads and PATCHes did
not inflate it — and the row stores only the public id, never the secret.

Negative cases, all against the server rather than the UI: bare id with no secret → 404; wrong secret →
404; guest API with no cookie → 401; PATCH after submit → 403; and a PATCH carrying
`status: 'approved', visibility: 'public', userId: 'someone-else'` → 400 "Nothing to change", i.e. every
escalation field was dropped before it reached the write core. Test data deleted afterwards.

**⚠️ The trap: a migration on `main` can be silently skipped.** Drizzle applies a journal entry only if
its `when` is greater than the newest `created_at` already in `drizzle.__drizzle_migrations`. This dev
database has been migrated from **`feature/spec-driven`**, which owns `0025_design_spec_version` and
`0026_pipeline_job` — neither of which exists on `main`. So the DB's newest applied `when` was
1783400000000 while my hand-authored 0025 used 1783300000000 (already taken), and `migrate()` skipped it
**while still logging "database schema is up to date"**. The columns simply weren't there. Renamed to
`0027_guest_authoring` with `when: 1783500000000` and it applied. Lesson for the next hand-written
migration: **check `select max(created_at) from drizzle.__drizzle_migrations` first**, not just the local
journal — the shared DB may be ahead of your branch. Whoever merges these branches reconciles the journal.

**Two findings from watching it run:**

1. *The design-system assistant was rendering on the public share pages.* `ChatFab`/`ChatDrawer` are
   mounted globally in `providers.tsx`, so `/s/*` got them — an authenticated feature on an
   unauthenticated page, inviting a guest to ask a chat whose API will reject them, and contradicting the
   viewer's own "standalone by design" docstring. Now suppressed for `/s/*` (base-path safe via
   `usePathname`). Fixes the read-only viewer too.
2. *Field order comes from Postgres, not from the template.* `jsonb` does not preserve key order (it sorts
   by key length, then bytewise), so the guest saw Eyebrow → Body → Headline rather than headline first.
   Harmless but wrong-feeling, and it can't be fixed by ordering the insert — it needs an explicit field
   order from the template or the descriptor layer. Noted in the design doc as a Slice 3 item.

Also worth confirming with fresh eyes: `/api/handoff/assets/<id>/raw` serves bytes to an unauthenticated
caller (that is what makes the guest picker's thumbnails work). Pre-existing, not introduced here, but a
guest link now depends on it — so it should be a deliberate decision rather than an accident.

---

## 2026-08-05 — Guest asset read + authoring UI: the shallow-merge trap, from a new direction

Slice 1 is now code-complete: `/api/handoff/guest/assets` (capability-gated, read-only, `summarizeAssetRow`
subset, active-only, hard 60 cap) and the `/s/[token]` authoring surface, which the share page renders
**when the link is write-capable** — a view-only link on the same route behaves exactly as before.

**The design decision worth keeping:** guest edits are stored in the **override layer**
(`data.previews.default.values[i]`), never in `components[i].args`. The template stays pristine and the
review diff *is* the values array.

**The trap that nearly repeated itself.** `mergeBlockArgs` is a *shallow* merge, so writing a partial
`{ desktopImageSlot: { props: { src } } }` into the override would replace the template's whole element
node — losing `type`, `width`, `className` — and the block would stop rendering. That is the 2026-07-31
element-shape bug reached from the opposite side. Fixed in `applyOverride`: apply the edit to the *merged*
args, then write the affected **top-level key whole**, so the override is always a set of complete
top-level values (the only shape a shallow merge carries safely). Five tests on it.

Fields come from **real values** (`collectEditableText` / `collectImageSrcs`), not descriptors — same
lesson as `summarizeFields`. Structural strings (`className`, `type`, `href`, `width`…) are excluded so a
guest can't silently break a block; a `picture` with several `source` children counts as one slot,
because offering three pickers for one visual image lets someone change two and see nothing happen; and
picking an image carries the asset's alt into a sibling `alt`, since a swapped image with the old alt
describes the wrong picture.

754 unit + 9 server tests, `tsc` clean. **Not yet exercised in a browser** — that needs migration 0025
applied plus a template and a write-capable link, i.e. DB writes. Stated rather than implied.

---

## 2026-08-05 — Guest sessions: one link, many recipients, one page each

Brad's question — does one link sent to two people make two copies? **Yes, and that's the design.** The
link grants against the *template*; each session's first edit creates a child carrying `template_id` and
`share_link_token`, and `canGuestEditPattern`'s token check is what keeps two recipients out of each
other's work. Both land in the review queue separately.

The honest caveat, now written into the note: **identity is a browser, not a person.** Same person on two
devices = two drafts; two people in one browser profile = one; cleared cookies = an orphaned draft. That
is inherent to authoring without accounts, and it is why the queue shows a self-declared name plus the
admitting link rather than an identity. Consequence for `maxUses`: it caps *sessions*, not people — and a
reload must not spend one, so the entry route resumes **before** it consumes.

Session = signed cookie (`handoff_guest_<linkId>`, HMAC over `AUTH_SECRET`), one per link so two links in
one browser are independent. Three deliberate omissions from the payload: **capabilities** (re-read from
the link row every request, so revoking a link ends its sessions on the next call rather than whenever
the cookie lapses), **the link secret** (already presented at the door; re-storing it only adds a place
to read it), and any **expiry beyond the link's own** (`maxExp` clamps it). Missing `AUTH_SECRET` throws
rather than signing with a default, which would make every cookie forgeable.

**Two things caught while building, both worth remembering:**

1. *The submission id comes from the signed cookie, never the request body.* A body-supplied id would let
   any link holder name any pattern and lean on `share_link_token` to catch it — safe only because two
   independent things both had to be right. From the cookie, one does.
2. *Submitting was a dead end.* The cookie kept pointing at the submitted page, which is locked
   (`canGuestEditPattern` requires `draft`), so the guest could neither edit it nor start anything new.
   POST now falls through on a non-draft submission and creates a fresh page, repointing the cookie; the
   submitted one is untouched.

Also: my first read of `cat -v` output made me think the control-character strip in `sanitizeGuestName`
had become a negated class. It hadn't — `^@-^_^?` is caret notation for `\x00-\x1f\x7f`. The literal
control bytes are now `\u` escapes so the next person doesn't lose the same minute.

730 unit + 9 server tests pass, `tsc` clean. Remaining in Slice 1: capability-gated asset read for
guests, and the `/s/[token]` authoring UI.

---

## 2026-08-05 — Guest authoring, Slice 1 backend: a guest is a capability holder, not a user

Design note: `docs/GUEST-AUTHORING.md`. SS&C want a template link a non-account holder can build a page
from, which lands in a review queue. **Decided: no guest image generation** — asset library only. It is
enforced by *absence* (there is no `generate_image` capability to grant) rather than by a budget that has
to be enforced correctly, and a test pins it so adding one is a deliberate change.

**The bug this design is shaped around.** `canMutatePattern` grants access when `ownerUserId == null`,
because legacy/unowned patterns are team-editable — and a guest's `userId` is *also* null. A guest actor
passed to the existing write core would therefore have been handed every unowned pattern in the
deployment, and each call site would still have read as correct. `writePattern` is worse: it has no
authorization check at all. So:

- `MutateActor.guest` — its **presence** closes every ownership path. `canMutatePattern` returns false
  before looking at role or owner; `computePermissions` returns early with view-from-capability and
  nothing else, so `team`/`public` visibility and a stray grant row can't leak edit rights.
- Guest writes get their own three functions (`createGuestSubmission`, `patchGuestSubmission`,
  `submitGuestSubmission`) rather than a flag. The patch builds its UPDATE field by field instead of
  spreading, because a spread would carry `status`/`userId`/`visibility` from the HTTP layer into the
  very escalation the function exists to prevent.
- A guest's claim on a page is `handoff_pattern.share_link_token`, not ownership: submissions are owned
  by the **link's creator** so they land in a real library and never leave a null-owner row behind.

**Tokens changed shape for write-capable links.** URL is now `/s/<id>.<secret>`: `id` stays the primary
key (one indexed lookup, safe to log), only `sha256(secret)` is stored. A DB read no longer yields usable
links. Legacy read-only rows have `token_hash = null` and are compared directly, so existing viewer URLs
keep working — and a bare id can never satisfy a hashed row, which is what stops a logged id from being a
credential. Consequence worth knowing: **`GET /api/handoff/share` cannot return a working URL for a
write link** — the secret is gone. It returns `secretRecoverable: false` and the UI's move is
revoke-and-remint. Write links also default to a 14-day expiry rather than erroring when none is given,
so an immortal write link can't be created by forgetting a field.

Empty `capabilities` means `['view']`, because every pre-Slice-1 row has `[]` and those are the viewer's
links.

**Also added a test lane.** `policy.ts` is `server-only`, so the default `tsx --test` runner could never
import it — the entire authorization layer had **zero tests**. New `test:unit:server`
(`--conditions=react-server`, `test/server/*.test.ts`, wired into `test:unit`) exists so security-
critical server-only code has somewhere to be tested; the guest-denial guards are pinned there. The pure
guest predicates live in the client-safe `lib/authz/guest.ts` so the authoring UI renders from the same
rules it is enforced by (an Edit button on a submitted page is a lie).

714 unit + 9 server tests pass, app `tsc` clean. **Migration 0025 is NOT applied** — auto-migrate will
run it on next boot. Preconditions checked read-only against the dev DB first: `handoff_pattern.id` is
`text` (so the self-FK type-checks), no column or index name collisions, and 0 existing share links.

**Next:** guest session cookie, guest-scoped HTTP routes, `/s/[token]` authoring UI. Two open questions
in the note gate the UI — how a returning guest resumes their draft, and what `shared` visibility means
at promote time.

---

## 2026-08-05 — Both playground generators "hung" in the SS&C demo; the env was the bug, the silence was ours

**Root cause, verified live, not inferred.** `GET https://ssc-handoff.vercel.app/api/handoff/ai/design-jobs/run`
returns `503 {"error":"CRON_SECRET is not configured on the server"}`. That route is the **only** consumer
of `pending` generation jobs (`getPendingDesignGenerationJobs` has exactly one caller), and both
generators are enqueue-only — the chat's `request_image` tool and the block editor's per-field Generate
both just insert a row. So on that deployment nothing ever drained the queue, and the reaper that would
have marked the rows failed lives *inside the same dead route*, so nothing reached a terminal state
either. `DESIGN_SYSTEM_ROADMAP.md:173` had already written this down as a deploy requirement.

Brad is setting the env var. Two further gates to confirm on that project, because the secret alone
isn't sufficient: **Vercel Cron only runs on production deployments** (a branch/preview deploy ignores
`vercel.json` crons entirely, secret or not), and `* * * * *` needs a plan with minute-level crons.

**The part that was ours:** `pollGenerationJob` waits **15 minutes** before saying anything, so a dead
queue is indistinguishable from slow generation for a quarter of an hour — in front of a client it reads
as "the product hangs". Shipped `lib/server/generation-queue-health.ts`: the job-status route now returns
a `queue` block and the poller gives up immediately with the reason. Two verdicts, deliberately kept
apart:

- **`CRON_SECRET` unset** → stalled at once, no age threshold. The drain provably cannot run, so waiting
  three minutes to say so would be three minutes of lying.
- **Old `pending` job with a configured drain** → ambiguous on its own, because the drain takes ≤3 jobs a
  tick and one image legitimately runs 25s–4min, so a *backlog* looks identical to a dead drain from
  inside a single job. The distinguisher is whether anything else is moving: `runningCount > 0` or a
  terminal transition inside the last 3 minutes means alive-and-busy, not stalled. That's the only reason
  `getGenerationQueueActivity` exists, and it's queried lazily so the common 3s poll stays one read.

`running` is never called stalled even with no secret — `ai/generate-design` advances jobs inline, so a
running row may be progressing without the cron. The health check never mutates the job: a recovered
drain still processes the row.

No DB import in the health module; the activity read is injected, which is what let the branching get 8
unit tests without a Postgres connection. The SQL itself was smoke-checked read-only against the real
schema (both branches), since the tests deliberately don't cover it.

**Also learned:** `npm test` has been failing repo-wide for unrelated reasons — the root config is
`.eslintrc.json` and ESLint 9 won't read it, so `npm run lint` dies before `test:unit` runs. Pre-existing,
flagged separately. Use `npm run test:unit` until it's fixed.

**Next:** `docs/GUEST-AUTHORING.md` — SS&C want template + write-capable share link + guest authoring +
review queue, over MCP too. Almost all of it is already in the schema (`handoff_pattern.status` has
`review`, `handoff_share_link` already covers `resourceType: 'pattern'`, `pattern_change` is the audit
trail); the real gaps are capabilities on the token, a `MutateActor` who isn't a user, guest attribution,
and the fact that **the opaque-origin preview iframe means a11y checks cannot run in the parent frame**.
Slice 0 above was the prerequisite: don't hand a stranger a link to a queue that can fail silently.

---

## 2026-07-31 — Image slots are React elements, and the declared shape lies

**Third bug from one root cause, so writing the cause down properly.** Component preview values are
serialized React element trees. `hero-background.desktopImageSlot` is really:

```
{ key: '…', type: 'img', props: { src: '../../images/content/iframe-bg-img.jpeg', width: 2560, … } }
```

while its field descriptor advertises `editorType: 'image'`, `shape: '{ src, alt }'`. **The descriptor
is wrong for this component** — the src lives at `props.src`. Anything written to a top-level `src` is
invisible to the renderer.

Consequences, all of which reported success:
- `blankValue` spread the element and set a top-level `src`, leaving `props.src` holding the preview's
  `../../images/…` path, which 404s in registry mode. That is why generated pages arrived with **no
  images and not even placeholders** — and the unusable-path cleanup missed it too, because it only
  checked `current.src`.
- `coerceToShape` replaced an element template with the model's bare `{ src, alt }`, producing args the
  component cannot render.
- `swapImageSrc` then found the placeholder at the top-level `src` and replaced it, so the changeset
  said "Applied", the image card ticked green, and the page never changed.

Fixed with `findImageNode` / `setElementImage`: the element stays an element and the src is written
into `props`, first `img` only (a `picture` with several sources is one image). Aspect ratio now comes
from `props.width/height`, so a 64:35 hero gets a 64:35 placeholder. Stale `srcSet` is rewritten with
the new src or the browser serves the old image.

**The model's interface stays `{ src, alt }`.** The adaptation belongs where the real shape is known,
not in the prompt — same principle as the server owning scaffold shapes. Six tests pinned to the actual
hero-background value, because guessing this shape has now cost three debugging sessions.

Prior instances of the same cause, for the pattern: `<p>` wrapped around plain-text slots, and
`buttonSlots` declared `array` while holding a single element (`toArrayItems`). **Never trust
`editorType`/`shape` over the preview value.** `summarizeFields` already derives from real values for
this reason; the image path was the last one still trusting the descriptor.

---

## 2026-07-31 — Generated images are stored as WebP

Measured on a 1536x1024 photographic PNG: **4.13 MB → 0.37 MB, 91% smaller**, and 5.51 MB → 0.49 MB
once base64'd into Postgres. Re-encoding also drops the C2PA provenance blocks and embedded SVG icon
that the image model ships inside every PNG — visible as `jumb`/`c2pa` chunks in the failed blob write
that exposed the ordering bug.

This matters because with no S3 configured, generated bytes go into `handoff_asset_blob` as base64,
which is the exact pattern named as the workbench's performance root cause. A tenfold cut does not
retire the Vercel Blob migration but it makes generation viable in the meantime.

Conversion happens **before** the id, hash, size and dimensions are derived, so all of them describe
what is actually stored — hashing the input and storing the output would make `fileSizeBytes` wrong and
a content-addressed id not address its content. Consequence: a future sharp that encodes differently
gives the same source a new asset id. A duplicate row, not a broken one, and the cheaper side of that
trade.

Guards: never re-encode WebP (a second lossy pass for nothing), keep the original if WebP comes out
larger, keep the original if sharp throws (a generation that cost a minute and real money should not be
lost to an encoder hiccup), and `reencode: false` for callers storing authored artwork — a logo or a
screenshot with text wants lossless.

---

## 2026-07-31 — Adding a column took down the generation queue

**Rule, learned the expensive way: a new column in `schema-pg.ts` breaks every read of that table
until its migration lands, and on Vercel the migration is not guaranteed to land first.** Drizzle
generates `SELECT` with an explicit column list, so one unapplied `ALTER TABLE` turns every query on
that table into `42703 column does not exist`.

The `asset_id` column added for playground image jobs did exactly that on 8x8. Blast radius was not
the playground — it was `getPendingDesignGenerationJobs`, i.e. the **cron drain**, plus the design
workbench's own generation, neither of which had anything to do with the feature. Auto-migrate logged
`connecting (pooler=true)…` and then neither success nor failure, so the process was frozen or killed
mid-connect at cold start; `instrumentation.register()` does await `autoMigrate()`, but that only
helps if the invocation survives.

Fixed by **deleting the column rather than the migration failure**. Nothing consumed `assetId` — both
consumers (chat swap, block-editor field write) use `imageUrl`, which is the asset's storage URL. It
was a migration, an index and a schema change for a field with no reader. The asset still lands in
the library; it is just not cross-referenced from the job row.

Worth keeping in mind for other registries: this code is deployed to Cynosure and SSC too, so a
schema/migration ordering hazard is multi-tenant, not local. If a column is genuinely needed on a
hot-path table, either ship the migration in its own deploy first, or put the value in an existing
jsonb column. `/api/admin/migrate` (bearer `HANDOFF_SYNC_SECRET`) is the manual escape hatch.

**Three other defects from the same first live run**, all in the "generate an image" path:
- Client read the new message index out of a `setMessages` updater and used it synchronously. React
  runs updaters during render, so it always read -1 and **no watcher ever started**.
- The model treated `request_image` as terminal — described the pending image instead of writing the
  src into the block. The prompt actively invited it ("say in your reply which images are being
  generated"). Now stated as non-terminal, plus a one-shot retry when images are queued and no
  `propose_edits`/`propose_page` was called.
- A failed enqueue was invisible: handed to the model, never logged, never shown. Now both.

---

## 2026-07-30 — Playground: targeted edits, and the asset loop (Phase 3)

**The chat could not see the canvas.** `currentBlocks` had been in the client payload since
composition awareness landed, but the route's body type was `{ messages, attachedAssetIds }` and it
never parsed the field. Not a type error — reading a property that is not in the type fails to
compile, *not reading* one the client sends is silent. Every turn summarised an empty canvas, so
`## Already on the canvas` never reached the system prompt and the chat asked "which hero do you
mean?" about a page with one hero. It also made the whole edit path unreachable: `propose_edits` had
no indices to aim at. Parsing now lives in `parseCanvasBlocks` next to the summariser it feeds, with
tests. **Lesson: a client→route field with no shared type is untested wiring.** Both ends of every
such payload deserve a named function.

`attachedAssetIds` is the exact mirror — the route parses it and no client sends it. Left alone
pending a decision on which end is wrong.

**Edit operations** (`lib/edit-operations.ts`, `docs/PLAYGROUND-EDITING.md`): update / replace /
insert / remove instead of re-proposing the page. Every op names the index *and* the component it
expects there, verified server-side and again client-side at apply time; a mismatch is rejected and
reported rather than silently editing the wrong block. Applied descending by index. Partial
application on purpose. Undo restores the pre-apply list. Reorder deliberately out.

**Phase 3 — asset loop** (`docs/PLAYGROUND-ASSETS.md`). The constraint that shaped it: chat route
budget is 120s, cron pickup is up to 60s, an image is 25s–4min. The turn cannot wait, so it does not:
`request_image` enqueues and returns a labelled placeholder *immediately*, the page applies complete
in seconds, and the client polls and swaps images in as they land. Placeholders are the fallback, not
a failure state.

- **`storeImageAsset`** is the piece that did not exist. `openAiImageEdit` returns a base64 data URL;
  `insertAsset` writes a row and never touches bytes; the only re-hosting code was Figma-specific. It
  composes what was already there (content-hash id, sharp thumbnail, S3-or-Postgres, `insertAsset`).
  Takes bytes rather than a source so URL/attachment ingest is the same function later.
- **Queue reused, worker not.** `requestParams.intent: 'asset'` branches the cron drain to
  `runAssetGenerationJob`. The design worker builds foundation sheets and auto-creates a
  `Draft — <date>` artifact, which from a playground turn would be a bug.
- **Reaper added** for generation jobs stuck in `running` — there was none, and with a second
  producer a stranded row is a placeholder that never fills in.
- **Gotchas worth remembering:** the `seenAssetSrcs` guard strips any image src the model did not get
  from a tool, so a generated placeholder has to be registered or the thing we just made gets thrown
  away. And concurrent watchers each read-then-write the whole canvas via `bulkAddComponents`, so two
  images finishing together had the second undo the first — swaps are serialized through a promise
  chain, reading canvas state *inside* the chain.

**Generate in the block editor too** (Brad's idea, same day). Clicking an image field offers a brief
box alongside Select Image. Same queue, same worker, same library — only the entry point differs, and
it is the *simpler* path: the field knows its own identifier, so the result writes straight in with no
placeholder to match, nothing to serialize, nothing to race. It also knows the slot's declared
`rules.dimensions`, so `sizeForDimensions` picks the aspect ratio the block actually wants rather
than the chat's guessed orientation.

Two things pulled into shared modules while wiring it, both because a second copy would have drifted:
`pollGenerationJob` (the wait, the retry semantics, the deadline) and `buildImagePrompt` (the no-text
rule and the house-style clip). The chat had been sending the model's raw prompt with neither —
generated lettering is the image failure most likely to be mistaken for a real word on a marketing
page, and it was missing from the path that generates most of the images.

**Not yet run end-to-end.** No image has actually been generated, stored, or swapped in; migration
`0025` has not executed against a real database. 274 unit tests pass and the build typechecks, which
is not the same thing.

---

## 2026-07-30 — Workspace guidance is writable over MCP (admin-gated)

`handoff_update_brand_voice` (merges a subset of the seven fields) and
`handoff_update_design_guidelines` (replaces `designMd`) shipped to main. Motivation: 8x8's voice
settings were fabricated for the demo and contradict the live site (`docs/8X8-VOICE-OBSERVED.md`), and
correcting them meant a human retyping seven fields into `/design/settings`.

Two decisions worth keeping:

- **Gate mirrors intent, not mechanism.** The settings route gates on `session.user.role !== 'admin'`;
  MCP has no session, so `denyGuidanceWrite()` requires `sync:write` **and** `role === 'admin'`. The
  legacy sync secret and the workspace context both carry role `admin` by construction, so CLI/service
  automation is unaffected; a non-admin device JWT is refused.
- **Both tools echo what they replaced** — per-field before/after for the voice, and a line diff plus
  the previous document for the guidelines. These overwrite guidance every later generation inherits,
  so a silent replace would be unauditable. `diff.before.text` is the restore path.

Merge/diff computation lives in `lib/design-workspace-format.ts` (pure, 12 tests in
`test/design-workspace-guidance.test.ts`); `lib/server/design-workspace.ts` keeps the db wrappers.
`authzActor()` became a function declaration — these tools register above it and would otherwise hit TDZ.

**Not yet verified live:** no MCP client had reconnected at ship time, so the write path has never been
exercised against a real registry. First real use should be the 8x8 voice correction.

Two build gotchas hit on the way, both environmental:

- `next build` cannot run from a `.claude/worktrees/*` worktree — no `node_modules` there, so Turbopack
  fails to infer the workspace root. `tsc` works (it resolves from the parent), which makes the failure
  look like a code error. Build from the primary worktree.
- A local `build:registry` dies prerendering `/foundations/[...slug]` with "DATABASE_URL is required".
  Pre-existing and local-only — compile + TypeScript pass, and Vercel builds fine.

**Corrects the entry below:** main *is* the production branch for all three registries as of today —
this commit produced `Production – 8x8-handoff`, `Production – hagyard-handoff` and
`Production – ssc-handoff` deployments. The claim that 8x8 deploys from `feature/spec-driven` is stale.
The `test:unit` trap in that entry is still live, though: the script still names `test/mcp-payload.test.ts`,
which does not exist, and `tsx --test` exits 0 anyway. A green run is not proof of coverage.

## 2026-07-30 — ⚠️ main and feature/spec-driven have diverged; playground work is on main

Recorded because it is invisible from inside either branch and will bite at merge time.

`origin/main` does **not** contain the spec-first work — no `lib/spec/patch.ts`, `brief-spec.ts`,
`mcp/payload.ts`, `server/design-from-brief.ts`, `server/pipeline-queue.ts`, `server/woff-to-sfnt.ts`.
Main received only the last two commits (nav prune, playground bug fixes), applied onto a tree that
never had the rest. `origin/feature/spec-driven` has **everything**, and is what 8x8 is deployed from —
which is why the MCP payload cap and inline images work live while being absent from main.

`feature/playground-improvement` branches off main, so it inherits that gap. Brad's call
(2026-07-30): keep building the playground chat here and reconcile later. Safe for this work
specifically — it is all new files with no spec-first imports — but **merging this branch to main does
not bring spec-first with it**, and anything built here cannot use spec-first code.

**Second trap, deliberately left in place for now:** `package.json`'s `test:unit` names 8 test files
that do not exist on main, and `tsx --test` exits 0 regardless. A full run reports "114 pass" while a
third of the suite silently does not execute. Do not read a green run on this branch as coverage.

Reconciliation is the real fix: either rebase playground work onto `spec-driven`, or merge `spec-driven`
into main and make main current again.


## 2026-07-28 (later still) — "Transition to Dev": unified handoff + reuse/token/voice spec sections

Rationalized asset extraction and spec generation into **one** operation, exposed as
`handoff_transition_to_dev`, and grew the spec to answer the three questions a developer actually
has. tsc clean (root + `src/app`); 108/108 tests; `build:registry` compiles clean. Uncommitted.

**Why the split was the bug, not just untidy.** Extraction and spec were two pipelines, two
statuses, two pollers, two failure surfaces — and nothing ever asked *"is this design ready for
dev?"*. Symptom, observed on the **local dev DB** (`HANDOFF_APP_URL=http://localhost:3000`, the
`DATABASE_URL` in the repo `.env` — ⚠️ **not** the 8x8 registry; see the correction note below):
`spec_status` is `none` on all 18 artifacts there, i.e. it has never once succeeded *in that
environment*. Diagnosis: the wiring landed 2026-06-10 (`1471a909`) and three artifacts postdate it
with assets `done` and spec `none`, so it never reached its first status write; the only exit before
that point was the `HANDOFF_AI_API_KEY` guard, which used to `return` **silently** — no log, no
status, no error. Which cause fired is now unknowable from the data, and *that* is the real defect.
(Ruled out by inspection: `updateDesignArtifactById` does handle `specStatus` — `queries.ts:621` —
the `as Parameters<…>` casts at the call sites are just noise.)

> ⚠️ **Correction (same day).** Every DB-derived observation in this entry and the one below came
> from the **local dev** Neon DB in the repo `.env`, not from the 8x8 registry
> (`https://8x8-handoff.vercel.app`). The local DB's design workspace happens to hold 8x8-flavoured
> brand content, which is what made the mistake easy to miss. The 8x8 registry — read properly via
> its MCP endpoint — is a **different and much richer** environment: **79 components** in coherent
> groups (11 heroes, incl. a `hero-form` with an embedded public form slot), stack profile
> `bootstrap-handlebars` (Handlebars + Bootstrap 5 + SCSS `var(--color-*)`, **not** React), and a
> brand voice whose rules differ from the local copy (headlines **3–8** words, CTAs **2–5**, and a
> different avoid-list). The local DB has 9 junk components and two *Intralinks* demo patterns —
> none of that is 8x8. **Rule: read a registry through its MCP/REST endpoint. The repo `.env`
> describes localhost only.** Code-level findings in these entries are unaffected — they came from
> reading source, not the DB.

**Unification.**
- `lib/server/dev-handoff.ts` — `runDevHandoff()` sequences extraction → spec with one error
  surface (never throws; forces a terminal `specStatus` if spec generation throws past its own
  catch). `deriveDevHandoffStatus()` collapses the two columns into one
  `{stage, running, progress, label, error, warning}`. **Derived, not a third column** — no
  migration, nothing new to drift. Stages: `not_started → extracting_assets → generating_spec →
  ready | failed`. A `done` spec is `ready` even if extraction failed (spec falls back to the
  original image) — that degradation surfaces as `warning`, not failure.
- `design-asset-schedule.ts` now just schedules `runDevHandoff`, so **every** entry point (HTTP
  route, MCP tools, lifecycle review/approved) is identical by construction.
- `markDevHandoffQueued()` resets both statuses and clears stale errors *synchronously*, so a
  poller can't catch a stale `ready` from the previous run. Wired into the PATCH route and
  `set_design_status` — the latter previously skipped extraction entirely, since extraction only
  claims rows already in `pending`.
- MCP: `handoff_transition_to_dev` (new); `handoff_extract_design_assets` kept as a deprecated
  alias forwarding to it. `handoff_get_design_artifact` and the status poll route both now return
  `devHandoff`, so UI and MCP can't disagree about the stage.
- `maxDuration = 300` on the MCP route (it schedules `after()` work and was inheriting a default).

**Spec grew three sections** (all optional — older specs render fewer sections, nothing breaks):
- **`reuse`** ⭐ — *"what could I build this FROM"*, matched against the full component + pattern
  catalog via a new light `loadReuseCatalog()`. This is the workbench/playground counterweight made
  machine-readable: composition score, per-part component candidates, patterns that already cover
  the layout, and a compose-vs-build-new recommendation. Distinct from
  `implementation.existingComponentMatches`, which answers "which component IS this" with full prop
  mappings but **only fires when component guides were attached up front** — so in practice it was
  usually empty. The prompt is explicitly biased toward composition and forbidden from inventing ids.
- **`tokens`** — every observed colour/type/spacing/radius value matched against the registry's real
  tokens (`design-token-summary.ts`, capped at 60/group), with `exact|close|none` and a coverage
  score. Prompt hard-rule: never invent a token name; an honest "off-system" beats a false match.
  Spacing/radius come from DTCG (`getDtcgTokenStrings(...).dtcg`, parsed — it returns serialized
  formats, not a map) and legitimately come back empty on registries without them.
- **`voice`** — per-string pass/warn/fail against the workspace brand voice, with the banned-phrase
  list checked literally. Closes the loop with the demo's opening beat.
- Also fixed: `designMd` was **hardcoded to `''`** at the spec call site, so the team's design
  guidelines never reached the spec at all.

**View** — `components/Design/DevHandoffPanel.tsx`, demo-grade. Order is the opinion: reuse first
(with links straight into the playground / component pages), then assets on a transparency
checkerboard, then token swatches with off-system values in red, then voice findings. Raw editable
markdown moves behind a disclosure. One `DevHandoffProgress` stage bar replaces the two independent
status banners. Sidebar action is now **"Transition to dev"** and routes through the unified path.
Client-side status derivation mirrors the server (duplicated, not imported — `dev-handoff.ts` is
`server-only`).

**Still open:** none of this is verified against a live run. Spec generation has never succeeded on
the **local dev** DB; its state on the 8x8 registry is **unknown and still to be checked** — that's
pre-flight #1 in `docs/DEMO-8X8-WORKBENCH.md`. `handoff_resource_grant` remains read-only everywhere
(no insert path anywhere in the codebase).

**MCP payload hazard found while reading the real registry:** `handoff_get_component('hero-form')`
returns **513KB** even on the "slimmed" path (the slimming drops `sharedStyles`/validation/Figma
metadata but keeps `css`, `code`, `html`, `sass`, `previews`, `entries`). `rate-card-app` returns
53KB. A demo where Claude calls `get_component` on a real 8x8 block risks blowing the context
window mid-conversation. Needs a hard size cap or a `fields`-style projection before the surface is
safe to lean on. Also noted: `rate-card-app` ships with **0 properties**, so contract coverage
across the 8x8 library is uneven — reuse-match quality will vary by component.

---

## 2026-07-28 (later) — Terminal-state guarantee for design-artifact background jobs (8x8 demo hardening)

Pre-demo hardening pass on the MCP→workbench path (8x8 demo Thu 2026-07-30). Closes the long-open
"hanging build jobs" item (`_control/tasks/2026-07-21-handoff-build-jobs-image-extraction.md`).
tsc clean (root + `src/app`); 108/108 unit tests.

**Root cause (confirmed, not theorized).** `claimDesignArtifactForExtraction` flips the row to
`extracting`, and *only* `finalizeDesignArtifactExtraction` moves it to a terminal state. Both
extraction and spec generation run inside `next/server` `after()` callbacks, which are bounded by
the serverless invocation. If the function dies between claim and finalize — timeout, instance
recycle, deploy — nothing else ever touches the row. Process death is not catchable in-process, so
no amount of `try/catch` inside the extractor can fix it. There was also **no reaper**:
`queries.ts` only ever *read* pending/extracting rows.

This is exactly the risk the `create-server.ts` NOTE flagged and left unverified: *"verify live that
extraction actually runs in-cloud. If after() proves unreliable here, promote this to the design-jobs
cron."* Rather than moving extraction wholesale to the cron (which would add up-to-60s latency to the
demo's happy path), the fix keeps `after()` as the fast path and puts a safety net under it.

**Changes:**
- **Watchdog** (`design-asset-extractor.ts`) — `runDesignAssetExtractionForArtifact` now races
  extraction against a 240s ceiling (mirrors the existing Figma-fetch bound) and finalizes `failed`
  on timeout, so the row goes terminal *before* the invocation is torn down. The race loser can't be
  cancelled; if it later resolves it overwrites `failed` with real results — better data, not
  corruption. Noted inline.
- **Reaper** (`queries.ts` `reapStuckDesignArtifactJobs`) — sweeps rows whose `updated_at` is older
  than 15 min and whose `assets_status ∈ {pending,extracting}` or `spec_status ∈ {pending,generating}`
  into `failed`, flipping *only* the status that's actually stuck. Wired into the existing
  every-minute `/api/handoff/ai/design-jobs/run` cron (`maxDuration=300`, already `CRON_SECRET`-gated),
  before the drain and inside its own try/catch so a reap failure can't block job processing. No new
  infrastructure. Also cleans up pre-existing stranded rows, not just new ones.
- **Second stranding path found + fixed** (`design-spec-generator.ts`) — `generateSpecForArtifact`
  returned *silently* when `HANDOFF_AI_API_KEY` was unset, but callers set `specStatus:'pending'`
  **before** scheduling it (`design-artifact/route.ts:252`, `create-server.ts:874`). Result: row spins
  on `pending` forever with no reason surfaced. Now writes `failed` + `metadata.specError`.
- **Latent bug** — `killDesignAssetExtractionJob` wrote its reason to `metadata.assetsError`, but the
  detail page and Builds board read `metadata.assetsExtractionError` (`assetsExtractionErrorFromMetadata`).
  Admin-killed jobs showed as failed with no explanation. Now writes the key the UI actually reads.
- **`maxDuration = 300`** declared on `api/handoff/ai/design-artifact` and `api/mcp` — both schedule
  `after()` work and were inheriting a default that could strand a job mid-flight. MCP-initiated jobs
  now get the same budget UI-initiated ones do.

**Live DB observations** (read-only scan, the Neon DB in local `.env` — 18 artifacts, 2 patterns):
- **0 currently-stranded rows.** The hang is intermittent, not chronic — lower standing risk than the
  backlog item implied, but unbounded when it does happen, which is what the above fixes.
- 4 failed extractions, all from **June** (06-03, 06-23); 3 recorded no error at all. Extraction has
  been healthy since. The one recorded reason: *"All extracted assets failed vision validation."*
- ⚠️ **`spec_status = 'none'` on all 18 rows** — spec generation has never completed on this DB. Means
  `handoff_get_component_spec` returns nothing for every existing artifact. Needs a live check before
  the demo if the spec path is on the script.

**Demo-visibility data pass** — new `scripts/set-demo-visibility.ts` (dry-run by default,
`--apply` to write, `--visibility=team|public`, `--owner=`, `--include-patterns`). Deliberately **not**
a migration: migrations auto-run on boot for *every* registry deployment, and flipping visibility is a
per-tenant data decision — baking it into 0025 would silently expose private rows on SSC and every
other tenant. Dry run against the local-`.env` DB reports 17 artifacts + 2 patterns would move
`private → team`. **Not applied — awaiting confirmation of which DB that is.**

**Worth knowing:** admins bypass the whole problem — `designArtifactLaneClause` returns every row for
`isAdmin` (`grant-queries.ts:142`). The empty Team/Public lanes only bite on a non-admin account, so
the data pass matters only if the demo runs as a normal user.

---

## 2026-07-28 — Workbench/Playground: perf hardening + multiuser (Phase A/B) + unified Library lander

Big arc across the workbench (`/design` → design artifacts) and playground (`/playground` → patterns).
Full spec + per-phase status: **`docs/WORKBENCH-PLAYGROUND-ROADMAP.md`**. Phase B UX approved via an
interactive mockup (artifact: `claude.ai/code/artifact/9db33798-b2b7-4546-b5dc-baecb64ffd5b`).
**Frontend UX refinement now owned by Natko.**

**Part 1 — performance (root cause: base64 images stored inline in Postgres JSONB, then `SELECT *`).**
- Phase 0: perf indexes (`0023_perf_indexes.sql`), light list/status projections for design artifacts,
  single-row `getPattern` (was full-scan+`.find()`), pooler-safe `getDb()` (`prepare:false`+timeouts),
  playground `bulkAddComponents` parallelized. Verified on 8x8 — resolved the slowness.
- Phase 1: images → **Vercel Blob** (`lib/storage/artifact-images.ts`, `offloadArtifactImages` wired into
  all 4 artifact write fns; graceful passthrough when `BLOB_READ_WRITE_TOKEN` unset). Admin resumable
  backfill route `POST /api/handoff/admin/backfill-artifact-blobs`. Blob store must be created +
  `vercel env pull` per deployment (done on 8x8).

  > ⚠️ **CORRECTION (2026-07-29).** This entry originally read "Serving = **public unguessable URLs**
  > (not private/proxy)". **That is wrong.** The decision was **private stores**, and 8x8's store is
  > configured private. `offloadDataUrl` hardcodes `put(..., { access: 'public' })`, so every offload
  > on 8x8 fails with *"Cannot use public access on a private store"* — and because the catch
  > swallows it and returns the inline data URL, **no artifact image has ever reached Blob there.**
  > That is the source of the 3.2MB-per-field rows (imageUrl + a duplicate inside
  > conversationHistory = ~6.4MB), the ~90s of row I/O inside the handoff invocation, and the
  > oversized MCP payloads. Fixing it is not a one-liner: private blobs need
  > `get(pathname, { access: 'private' })` server-side, so the stored reference is no longer a
  > browser-usable URL and every consumer changes —
  > the workbench, the detail page, share pages, `imageUrlToVisionPart`, `imageUrlToEditInput`.
  > Scoped but not yet sequenced.
- Phase 2: cursor pagination on Library list; bounded sync feed (`fetchSyncChangesSince` `hasMore`/
  `nextCursor`, `version=hasMore?nextCursor:latest` so clients never skip the tail); driver decision
  **ADR-003** (stay on postgres-js; Fluid Compute keeps the pool warm). 2.5 light component variant +
  2.6 retention/rollup for `sync_event`/`event_log` still open.

**Part 2 — multiuser (tenancy = team within one deployment; per-user ownership + team sharing, NO org).**
- Phase A (authz): `lib/authz/policy.ts` — enforce ownership INSIDE the shared write core
  (`patchPattern`/`removePattern` — owner or admin; null-owner=team-editable) so both UI + MCP paths are
  covered. NOTE: CLI/registry sync-replication writes patterns directly (not via the core), so it's
  unaffected. `role` threaded onto `PatternWriteActor`.
- Phase B (sharing & visibility): migration `0024_phase_b_visibility.sql` (visibility+status cols;
  `handoff_resource_grant` + `handoff_share_link` tables). `computePermissions()` +
  `attachPermissions()`; client-safe vocab in `lib/authz/vocab.ts` (policy re-exports — client imports
  vocab, NOT server-only policy). `lib/db/grant-queries.ts`: lane-filtered SQL lists (`?lane=yours|shared|
  team|public`), bulk grant resolution. Routes stamp per-row `permissions`+`owner`+`isMe`+`visibility`+
  `status`. Setters: `setPatternMeta` + artifact PATCH (`approved` = maintainer-gated). Share links +
  public `share/[token]` route (safe subset — no base64/PII). UI primitives in `components/library/*`
  (Tailwind v4 + shadcn/ui, driven by `permissions`). Both surfaces cut over to lane endpoints (default
  "Yours"). Existing rows defaulted `private`/`draft` (data disposable), so "Team" lane looks sparse until
  visibility is set — expected, not a bug.

**Unified Library lander (`/library`) + full-bleed consistency pass.**
- New route `app/library/` = the **home of the Tools nav** (`MainNav` "Tools" → `/library`; Library first
  in the sub-nav; `/library` in all 3 `TOOLS_PATHS`). Unified grid over designs+patterns
  (`components/library/AssetCard.tsx`): type facet, lane tabs, search, launches into both builders.
- Full-bleed builder shell (sidebar facets + scrolling grid) applied to `/library` AND the saved-design
  detail page (`design/library/[id]/SavedDesignDetailClient.tsx`) so the whole Tools section is consistent.

**Tail CLOSED this session (backend + the two contained UI bits):** ✅ true artifact clone
(`POST /api/handoff/ai/design-artifact/[id]/clone` — design "Duplicate" now makes an owned copy, not
open-in-workbench); ✅ cross-type "Load more" pagination on `/library` (per-type cursors, `// TODO`
removed); ✅ public share-viewer page `app/s/[token]` (safe subset, `noindex`; share URLs now point here,
not the JSON endpoint); ✅ one-pass visibility+publicAccess PATCH (was 2 calls); ✅ "fetch existing share
link" `GET /api/handoff/share?resourceType&resourceId` (inspector shows a prior link on open). Also fixed a
latent bug: `insertDesignArtifact` was dropping `visibility`/`componentSpec`/`specStatus` in its insert.

**Left for Natko / next (deliberately not done):** folders/collections + tags + bulk actions (net-new
feature — new taxonomy data model + bulk-select UI, wants its own design pass); rest of Phase C — C.1
create/rename/draft-vs-published lifecycle, C.3 concurrency safety (optimistic-lock + conflict UI), C.4
attribution/activity feed; Phase D outbound export (Jira/Asana/CMS/Figma); Part 3 CLI installer (deferred,
low on backlog). ⚠️ If an MCP visibility/status setter is added, put the `approved` gate in the shared write
core (today it lives in the `setPatternMeta` server action).

---

## 2026-07-23 — Idempotent fonts mkdir + diagnosis of `public/api` EEXIST build race

**Reported bug (from ssc-handoff).** `handoff-app build:app` exits 1 during doc
assembly with `EEXIST: mkdir '.../.handoff/<id>/public/api'`.

**Diagnosis.** All `public/api` dir creations in the current source *and* the
published `1.2.2-7` dist already use `fs.mkdirSync(..., { recursive: true })` /
`fs-extra.ensureDir` — recursive does not throw EEXIST on an existing leaf, so a
missing flag is **not** the cause. Reproduced in ssc-handoff: the EEXIST (and
sibling `ENOENT chmod` / `ENOENT copyfile` variants) only occurred while a
`handoff-app start` dev server was running concurrently against the **same**
`node_modules/handoff-app/.handoff/<projectId>/` working dir. The build's
`syncPublicFiles` → `mirrorDirectory` (`fs.remove` + `ensureDir` + `copy`) races
the dev server regenerating `public/api` → TOCTOU inside fs-extra. Stopping the dev
server and cleaning `.handoff` → `npm run build` exits **0** deterministically.

**Fix applied.** Hardened the one genuine non-idempotent mkdir in the build:app
path: `src/pipeline/styles.ts` `buildCustomFonts` used a TOCTOU
`if (!existsSync) mkdirSync(fontsFolder)` (non-recursive, inside a `Promise.all`
over font families — can EEXIST on parallel families or a re-invoked build, and
ENOENT if the parent is missing). Replaced with
`fs.mkdirSync(fontsFolder, { recursive: true })`. Compiles clean (`npm run build`).

**Follow-up worth considering.** build:app and a running `start` dev server share
one `.handoff/<projectId>` working dir; concurrent use will keep racing on
`public/api` regardless of per-call mkdir flags. Isolating the working dir per
process (or serializing) would remove the class of error.

## 2026-07-21 — Neon compute reduction: cache the registry read hot-path + fix idle polling

**Problem.** 8x8-handoff burned ~119 CU-hrs since Jul 1 on developer-only traffic.
119.37 CU-hrs / ~20 days ≈ **0.24 CU sustained 24/7** — i.e. the compute endpoint
was essentially never auto-suspending. Root cause was two-fold: (1) every registry
request re-ran the root layout, which fired ~5–8 **uncached** Postgres reads
(registry config, nav tree, component summaries, user count) + per-page content
reads; and (2) a forgotten-open `/admin/builds` tab polled every 12s forever,
pinning compute awake. React `cache()` only dedupes within one render — there was
no cross-request caching.

**Key insight.** The CU cost is DB *query volume*, not Vercel render mode. Wrapping
the hot-path reads in Next's Data Cache means cache hits do **zero** Postgres work
regardless of request volume → Neon can idle between real content changes. No risky
layout/auth refactor needed (that would only help Vercel function compute, not Neon).

**Changes (B/C/D):**
- **C — cache the read hot-path.** New `src/app/lib/server/registry-cache.ts`:
  `unstable_cache` wrappers (tags + 300s TTL floor) for registry config, navigation,
  component summaries, user count (3600s), and per-slug page content. Wired into
  `runtime-config.ts` (config), `dynamic-provider.ts` (nav + summaries — Data Cache
  layered *under* the existing React `cache`), `app/layout.tsx` (user count), and the
  public catch-all routes `app/[...slug]` + `app/foundations/[...slug]` (page body +
  generateMetadata). **Freshness** via `revalidateTag(..., 'max')` on every write
  path: `/api/registry/config`, `/api/registry/navigation`, `/api/registry/pages`,
  `/api/sync/upload` (component/page changes), and `setup/actions.ts` (user create).
  The 300s TTL is a safety net if a write path is missed.
- **D** is folded into C — the per-slug page cache is the real "ISR" win. Note: the
  root layout reads cookies (`auth()`) + `headers()`, so pages stay dynamically
  rendered; route-level `revalidate` can't make them static HTML. That's a
  Vercel-compute optimization, **not** a Neon one, so deliberately deferred.
- **B — stop idle polling.** `admin/builds/BuildsClient.tsx`: poll 4s while a job is
  active, 15s when idle but **stop after ~5 min** of no activity, and **pause when the
  tab is hidden** (resume + refresh on `visibilitychange`). Kills the forgotten-tab
  keep-awake.

**Gotchas.**
- Next 16.2.4 `revalidateTag(tag, profile)` now *requires* the 2nd arg — use `'max'`.
  `unstable_cache` (not `"use cache"`) is correct here since `cacheComponents`/
  `dynamicIO` is off in `next.config.mjs`.
- `getCachedPageBySlug` guards on `usePostgres()` and falls back to the raw read in
  workspace mode, so the no-DB filesystem path stays byte-identical.
- Cached wrappers must never read `headers()`/`cookies()` (they don't — DB only).
- Mutation/admin routes still call the raw `registry-queries` fns so they see fresh data.

tsc clean on all changed files (2 remaining errors are pre-existing in `lib/mcp/`).
**Not yet verified against a live DB** — needs a run pointed at a dev/8x8 database to
confirm cache hits + tag invalidation on push. Data to watch afterward: Neon activity
graph should go spiky (idle between pushes) instead of flat; enable `pg_stat_statements`
to confirm the config/nav/summaries reads drop off the top-`calls` list.

**Follow-up spun off:** build jobs (esp. workbench image/asset extraction) get stuck
non-terminal → `_control/tasks/2026-07-21-handoff-build-jobs-image-extraction.md`.

---

## 2026-07-16 — figma-plugin API: CORS fix + contract alignment to the plugin spec

Reviewed `handoff-figma-plugin/docs/p1.6-figma-plugin-api-spec.md` (the plugin is built against it).
Two classes of fix — the CORS blocker, plus the route shapes (the plugin expects shapes that
differ from what P1.6c first shipped). tsc clean; 108/108 tests; verified over HTTP against
`next dev` (spec §6 checklist a/b/c all pass).

**CORS (spec §1–2) — `src/app/proxy.ts` + `next.config.mjs`:**
- The plugin UI runs in a sandboxed iframe (`Origin: null` desktop / `figma.com` web) — all calls
  cross-origin; a missing CORS header shows as an opaque `Failed to fetch`. Added a `/api/figma-plugin/*`
  branch in `proxy.ts` that answers `OPTIONS` preflight with `204` + CORS **before any auth**, and
  stamps CORS (`Allow-Origin: *`, `Allow-Methods: GET,POST,DELETE,OPTIONS`, `Allow-Headers:
  Authorization, Content-Type`, `Max-Age: 86400`) on `next()` so it merges onto every route
  response **including errors** (401/410/500). No `Allow-Credentials` (Bearer-only, wildcard-safe).
- **Trailing slash:** the app runs `trailingSlash: true`, which 308-redirected the plugin's no-slash
  POSTs (a cross-origin 308 re-triggers preflight and drops the body). Next fires that redirect
  **before** middleware, so proxy.ts can't intercept it, and Next has no per-path trailingSlash →
  set **`skipTrailingSlashRedirect: true`** app-wide. Pages/routes now serve both `/foo` and `/foo/`
  without redirecting (canonical link generation via `trailingSlash: true` is unchanged). Verified
  pages still 200 at both forms.

**Contract alignment (spec §4) — the routes now match what the plugin sends/expects:**
- `auth/device` → **camelCase** `DeviceCodeResponse { deviceCode, userCode, verificationUrl, expiresIn, interval }`.
- `auth/token` → body `{ deviceCode }`; **poll-status** `TokenPollResponse`: `{status:"pending"}` |
  `{status:"approved", token, scopes[], user}`; **`410`** on expiry. (Extended `exchangeCliDeviceCode`
  to also return `scopes` + `user` — additive, `/api/oauth/token` unaffected.)
- `auth/revoke` → **`DELETE` → `204`** (was POST). Stateless JWT, best-effort.
- `foundations/preview` → response is now `{ changeset: Dtcg.DtcgChangeset, diagnostics }` (the full
  changeset incl. `next` with syncState + axes; dropped the separate source/axes/mappingUsed fields).
- `foundations/commit` → **body is now `{ snapshot, mapping }`** (same as preview, not `{ source }`).
  Curation is expressed entirely through `mapping`; the server **recomputes** the source
  deterministically (`buildDtcgSourceFromFigmaSnapshot`) rather than trusting a client tree, then
  persists + diffs. Response `{ ok, committedAt, committed:{added,modified,removed} }`.

Note for the plugin team: this supersedes the P1.6c contract shapes in the entry below — the shapes
above are current. Device/token need a live DB to exercise end-to-end (device-session storage); CORS,
no-redirect, error-CORS, preview shape, and revoke were all driven over HTTP here.

---

## 2026-07-16 — P1.6a–d built (storage · resolve/serve · figma-plugin routes · viz)

All four sub-phases implemented on `feature/mcp-prototype` against `handoff-core@feature/
multi-axis-theming` (linked `file:../handoff-core`). Changes left in the working tree for review
(not committed — Profile A hard rule). tsc clean (0 errors); 108/108 unit tests pass; each
route/query/UI driven end-to-end (details below).

### P1.6a — storage & migration
- **Migration `0022_dtcg_source.sql`** (+ journal `idx 22`): adds two additive columns to
  `handoff_registry_dtcg` — `dtcg_source jsonb` (a `Types.DtcgSource`: reference-preserving tree
  + `axes[]`, leaves keep `{group.path}` aliases unresolved and carry `$extensions.handoff.
  {originalId,syncState}`) and `axis_mapping jsonb` (team-shared `Dtcg.AxisMappingConfig`).
  Both default `'{}'`; **no forced re-ingest** — existing registries keep serving precompiled
  bytes until they re-push with references. Hot `theme.css` path untouched (ADR-001 §2).
- `schema-pg.ts`: `dtcgSource` + `axisMapping` columns. `registry-queries.ts`: `RegistryDtcgPayload`
  gains both (optional); **`upsertRegistryDtcg` is now partial-safe** — only provided columns are
  written, so a token-only push never clobbers `dtcg_source` and a figma commit never clobbers the
  precompiled bytes. New helpers: `getDtcgSource()`, `getAxisMappingConfig()`, `insertDtcgTokenChange()`.
- **`lib/dtcg-axes.ts`** (new) — the axis interpretation layer: `asDtcgSource` (narrows/rejects
  empty `{}`), `schemeValues`/`axisValues`/`getAxis`, `toAxisAwareBrands` (legacy flat brand tree
  reads as scheme `"default"`; scheme-nested `{scheme:tree}` preserved), `resolveSelector`,
  `buildResolvedBrandsCache` (brand×scheme resolved cache).

### P1.6b — resolve + query (REST & MCP)
- **`GET /api/registry/dtcg`**: no params → full payload (back-compat). Any generic axis param
  (`?brand=&scheme=&…`) → `Dtcg.resolveTokens(source, selector)` literal tree; `?format=css|scss|
  map|style-dictionary` → `Dtcg.resolveAndFormat`. Uses the data provider's source (graceful
  `tokens:null` note when a registry has none). Unknown axes ignored; unspecified → axis defaults.
- **Provider**: `DataProvider.getDtcgSource()` added — dynamic reads `dtcg_source`, static reads
  `design-system/dist/dtcg/tokens.source.json` (emitted by handoff-core P1.5), Hybrid inherits.
- **MCP**: `handoff_get_tokens` + `handoff_export_design_md` gain `{ brand?, scheme? }`. The
  response advertises `axes`; a selector attaches resolved `axisTokens` (color/typography/effect).
  `collectFoundationTokens` threads the selector; export_design_md frames the brief on the resolved theme.
- **`dtcg-normalizer.ts`**: opt-in `carryAxisProvenance` stops the first-seen-wins cross-brand
  collapse and stamps `brand`/`scheme` (default off = byte-identical single-axis behavior). New
  `normalizeDtcgMatrix(brand×scheme)` normalizes each cell independently for the viz.

### P1.6c — `/api/figma-plugin/*` (the plugin contract)
Auth: **`verifyHandoffApiAuth(request, { requireScopes: ['figma:sync'] })`** — this is the
HTTP-route scope gate (mcp-auth.ts); `verifySyncAuth` returns no scopes so it can't enforce
`figma:sync`. **`authOrCloudToken` retired on the Figma path.** In registry mode a JWT must carry
`figma:sync` (admin-only via `scopesForRole`) or the legacy secret grants it; workspace mode stays
locally trusted.
- `auth/device` · `auth/token` · `auth/revoke` — map onto `cli-device-oauth` (device → token gains
  `figma:sync` when an admin approves at `/cli/device`). Revoke is best-effort (stateless JWTs).
- `foundations/preview` — body `{ snapshot: FigmaFoundationsSnapshot, mapping?: AxisMappingConfig }`
  (mapping defaults to the saved team config). Runs `buildDtcgSourceFromFigmaSnapshot` →
  `diffDtcgSource(next, stored)`. **No writes.** Returns `{ changeset:{added,modified,removed,
  unchanged}, source (syncState-stamped, references preserved in $valuesByAxis), axes, diagnostics,
  mappingUsed }`.
- `foundations/commit` — body `{ source: DtcgSource, mapping?, message? }`. Persists `dtcg_source` +
  `axis_mapping`, precomputes the resolved `brands` cache, appends `handoff_token_change`. Returns
  `{ ok, counts }`.
- `GET foundations?brand=&scheme=` — resolved slice for pull-to-canvas (later milestone).

**Plugin contract note:** `preview.source` leaves carry `$valuesByAxis` keyed `"scheme=light"` /
`"brand=resolvet;scheme=dark"` with references **unresolved** (`{color.gray.50}`), plus
`$extensions.handoff.{originalId,syncState,tier,scopes}`. The plugin curate UI renders the
changeset (not the source dump) and posts the curated `source` back to `commit`.

### P1.6d — visualization
`ColorsDisplay` gains a **scheme toggle** beside the brand switcher (BRAND × SCHEME). When a source
with a scheme axis exists, the colors page builds a `normalizeDtcgMatrix(buildResolvedBrandsCache
(source))` color matrix and passes it in; switching either axis re-resolves the semantic tokens
(verified: dark flips Surface `#fafafa`→`#121212` / Text inverse; Hagyard flips Primary
`#048bbb`→`#8b0050`, composing independently). No source → the existing single-axis CSS-brands path
is untouched.

### Gotchas / notes
- **`handoff-core` must be a real copy in `node_modules`, not a symlink.** `file:../handoff-core`
  installs a symlink to a sibling *outside* the app repo; Turbopack's root is the app repo and
  refuses to resolve it (runtime value imports of `handoff-core` — new here — fail; type-only
  imports were fine because they erase). Fix: `npm install handoff-core@file:../handoff-core
  **--install-links**` (materializes a real copy). Re-run after editing the core, or switch to the
  git-branch pin. This affects the real `next build` too, not just dev.
- **Verification without a DB:** no local Postgres here, so the migration wasn't applied (it
  auto-runs on boot in any real deploy; SQL is idempotent `ADD COLUMN IF NOT EXISTS`). Substantive
  logic driven via `handoff-core` + the app helpers end-to-end (scratchpad `verify-p16*.ts`), and
  the routes driven over real HTTP against `next dev` in workspace mode (`HANDOFF_SYNC_SECRET` set
  to engage auth): preview 200 with references-preserved changeset, `figma:sync` 401 without token,
  axis GET resolves, colors page brand×scheme toggles confirmed in-browser.

---

## 2026-07-16 — P1.6 of the Figma-sync initiative — working on `feature/mcp-prototype` directly

Downstream of handoff-core P1 (the `Dtcg.*` engine, on `handoff-core@feature/multi-axis-theming`,
pushed). **Decision (Brad):** no sub-branch — do P1.6 directly on `feature/mcp-prototype`, the
active integration branch. (An earlier `feature/multi-axis-theming` branch here was deleted; it
was content-identical to `mcp-prototype`, so nothing was lost.) P1.6 adds the app side:
axis-aware DTCG storage + migration, `originalId`/`syncState` persistence, the `resolveTokens`
resolver on the query/viz path (hybrid — hot `theme.css` stays precompiled), brand×scheme REST/
MCP query params + visualization, and the `/api/figma-plugin/*` routes (with `figma:sync`
enforcement) the plugin consumes.

Full spec + sub-sequencing (P1.6a–d) in
[`docs/p1-6-kickoff-multi-axis-theming.md`](docs/p1-6-kickoff-multi-axis-theming.md); parent
design is RFC-001 in `handoff-figma-plugin`.

**Dependency (settled):** the `^0.2.0` pin is a non-issue — `0.2.0` was a re-release of a
corrupted `0.1.0`, no divergent code. This work lands as a fresh **`0.3.0`**; correctness comes
from testing app + plugin against the branch, not matching the old pin. Use `file:../handoff-core`
for dev; cut `0.3.0` when the engine stabilizes.

**Working agreement:** no commit/push without Brad's approval (Profile A). Same branch name
across handoff-core / handoff-app / handoff-figma-plugin.
