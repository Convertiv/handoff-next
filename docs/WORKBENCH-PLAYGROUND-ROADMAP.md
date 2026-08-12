# Workbench & Playground — Hardening + Multiuser Roadmap

**Status:** Draft (2026-07-23). Owner: Brad.
**Scope:** Make the **design workbench** (`/design` → design artifacts) and the **playground**
(`/playground` → patterns) fast, robust, and genuinely multiuser — create / save / edit / share /
public-private, and eventually ship assets outbound (Jira, Asana, CMS, Figma).

**How to read this:** Part 1 is the *foundation* — perf + architecture hardening, done first because
a bigger Neon instance would only paper over the real waste. Part 2 layers multiuser on top of the
hardened base. Each phase is independently shippable.

**Locked decisions (2026-07-23):**
- **Tenancy = team within one deployment.** One design-system registry per deployment; "multiuser"
  means a *team sharing that system* — per-user ownership of playground/workbench designs plus
  sharing/visibility among teammates. **No new org/tenant entity.** (Model the ownership/visibility
  layer cleanly enough that an org tier *could* be added later, but do not build it now.)
- **Image storage = Vercel Blob.** Move inline base64 out of Postgres into Blob; keep only URLs in the DB.
- **Serving model = public, unguessable URLs** (chosen 2026-07-24). `access:'public'` with a random
  suffix so the blob URL is the capability (like Figma/Slack/Notion image embeds) — knowing an artifact's
  UUID is not enough to reach its images. Chosen over private+proxy for simplicity, CDN speed, and
  testability; the URL only appears in owner-authed API responses. Private+authenticated-proxy remains an
  optional Phase 1.5 hardening if strict confidentiality is later required.

**De-confliction:** the MCP write cycle (Track 6 in [DESIGN_SYSTEM_ROADMAP.md](DESIGN_SYSTEM_ROADMAP.md))
is active in another session, including **6.7 clean asset dispatch → workbench loop**. The two overlap
at (a) the shared write cores `pattern-write.ts` / `doc-pages.ts`, and (b) design-artifact loading.
Rules to avoid collision are called out inline (⚠️ **Track-6 seam**).

---

## Diagnosis (grounded in the code, 2026-07-23)

Three findings, in priority order. The slowness is **not** primarily Neon size.

1. **Base64 images stored inline in Postgres JSONB — the root cause.**
   `handoff_design_artifact` (`schema-pg.ts:141`) stores `imageUrl`, `sourceImages[]`,
   `conversationHistory[]` (a full image *per iteration turn*), and `assets[]` as inline data URLs.
   A multi-turn design is several MB *in a row*. The `POST` path already trips `22001 "value too long"`.

2. **`SELECT *` on those blob tables + list over-fetch.**
   - `getDesignArtifacts` (`queries.ts:624`) selects **full rows** — up to 100 — for the Library grid
     that renders only `{id,title,status,thumbnail,updatedAt}` (`DesignClient.tsx:73`). Massive over-fetch.
   - `getDesignArtifactById` (`queries.ts:572`) `SELECT *`, and `SavedDesignDetailClient` **re-downloads
     the entire multi-MB blob every 4–5s** while polling status (`:210-267`).
   - `getDbPatterns()` (`queries.ts:97`) is `SELECT * FROM handoff_pattern` with no WHERE/LIMIT, and
     `DynamicDataProvider.getPattern(id)` (`dynamic-provider.ts:455`) reads the **whole table** then
     `.find()`s by id in memory. A single-pattern query already exists (`queries.ts:138`) but is unused.

3. **Missing indexes on exactly the hot tables.**
   `handoff_design_artifact` and `handoff_pattern` have **no index beyond the PK** — every list is a
   full scan + in-memory sort on unindexed `updated_at`, dragging blobs along. FK columns `user_id`
   are unindexed on both.

Secondary: **driver/pool config.** Runtime uses `postgres-js` over the Neon **`-pooler`** endpoint but
omits the pooler-safe options (`prepare:false`, `connect_timeout`, `idle_timeout`) that the migration
client already sets (`auto-migrate.ts:99`). Playground has a **serial N+1** (`PlaygroundContext.tsx:150`):
per-component `await fetchDetail` → `await renderPreview`, and `fetchComponentDetail` downloads heavy
compiled fields only to discard them client-side (`:73`).

---

# Part 1 — Foundation hardening (robust + optimized)

## Phase 0 — Quick wins (no data migration; days, not weeks) — ✅ SHIPPED 2026-07-24

Highest impact-per-effort. None of these require moving data or bumping Neon.
Landed (working tree, branch `feature/mcp-prototype`): migration `0023_perf_indexes.sql` + journal
entry (auto-applies on boot); `getDesignArtifactSummaries` / `getDesignArtifactStatus` /
`getDesignArtifactOwnerId` projections in `queries.ts`; list route + `SavedDesignDetailClient` poll +
new `/design-artifact/[id]/status` route rewired to the light paths; `getPattern` single-row fix;
pooler-safe `getDb()` (`prepare:false` + timeouts); playground `bulkAddComponents` parallelized with
in-flight fetch dedup. Full `tsc --noEmit` clean.

- **0.1 Add indexes** (hand-written idempotent SQL migration + journal entry — never `db:generate`):
  - `handoff_design_artifact (user_id)`, `(status)`, `(updated_at DESC)`
  - `handoff_pattern (user_id)`, `(source)`, `(updated_at DESC)`
  - `handoff_component (updated_at)`; `handoff_image_slot (component_id)`
  - `handoff_event_log (category, created_at)`; `handoff_pattern_change (pattern_id)`
- **0.2 Column projections for list/detail-poll paths.**
  - Add a light `getDesignArtifactSummaries()` selecting only `{id,title,description,status,thumbnail,
    updatedAt}` — never the base64 columns — and point the Library list at it (mirror the existing
    `getDbComponentSummaries` / `handoff_asset_blob` split pattern).
  - Add a **status-only** endpoint `{assetsStatus, specStatus}` for the detail-page poll so the 4–5s
    loop stops re-transferring MBs (`getRecentDesignArtifactAssetJobs`, `queries.ts:159`, is the shape).
- **0.3 Kill the pattern full-scan.** Route `DynamicDataProvider.getPattern(id)` through the existing
  single-row `getDbPatternById` (`queries.ts:138`) instead of `getDbPatterns().find()`.
- **0.4 Pooler-safe runtime client.** Align `db/index.ts:53` with `auto-migrate.ts:99` — `prepare:false`
  on `-pooler`, add `connect_timeout`/`idle_timeout`, re-evaluate `max:10` for small Neon.
- **0.5 Parallelize playground load.** `bulkAddComponents` → `Promise.all` over components; add a
  lightweight component-detail API variant so heavy compiled fields aren't shipped-then-discarded.

**Exit:** Library list and saved-design open drop from multi-MB / multi-second to sub-second on the
current Neon size; playground cold-load is one round of parallel fetches, not a serial chain.

## Phase 1 — Get images out of Postgres → Vercel Blob (the root fix) — 🔄 IN PROGRESS 2026-07-24

⚠️ **Track-6 seam:** design artifacts are written by both `/design` and MCP `create_design_artifact` /
6.7 asset dispatch. The write-side switch lives behind ONE helper both paths call (the four write
functions in `queries.ts`), so the seam is a single shared core.

- **1.1 ✅ Blob offload helper** — `src/app/lib/storage/artifact-images.ts`: `offloadArtifactImages()`
  uploads inline `data:` URLs to Blob (`access:'public'`, random suffix) and returns URLs; passthrough
  when `BLOB_READ_WRITE_TOKEN` is unset (local/workspace mode) or on failure — offload never blocks a save.
- **1.2 ✅ Write-path wiring** — `insertDesignArtifact` / `updateDesignArtifact` /
  `updateDesignArtifactById` / `finalizeDesignArtifactExtraction` all offload `imageUrl` /
  `sourceImages[].dataUrl` / `conversationHistory[].imageUrl` / `assets[].imageUrl` before persisting.
  New saves store URLs, not base64. (tsc clean.)
- **1.3 ✅ Backfill** — admin-only resumable batch route `POST /api/handoff/admin/backfill-artifact-blobs`
  (`{limit?,cursor?}` → `{processed,offloaded,skipped,nextCursor,done}`); offloads existing rows' inline
  images via the shared helper, preserving `updatedAt`; loop until `done`. Audit confirmed no write path
  (incl. MCP create + background workers) bypasses the offload. (tsc clean.)
- **1.4 Reads need NO change** — the public blob URL is stored in the same column, so the client renders
  it directly off the CDN. No proxy, no read-path rewrite. (Serving decision above.)

**Env prerequisite:** create a Blob store per deployment and `vercel env pull` so `BLOB_READ_WRITE_TOKEN`
is present. Until then everything runs in graceful-passthrough mode (images stay inline, no breakage).

**Follow-up (not blocking):** re-saving an artifact orphans its previous blobs (random-suffix paths, no
overwrite). Add a cleanup pass (delete blobs no longer referenced by any row) — minor, deferred.

**Exit:** Postgres rows for artifacts shrink ~10–100×; DB transfer no longer scales with image count;
lists/polls are already metadata-only after Phase 0.

## Phase 2 — Robustness & scale headroom — ✅ MOSTLY SHIPPED 2026-07-24 (2.5 + 2.6 remain)

- **2.1 ✅ Pagination** — cursor-based Library list: opaque composite cursor on `(updated_at, id)` (no
  skips/dupes on tied timestamps), `getDesignArtifactSummariesPage` + route `nextCursor` + a "Load more"
  button. Fresh loads and post-save refresh fetch page one.
- **2.2 ✅ Bounded feeds** — `fetchSyncChangesSince` now takes a `limit` (default 500, cap 1000) and
  returns `{ version, changes, hasMore, nextCursor }`. **Correctness pin:** `version = hasMore ? nextCursor
  : latest`, so a client advancing by `version` alone can never skip the undelivered tail. Consumers drain:
  HTTP route passes `limit` + surfaces `hasMore`/`nextCursor`; the one-shot CLI pull got a crash-safe drain
  loop (persists cursor per page); MCP `handoff_sync_pull` documents re-pull-while-`hasMore`. `event_log`
  reads were already bounded/aggregate (no change).
- **2.3 ✅ Driver decision — [ADR-003](ADR-003-postgres-driver.md).** Stay on tuned `postgres-js` (Fluid
  Compute keeps the `globalThis` pool warm; Phase 0 fixed the pooler path; migrations depend on it). Adopt
  `neon-http` (hybrid) only if a benchmark shows cold-start-latency or connection-cap pain — plan in the ADR.
- **2.4 ✅ Resolved (no change needed).** Two findings, both verified-before-touching: (a) the workbench
  server render (`design/page.tsx`) *legitimately* needs full components — `buildComponentRows` reads
  `properties` + preview refs that live only in the jsonb `data`, and thumbnails come from it; switching to
  summaries would break the page. The earlier "should use summaries" premise was wrong for this path.
  (b) List caching **intentionally skipped**: the Library is a mutable per-user feed refetched right after
  every save, so a TTL cache would serve stale data; safe caching needs per-user tag invalidation wired
  into all write paths (incl. the Track-6 MCP seam) for marginal gain now the query is metadata-only +
  indexed. Correct-uncached beats subtly-wrong-cached.
- **2.6 Retention/rollup (follow-up, not started).** Pagination bounds *per-request* cost, not table size.
  `sync_event` is append-only with full push payloads → prune/rollup events older than the slowest active
  client cursor, or snapshot-compact superseded events per entity. `event_log` (category `ai`) → time-based
  retention or a daily-cost rollup table (lower priority; its reads are already bounded).
- **2.5 Light component-artifact variant (deferred from Phase 0).** The playground's
  `fetchComponentDetail` downloads the full component artifact then discards `jsCompiled`/`css`/`js`/
  `entries`/`options`/`sass` client-side. The detail endpoint (`/api/component/[...path]`) serves a
  prebuilt artifact verbatim through a CSP/CORS-hardened choke point, so stripping fields there is not
  low-risk. Follow-up: emit a `[id].light.json` at component-build time (or a `?fields=light` branch
  reading a precomputed light row) and point the playground fetch at it.

---

# Part 2 — Multiuser foundation (team within one deployment)

Today: NextAuth v5 accounts exist (`auth.ts`), but ownership is **inconsistent** and there are real
**authorization gaps**. Design artifacts are owner-scoped + admin-override (good); **patterns and doc
pages are team-wide with no ownership predicate** — `patchPattern`/`removePattern` (`pattern-write.ts:114`)
update/delete purely by `id`, so any path reaching them can edit/delete anyone's work. Sharing is a
single binary `public_access` on design artifacts only. No share tokens, no per-resource ACL.

## Phase A — Ownership & authorization consistency *(must precede any feature work)* — ✅ SHIPPED 2026-07-24

**Scope decisions (2026-07-24):** (1) **Doc pages (`handoff_page`) stay out** — shared/team content,
scope-gated; ownership deferred (see backlog: doc-page changelog created/edited-by tracking is the
adequate near-term step). (2) **Null-owner patterns are team-editable** — enforcement applies only when an
owner is set; every new pattern gets an owner. Existing playground data is disposable, so no backfill.

- **A.1 Ownership model** — `handoff_pattern.user_id` already exists; keep it. No forced non-null backfill
  (null = team-editable). New writes set owner = actor.
- **A.2 ✅ Enforce authz *inside the shared write core*.** `patchPattern`/`removePattern`
  (`pattern-write.ts`) now fetch the owner and call the policy BEFORE mutating — covers the browser
  server-actions path AND the MCP path in one place. The CLI/registry **sync-replication path writes
  patterns directly (not via the core), so it is unaffected** — the scariest collision risk is a non-issue.
- **A.3 ✅ Policy layer** — `src/app/lib/auth/policy.ts`: `canMutatePattern`/`assertCanMutatePattern` +
  `AuthorizationError`; `MutateActor` carries an unused `orgId` seam for a future org tier. Rule: admin
  (incl. service/workspace MCP actors) OR owner; null-owner → team-editable.
- **A.4 ✅ Route audit** — pattern reads (list, `[id]` GET) are intentionally team-wide (Phase B adds
  visibility); the only mutating route is `clone` (creates an *owned* copy — fine). All update/delete flow
  through server actions + MCP `update_page`, now core-enforced. ✅ MCP `patternActor` carries `role`
  (admin/service bypass; non-admin editing another's pattern denied) and `AuthorizationError` maps to a
  clean `{ok:false, error:'Forbidden — …'}` tool result. Confirmed no MCP delete-pattern path exists.

**Exit ✅:** no server action or MCP tool can mutate a pattern the actor doesn't own (unless admin). Full
`tsc` clean. Working tree, uncommitted.

## Phase B — Sharing & visibility — ✅ SHIPPED (backend + UI) 2026-07-24 · polish follow-ups noted in Stage 3

**Approved via interactive mockup** (`docs`/artifact, 2026-07-24). Spec locked to the mockup: three
*independent* axes — ownership (derived; shown via lanes + attribution), lifecycle (semantic color chip),
visibility/access (icon-encoded). Defaults: **private-until-shared**; **5 lifecycle states**
(prototype→draft→review→approved→archived, `approved` maintainer-gated); nouns stay "pattern"/"design".
Permissions object drives all UI affordances (edit vs duplicate). Duplicate = the escape hatch on
not-mine assets. Public link = client-facing, read-only, safe-subset, revocable.

**Build stages (dependency order, each shippable):**
1. ✅ **Data + policy foundation** (2026-07-24) — `visibility`+`status`(lifecycle) on patterns & artifacts
   (`0024_phase_b_visibility.sql`), migrated `public_access`→visibility, `handoff_resource_grant` +
   `handoff_share_link` tables, policy `computePermissions()` (+`canView` unowned fix). Additive/inert.
2. ✅ **Read model + API** (2026-07-24) — `grant-queries.ts`: bulk grant resolution (no N+1), lane-aware
   SQL-filtered lists (`listPatternsByLane`/`listDesignArtifactsByLane`), `attachPermissions`; routes take
   opt-in `?lane=` + return per-asset `permissions` (default no-lane responses UNCHANGED — backward compat);
   `setPatternMeta` + artifact PATCH visibility/status setters (approve=maintainer-gated); share-link
   create/revoke + public `share/[token]` route (safe subset — no base64/PII leak). tsc clean, reviewed.
   ⚠️ Hard view-enforcement deliberately deferred to the Stage 3 cutover; the `setPatternMetaFields` approve
   gate lives in the server action (no MCP visibility/status setter exists yet — add the gate to the core if
   one is introduced).
3. ✅ **UI cutover** (2026-07-24) — shared primitives in `components/library/*` (`LifecycleBadge`,
   `VisibilityBadge`, `OwnerAttribution`, `LaneTabs`, `LifecyclePicker`, `VisibilityPicker`,
   `AssetInspector` — Tailwind v4 + shadcn/ui, driven purely by props/`permissions`). Client-safe vocab
   extracted to `lib/authz/vocab.ts` (policy re-exports). API rows enriched with `owner{id,name,image}` +
   `isMe` (`getUserDisplays`, no N+1) + `visibility`/`status`. Both surfaces cut over to `?lane=` (default
   "Yours"): Workbench Library tab (`DesignClient`) and the Playground `PatternPicker` (flat modal →
   lane/card/inspector browser). View filtering is now LIVE in the UI. tsc clean; verify visually on 8x8.
   **Polish follow-ups — ✅ ALL SHIPPED 2026-07-28:** public share-viewer page `app/s/[token]` (safe
   subset, `noindex`; share URLs point here now); true artifact clone `POST .../design-artifact/[id]/clone`
   (design Duplicate makes an owned copy); one-pass visibility+publicAccess PATCH (was 2 calls); "get
   existing share link" `GET /api/handoff/share?resourceType&resourceId` (inspector shows a prior link on
   open). Also fixed `insertDesignArtifact` dropping `visibility`/`componentSpec`/`specStatus`.

- **B.1 Unified visibility enum** across patterns, design artifacts, and (where relevant) doc pages:
  `private` → `team` (all authenticated users in the deployment) → `public`. Replaces the one-off
  `public_access` boolean; migrate it to the enum.
- **B.2 Share links with tokens** (revocable, optionally expiring) — generalizes the existing
  public-share page (`design/library/[id]/share/`) beyond binary public, and covers patterns too.
- **B.3 Lightweight per-resource grants** (share *with specific teammates*, view vs edit). This is the
  seam an org/role tier would later plug into; keep it minimal now (owner + explicit grants + team + public).
- **B.4 Public read paths** stay a *safe field subset* (the design-artifact `/public` route is the model).
- **B.5 Doc-page changelog tracking (backlog, captured 2026-07-24).** Doc pages (`handoff_page`) stay
  shared/unowned for now (Phase A decision), but should track **who created and edited** each page via a
  changelog — adequate near-term substitute for ownership/permissions. `handoff_page_change` already logs
  `pushed_by` on pushes; extend to cover all edit surfaces + surface created/edited-by in the doc UI.
  Ownership/permissions for docs may follow later if needed.

## Phase C — Workbench & playground multiplayer UX

The usability layer that makes producing assets intuitive.

**🟩 `/library` full-page lander SHIPPED 2026-07-24 (pulled forward — the core of C.2).** New route
`app/library/` (`page.tsx` + `LibraryClient.tsx`) is now the **home of the Tools nav** (`MainNav` "Tools"
→ `/library`; Library added as the first tools sub-nav entry; `/library` added to all three `TOOLS_PATHS`).
Unifies BOTH asset types in one grid: reusable `AssetCard` (`components/library`), a type facet
(All · Designs · Patterns), lane tabs (default "Yours"), search, and two prominent builder launches
("New design" → `/design`, "New pattern" → `/playground`). Fetches both `?lane=` endpoints in parallel,
normalizes → merges by `updatedAt`, and wires the `AssetInspector` (setters/share/duplicate) branched by
type. tsc clean; verify on 8x8. ✅ **Cross-type "Load more" SHIPPED 2026-07-28** (per-type cursors; the
first-50 `// TODO` removed). Remaining C.2: folders/collections, tags, bulk actions (left for Natko).

- **C.1 First-class object lifecycle:** create / save / duplicate / rename / delete, with **draft vs
  published** state, consistent across both surfaces.
- **C.2 Library organization:** ✅ lanes + search + sort + type facet + unified lander + cross-type
  pagination SHIPPED; remaining: folders/collections, tags, bulk actions (for Natko).
- **C.3 Concurrency safety:** at minimum optimistic-lock (version/`updated_at` check) with a clear
  conflict UI; evaluate soft-lock ("X is editing") before any real-time CRDT investment. The write
  cores already emit `edit_history` + `sync_event` per write — lean on that for conflict detection.
- **C.4 Attribution & activity:** show owner/last-editor, recent activity, and per-object history
  (surfacing `edit_history` / `*_change` tables that already exist).

## Phase E — Pages as documents, and templates as the thing you share (Brad, 2026-08-05)

Raised while testing guest authoring. Guest authoring (`docs/GUEST-AUTHORING.md`) built the *back* of this
flow — write-capable links, a review queue — on top of a playground front end that still behaves like a
scratchpad. These three close that gap. **E.2 and E.3 are the substantial ones; E.1 is a gap in what
already exists.**

### E.1 — Surface what Slices 1–2 built (nothing links to it)

Correct observation: the backend exists and **no UI reaches it**. Missing, all small:

- **Nav entry for `/review`**, badged with the pending count. Maintainer-only (the page and every endpoint
  behind it already enforce `canApprove`, so this is discoverability, not a boundary).
- **A share control that can mint a write-capable link.** `POST /api/handoff/share` accepts
  `capabilities`, `label` and `maxUses` today, and nothing calls it with them. Needs: a capability picker
  (default = the `AUTHORING_CAPABILITIES` set), an expiry (defaults to 14 days), optional max-uses, and a
  copy-once affordance — **the secret is unrecoverable after creation**, so the UI must say so and offer
  revoke-and-remint rather than pretending it can show the link again (`GET` returns
  `secretRecoverable: false` precisely so it can).
- **A links list per template** — label, capabilities, uses/max, expiry, revoke.
- Keep guest submissions visible in `/library` under a filter, not only in the review queue.

### E.2 — One save path; templates as the shared object — ✅ DONE 2026-08-05

All four sub-items shipped. Two were later **superseded** rather than completed as written — noted inline
below, because the original text describes a product shape that no longer exists (E.6 replaced "template"
with brief + invite link + built page).

Shipped: `savePageAsTemplate` (a separate, **frozen**, team-visible copy — the page carries on as the
author's own), the freeze guard in `patchPattern`, save-on-first-block + autosave so dynamic mode has no
save button, clone-of-a-template recording `template_id`, and "page" wording.

- **E.2a — ⚠️ SUPERSEDED.** Shipped as "share from the library", then **removed again** — sharing does not
  belong on a browse surface (Brad, 2026-08-05). Sending a page out is one flow, "Invite to build", on the
  page. The library keeps a details sidebar; see **E.7a** for what still has to come out of it.
- **E.2b — ⚠️ SUPERSEDED.** The read-only-template canvas was built, then became unreachable when briefs got
  their own route (`/briefs/{id}`), which is a purpose-built review surface rather than a disabled editor.
  The dead code is gone; `structuralEditing: false` (from E.5) is what survives of it.
- **E.2c — ✅ DONE.** The `FolderOpen` control and `PatternPicker` are gone; `/library` is the only way to
  open a page.
- **E.2d — ✅ DONE 2026-08-05.** `TemplateManager`, `saveAsTemplate`/`loadTemplate`/`deleteTemplate`, the
  `templates` state and the `Template` type are gone, plus a one-time `purgeRetiredLocalTemplates()` sweep of
  the `handoff-playground-template-*` keys. Data loss accepted deliberately: `saveAsTemplate` returned early
  whenever `isDynamicApp`, which has been hardcoded `true` since static export was removed — so only a
  pre-removal build could ever have written one.

### E.3 — `playground/{page}` as a real route, autosaved, no local storage — ✅ DONE (local storage fully gone 2026-08-06)

The current playground keeps working state client-side and reloads "old stuff" on entry. Make a page a
document:

- **Real route** `/playground/{id}` for an existing page; `/playground/new` (or a redirect after creating
  the record) for a fresh one. A page has a URL that can be linked, bookmarked and shared internally.
- **Autosave to the record**, debounced, with a visible saved/saving state — the guest authoring surface
  already does exactly this against `PATCH …/guest/submission` and is the smaller proof of the pattern.
- **Remove the local-storage rehydrate.** "New" must mean a clean canvas; today's behaviour of restoring
  prior work is the single most confusing thing about the surface.
- **Migration care:** anyone with unsaved local state loses it on deploy unless it is drained once into a
  real record on first load. Worth a one-time "we saved your working draft as …" rather than silence.
- This also fixes a real bug class: local-only state cannot be reviewed, shared, or recovered on another
  device, and every feature after this one (review, templates, guest links) assumes a record exists.

**Closed out 2026-08-06 — local storage is gone entirely.** The "migration care" bullet above shipped as a
recovery *offer* ("You have an unsaved canvas from a previous visit (3 blocks)"), which was right for the one
deploy that retired the auto-restore and pointless after it: once a page is a real record that saves itself,
the only thing the offer can surface is a stale copy of work already in the database — and it interrupted every
visit to the new-page canvas to do it (Brad: "annoying and not useful").

Removed: `STORAGE_KEY`, both effects, `recoveredDraft` / `restoreRecoveredDraft` / `discardRecoveredDraft`, and
the bar. The old key is added to `purgeRetiredLocalTemplates` so it is cleared from browsers rather than left
forever. **Worth knowing:** the *write* effect had no `initialPatternId` guard, so every edit to every saved
page was serialising the whole canvas into local storage for nobody to read — that waste is gone too.

Nothing backstops autosave now, and it does not need one: a new canvas mints its record on the first block
(guarded so a burst cannot create two, and the guard **resets on failure** so the next edit retries), a saved
page debounces at 2s, and a failed write shows "Not saved" rather than retrying silently.

### E.5 — Guests use the real editor — ✅ DONE 2026-08-05

> "It's weird to edit the field with no preview. We've already built an editor, we should reuse. Rising tide
> lifts all boats."

Correct, and the bespoke fields-only form in `components/Guest/GuestAuthoring.tsx` should go. A guest should
get **the playground editor** with structural editing removed: no add block, no drag, no delete — edit the
content of the blocks that are there, see the preview, submit.

**The blocker I assumed exists, doesn't.** Both endpoints the editor needs to render a preview —
`/api/components.json` and `/api/component/{id}.json` — are **already unauthenticated** (zero `auth()` calls),
and `constructComponentPreview` builds the preview client-side. So reusing the editor needs **no new public
surface and no new security decision**, which was the thing that made this look expensive.

What actually has to change, all in two files:

- **`PlaygroundContext` needs a persistence adapter.** Today it hardcodes the authenticated path: `useSession`
  status gating, pattern detail from `/api/handoff/patterns/{id}`, writes through the `updatePattern` server
  action. A guest needs the same lifecycle against `GET/PATCH /api/handoff/guest/submission?link=…`. One
  injected `{ hydrate, persist }` pair, chosen by the surface, rather than two editors.
- **A `structuralEditing: false` mode** in `PlaygroundBuilder`: hide add/drag/delete affordances and the block
  library, keep the block editor panel and the preview. This is also what the frozen-template view should use
  (it currently just shows a banner over a fully-interactive canvas).
- **Guardrails come along for free** — the Slice 3 engine is already client-safe and takes
  `(blocks, overrides, config)`, so the same per-field limits, counters and blocked submit work in the reused
  editor without change.

**Shipped exactly this.** `GuestEditor` injects the adapter; `GuestAuthoring` kept its shell and lost 373
lines. Two follow-ons worth knowing: the same `structuralEditing: false` mode fixed the frozen-template view
(previously a banner over an interactive canvas), and per-field guardrail *hinting* regressed to
server-enforcement-only until the shared block editor learns about guardrails — folded into E.4.

**Why it is worth doing beyond the guest flow:** the same "no structural editing" mode is what makes a frozen
template view honest, and every future improvement to the block editor reaches guests automatically.

### E.6 — Invite to Build (briefs, built pages, publication record)

**Spec: [INVITE-TO-BUILD.md](INVITE-TO-BUILD.md)** (2026-08-05, decisions locked). Supersedes the "template"
product vocabulary; **absorbs E.4** (guardrails move into the invite wizard).

Page → **Build brief** (frozen, versioned) → **invite links** (many per brief, resharable) → **Built pages**
(standalone — no merge back). Four product nouns; storage keeps saying `template`.

Three decisions worth reading even if you skip the spec:

- **"Published" is not a lifecycle state** — it is a `handoff_publication` record (destination, external URL,
  status). One enum value cannot express "pushed to WordPress, failed on HubSpot, later reverted", and the
  plugin roadmap guarantees more than one destination. The chip is derived. This is the Phase D seam.
- **Invitations are not a visibility level.** `public` already means "anyone with the link, read-only"; if
  invites live in that dropdown, "Public" reads as "this is how outsiders build", which is wrong and unsafe.
- **`removePattern` becomes an archive.** It hard-deletes today, reachable from `PatternBrowserClient`.
  Archiving a page hides its briefs and built pages without destroying the record of what outsiders were sent.

Sequencing: brief+versioning ✅ → wizard ✅ → brief/built-page viewers ✅ (approve/reject moved in) → guest
chrome ✅ → **soft delete ✅ 2026-08-06** → notifications (the only step left; off the critical path, and
`lib/email.ts` on Resend already exists).

**Soft delete, as built.** `removePattern` now sets `status: 'archived'` instead of `DELETE`, and **cascades**
to the page's briefs (`source_page_id`) and, through them, the pages built from them (`template_id`). Four read
paths gained a `status <> 'archived'` predicate — `getDbPatterns`, `getDbPatternsFiltered`,
`listPatternsByLane`, `listBriefsForPage` — while **`getDbPatternById` stays unfiltered on purpose**, so a URL
someone already holds still resolves and archiving is recoverable rather than a slower delete. The review queue
needed no change: it selects `status = 'review'`, so cascaded submissions drop out on their own.

Two things worth knowing about it:
- **New builds against an archived brief are refused** in `createGuestSubmission`, not just in the route. The
  invite token is still valid and the row is still there, so without that check an outsider could start a fresh
  page against something the team believes it removed. Existing drafts need no check — the cascade moves them
  off `draft`, which `canGuestEditPattern` already requires.
- **Un-archiving would have to un-cascade deliberately.** There is no un-archive path yet; cascading at write
  time is what keeps the read side to a single predicate, and the code says so where it matters.

### E.7 — Page-owned visibility & lifecycle, and a copy link for `public` — ✅ DONE 2026-08-06

Two corrections from QA. Both follow from a rule already in
[INVITE-TO-BUILD.md](INVITE-TO-BUILD.md#lifecycle-and-visibility-two-dropdowns-and-one-thing-that-is-neither):
**a page's visibility and lifecycle belong to the page**, not to a browse surface.

- **E.7a — ✅ Meta lives on each object's own view.** One shared `components/library/MetaControl.tsx`, used by
  the page editor (`resourceType: 'pattern'`) and the saved-design detail page (`'design_artifact'`); both
  pickers and the review nudge are gone from `AssetInspector`, which keeps the badges as the browse-time read.
  - **The "stranded artifacts" worry was unfounded, for a worse reason:** artifacts' library controls had
    *never worked*. They PATCHed `/api/handoff/ai/design-artifact/[id]`, which has **no PATCH handler** —
    verified 405 against a running server, while the collection route returns 401. `applyMeta` swallowed it
    into `console.error`, so every change failed silently. The shared control targets the collection route,
    where the `computePermissions` gate actually lives.
  - The public copy link is **pattern-only**: an artifact already has its own `publicAccess` sharing control on
    its detail page, and a second link mechanism would re-create the duplication this phase removed.
- **E.7b — ✅ `public` has a copy link.** In `MetaControl`, under the visibility picker, once `public` is
  selected. Reads the existing view-only link and mints one only if there is none. This works — rather than
  being a copy-it-now-or-lose-it secret — because `createShareLink` hashes only *write-capable* tokens, so a
  view-only link stays recoverable on every later visit. Verified end-to-end: the minted URL resolves 200 for
  an unauthenticated recipient and lands on the read-only viewer, not the build surface. `ShareLinkPanel` had
  zero consumers and is **deleted**; capability picking, expiry and max-uses belong to "Invite to build".

### E.8 — One shell, three levels: page → brief → build — ✅ SHIPPED 2026-08-06

**The problem, in Brad's words:** "It makes it unclear what's happening… not a bunch of different interfaces
but the same thing — drilling down as people iterate over it."

He is right, and the fault is in how E.6 shipped: `/briefs/[id]` got its **own route and its own shell**, so a
brief reads as a third product rather than a deeper view of a page. The parts needed to fix it already exist —
`PlaygroundProvider` takes an injected `{hydrate, persist}` adapter plus a `structuralEditing` flag (that *is*
"same canvas, different write capability"), and `BriefViewer` already proved the swappable-left-panel,
select-a-build-and-both-panels-change interaction. This collapses three shells into one; it is not new UI.

**As built.** `PlaygroundWorkbench` owns the level and keys the provider; `PlaygroundBuilder` gained
`leftPanel` + `canvasControls` and is now the single shell for all three. `BriefViewer` and `BriefPreview` are
deleted; `/briefs/{id}` is a 307 into the unified URL. Panels: `BriefPanel`, `BuildPanel`, and `BuildList`
(mounted at both brief and page level). Ownership predicates live in `lib/workbench-level.ts`, shared by the
route and the shell, covered by `test/workbench-level.test.ts`. Two things found while building: the builder's
loading/error branches replaced the *whole* shell, which at brief level would strand you with no way back
(fixed — the panel survives), and `?builds=1` needed `listBuildsForPage` to avoid N queries per brief.

**The model — one shell, the left panel switches on level:**

| Level | Canvas | Left sidebar |
|---|---|---|
| Page | editable, autosaves | blocks / field editor (today) |
| Brief | frozen | brief meta + the builds made from it |
| Build | someone else's, read-only | their notes + audit results |

- **URL: query params on the existing route** — `/playground/{pageId}?brief={id}&build={id}`. One route, so
  back/forward work and the provider stays mounted per level. Deep links matter more than they look: the review
  queue links straight to a build today and notifications will later. Keep `/briefs/{id}` as a **redirect** into
  the unified URL rather than deleting it — links to it already exist.
- **⚠️ The provider MUST remount per selection (keyed), not just re-hydrate.** The page level autosaves. Swap
  the canvas to a brief or a build under a live provider and an in-flight autosave can write that content back
  onto the page — silent data loss. `BriefViewer` already keys on the record id; keep doing that.
- **Brief meta panel:** creator, version, date, instructions + help text, invite-link *status*, passphrase
  *status*, "Edit metadata" (instructions/help text), and two distinct verbs — **deactivate the invite**
  (revoke the link) vs **archive the brief** (E.6.5). They are different actions and must not share a button.
- **Build list is one component, mounted twice.** Also reachable straight from the page level (Brad: "so you
  don't have to go through the brief just to go open the build"). Same component, two mount points — this is
  what makes "quick to get to what I need" real rather than aspirational.
- **The right sidebar** becomes a second slot in the same shell, available at brief and build level, rather
  than a new layout concept.

### E.8b — Regenerate, because secrets are not recoverable — ✅ SHIPPED 2026-08-06

The original ask was to show "the link to the builder, the password" in the brief panel. **Neither can be
displayed, by design:** passphrases are `scrypt`-hashed with a salt, and write-capable link secrets are
SHA-256 hashed — which is why `GET /api/handoff/share` returns `secretRecoverable: false` rather than handing
back the id and letting the UI pretend it is a working URL. The wizard shows the URL once because once is all
there is.

**Decision: regenerate, do not store recoverably.** The panel shows *status* — link active · 3 of 10 uses ·
expires in 6 days · passphrase set — plus a **Regenerate** action that revokes the old link, mints a fresh
link + passphrase, and shows them once. Same information value, no security fiction, and the hashing keeps the
property that a database leak yields no usable invites.

**As built.** Three server actions in `app/actions/patterns.ts`: `regenerateInvite`, `deactivateInvite`,
`editBriefInstructions`. Notes worth keeping:

- **Only write-capable links are revoked.** A brief can also carry a read-only viewer link, and "stop people
  building from this" must not quietly stop people *looking* at it. Verified: two invites revoked, the
  view-only link survived.
- **Revoke happens before minting.** If minting then fails, a brief with no working invitation is better than
  one whose old link is still live after the user was told it was replaced.
- **Instructions are editable on a frozen object via a dedicated write** (`updateBriefInstructions`), not
  `patchPattern` — `data` is in `CONTENT_FIELDS` and the freeze guard refuses it outright, correctly, because
  `data.previews` is the snapshot builders work against. The dedicated write touches one key, re-writing
  `components` and `data.previews` untouched. Verified: instructions saved and trimmed, previews/guardrails/
  components unchanged, clearing removes the key rather than leaving an empty string, the freeze still refuses
  a content write on the same object, and a non-brief refuses instructions (no back door into a page's `data`).
- **"Deactivate invite" ≠ "archive brief"** — separate buttons, and `resolveShareLink` checks `revokedAt`, so a
  revoked invite genuinely stops resolving.

**Gap, deliberately not filled:** per-field **help text** has no author path anywhere. `resolveFieldGuardrail`
reads `help` and `TextField` renders it, but the invite wizard only captures `maxLength`/`required` — so there
is nothing to edit yet. It belongs with E.9, which is already opening up the same guardrails structure.

### E.9 — Content length from the field spec, not just from a brief — ✅ SHIPPED 2026-08-06

Today `maxLength` only exists **per brief** (`guardrails.fields[path].maxLength`, authored in the invite
wizard, enforced in three places, surfaced by `TextField`'s counter). So an internal author gets no limits at
all, because guardrails arrive with an invitation.

**What is actually true about the "existing field spec" — worth reading before starting.** A property can
carry a `rules` object, and `Wizard/prompt-builder.ts:23` already reads **`value.rules.maxLength`** to build
LLM context. But `IHandoffPropertyRules` (`lib/figma-plugin-contract.ts`) declares only `required` and
`dimensions` — **`maxLength` is not in the type and nothing enforces it.** It is a de-facto convention, not a
spec. So this work is:

1. **Declare it.** Add `maxLength` to `IHandoffPropertyRules`. That file mirrors a contract whose canonical
   source is `handoff-figma-plugin src/contract/index.ts` — **keep them in sync**, per the note at its head.
2. **Resolve with the brief winning.** `resolveFieldGuardrail` gains a fallback: brief override → component's
   declared `rules.maxLength` → nothing. A brief must still be able to be *stricter* than the component.
3. **React components are the open seam.** `handoff-core` produces no `rules` at all — for React, fields are
   largely *inferred* from serializable props, so there is nowhere to declare a limit today. The natural home
   is the paused fields-annotation layer (see [[project-typed-react-preview-builder]]); until that lands,
   React components simply declare nothing.
4. **No declaration → no enforcement** (Brad's call, 2026-08-06). Absent a limit, the field behaves exactly as
   it does now. Nothing is invented, which is the same rule the guardrails engine already follows.

**As built.** `maxLength` declared on `IHandoffPropertyRules`; `componentFieldRules()` flattens a properties
tree to `path → rule` (array items under `*`); `declaredRuleForPath()` matches a concrete editor path back onto
it; `resolveFieldGuardrail(config, path, declared?)` and `checkGuardrails(..., componentRules?)` take it from
there. `componentRulesForBlocks()` in `queries.ts` is the single server loader, used by **both** the guest
submit gate and the review-queue annotations — otherwise a reviewer would see fewer findings than the author
was held to. 17 tests in `test/component-field-rules.test.ts`.

Three decisions worth not re-deriving:

- **Precedence is by specificity, not `min()`:** explicit brief field rule → component's declared limit →
  brief's blanket default. A plain fallback chain gets the middle case wrong — a brief-wide default of 200
  would mask a component's structural limit of 60. `min()` was rejected because silently tightening a number a
  brief author typed makes the UI disagree with them.
- **Component rules are per component id, not merged into `config.fields`.** That map is keyed by a *global*
  path, so a `titleSlot` entry applies to every block; a hero headline and a card headline are both `titleSlot`
  and break at different lengths.
- **The field editor reads the declaration off `value`**, the property definition it is already handed — no
  path matching needed client-side. The flattening exists for the server, which has to match paths across a
  whole page.

**Nothing changes for anyone yet:** verified against the live deployment, **0 of 76** components declare a
`maxLength` today, and the extractor ran cleanly over all of them. This ships as capability. The one behavioural
change is that `checkPatternGuardrails` no longer early-returns when a page has no brief config — a page with no
invitation can now have limits, which was the entire gap.

**Still open (unchanged):** per-field `help` text has no author path. `resolveFieldGuardrail` now carries a
component-declared `help` through if one is ever declared, but neither the wizard nor the property contract
captures it.

### E.10 — Build audits: voice, accessibility, SEO, content — 🔄 DETERMINISTIC CHECKS SHIPPED 2026-08-06

Surfaced in the build level's left panel (E.8). **Decide the architecture before writing any of it:** the
preview iframe is `sandbox="allow-scripts"` with **no** `allow-same-origin`, an opaque origin so it cannot
reach registry cookies — which also means **the parent cannot read its DOM**. Scraping the rendered preview is
not available.

~~**Recommended: run audits server-side on the exported HTML**~~ — **that recommendation was wrong, and testing
it is what showed why.** For a **React** component `constructComponentPreview` emits a
`<script type="application/json">` of props plus a client-side mount; `renderPreview` server-side returns that
same mount, not DOM. There is **no server-rendered DOM for React components anywhere in the codebase**, and the
components in play are React — so an HTML pass would have inspected a props script and found nothing.

**Built instead: audits read the content values** (`lib/build-audits.ts`), reusing `collectEditableText` /
`collectImageSrcs` / `altForImagePath` / the weak-link-text list from the guardrails engine so overlapping
judgements cannot drift. Better for the reader too: every finding carries the field path and block it came from.

**Guardrails vs audits, stated once:** guardrails are a **gate** — configured on an invitation, enforced at
submit, can refuse a write. Audits are a **report** — always run, never block, nobody configures them. That
split also closed a hole: guardrails' alt check only runs when a page *has* a config, so nothing was checking
alt text on an ordinary internal page.

**No job and no storage.** The checks are a walk over stored content, so they are recomputed in the server
component that already loads the build. A stored audit would only ever be stale. **Voice will need the job** —
it is an LLM read against the brand-voice document, and shipping a regex version of it would be worse than the
empty section that currently says "Not checked yet".

**Shipped checks:** `placeholder-text`, `placeholder-image`, `shouting` (4+ consecutive caps words, so acronyms
and "GET A DEMO" are left alone), `repeated-copy` (5+ words, reported against the later block), `thin-content`
(<30 words, page-level), `missing-alt`, `weak-link-text`. 18 tests.

**Run over real pages before shipping**, which found a false positive worth knowing about: repeated **alt text**
was being reported as SEO duplicate content, and alt words were padding the count that decides thin content.
Alt is editable text but it is not page copy — `isPageCopy()` now excludes it from both, while still auditing it
for placeholders. On four real pages the remaining findings were all genuine: 10 placeholder images, 1
placeholder headline, 7 × "Learn More".

**Still to do:** the `voice` category (LLM + brand voice + a job), and any a11y rule that needs layout —
heading order and contrast are the obvious ones, and both need either component-level semantics about which
field is a heading, or the in-frame `postMessage` route.

**Sequencing for E.8–E.10 (Brad, 2026-08-06):** Duplicate off the library cards → E.8 page+brief levels →
E.8 build level (audit panel as an empty slot) → E.8b brief metadata editing + regenerate → E.9 content length
→ E.10 audits filling that slot → **notifications last, explicitly deferred.**

### E.13 — The build view, rearranged around the decision

Information-architecture work on `BuildPanel`, argued from the code rather than from a mock — this surface is
auth-walled, so none of it has been *seen* rendering yet.

**The decision moved above the diagnostics.** It was the last section in a 300px scrolling rail, so on any build with
findings the two buttons a reviewer came for were off-screen: they had to scroll past every check to reach the thing
they opened the panel to do. Diagnostics inform a decision; they should not stand in front of it. Order is now
title/status → their note → **decide** → checks → download.

**Status uses the designed vocabulary.** It printed `Status: review` — a raw enum — while `LIFECYCLE_META` already
defines `review → "Ready for review"` and carries a `ghost` flag for prototypes. Now a chip reading the real label.

**One findings list, not two sections and four headings** (Brad: *"merge the two findings sections"*). The split
between "Checks" (audits) and "Content rules" (advisory guardrails) was justified at the **data** layer — different
passes, different vocabularies, and `FindingsList` still takes only their intersection — and that argument simply does
not transfer to the UI. A reviewer asking *"what is wrong with this page?"* does not care which pass noticed. **My
own earlier reasoning was right about the types and wrong about the screen.**

The category is not lost, it moves onto the row it describes: `Accessibility · Block 2 · Alt text`. Four headings for
five findings is chrome; the same four words on the rows are signal. Empty categories no longer render at all — a
clean build used to show four headings and four reassurances, pushing the decision further down to say nothing.

⚠️ **One deliberate honesty survived the merge, and nearly did not.** The per-category empty states included
*"Voice: not checked yet — needs a read against your brand voice."* E.10 shipped that category deliberately empty
because judging copy against a brand voice is an LLM's job, and *"shipping a fake version of it would be worse than
an empty section that says so"*. Collapsing to a single "No issues found." would have quietly implied voice **was**
checked. It is now a footnote under the list. Worth noting as a pattern: when consolidating UI, the empty states are
where the honest caveats hide.

**Still open, and needing Brad's eye rather than mine:** `(self-declared)` reads as legalese in the primary metadata
line (better as a tooltip on the name), and Download sits at the same visual weight as Approve.

### E.12 — Notifications: the data was collected for this and never used

`lib/notify.ts` + two hooks in `pattern-write.ts`. **Lifecycle itself was already built** — states
(`prototype | draft | review | approved | archived`), the gates in `authz/policy.ts`, `decidePatternMetaChange`,
`decideReview`, and the meta control from E.7. The gap was that nothing *told anyone* when state changed.

**The intent was already in the schema.** `handoff_pattern.submitted_by_email` is documented as *"For a built page:
the author's email, for state-change notifications"* and the guest form collects it with disclosure — then nobody
ever read it. So a build could be submitted and reviewed with no one informed: the owner had to happen to notice a
queue badge, and the guest, having no account and no queue, could not learn the outcome at all. After submitting, the
honest thing the UI could say was "someone will look at this eventually".

**Two notifications, at the two moments that matter:**

- **Build submitted → the page owner**, with the builder's note and a link straight to the build. That link is the
  payoff of E.8 making every level addressable: `/playground/{page}?build={id}` lands them on the thing itself
  instead of a dashboard to hunt through. The parent page is resolved inside `notify.ts` (build → `templateId` →
  brief → `sourcePageId` → page), so the write path passes only what it knows.
- **Decision → whoever built it**, with the reviewer's note. **Deliberately no call to action**: a guest cannot open
  the workbench, so a button would be a dead end dressed as an action. It also no-ops on an internal page moving
  through review, since `submitted_by_email` is null there — the correct silence rather than a special case.

**Three rules, and the first two are not negotiable:**

1. **A notification must never fail a write.** Everything goes through `notifyInBackground`, which swallows *and
   logs*. The submission is the fact; telling someone is a courtesy, and a Resend outage must not fail a build a
   guest just spent an hour on. It exists as a helper rather than leaving callers to write `void notify().catch()`
   because one of them would eventually forget, and that failure surfaces as a lost submission.
2. **Silence without configuration, not a crash.** `sendTemplatedEmail` skips when `RESEND_API_KEY` is unset —
   exactly what `sendInviteEmail` and `sendPasswordResetEmail` already did — so local and preview environments need
   no mail setup. Both invariants are tested; neither test is about content.
3. **Reuse the house layout.** `emailLayout` gained an **optional** CTA rather than a second template, so an
   informational message uses the same shell as the invite and reset mails.

⚠️ **A mistake worth recording.** The submit hook was first inserted with a non-unique anchor string and landed in
`setPatternMetaFields` instead of `submitGuestSubmission` — it would have emailed the owner on every visibility
change, with an undefined `guest`. `tsc` was clean; **`next build` caught it**, and the fix was verified by walking
the file to confirm which function each hook sits in rather than trusting the patch. Third time in a day that the
Next build caught what the root typecheck did not.

**Not done here:** `handoff_publication` is still unbound (in migration 0028, absent from `schema.ts`). It is
explicitly *not* a lifecycle state — the migration says so — and belongs with Phase D outbound export, so the
"published" chip stays underived for now.

### E.11 — Why a build cannot be submitted, said where it can be fixed

Opened by a real failure: submitting a build returned *"Could not submit the page."* while the Vercel log held
`8 things need fixing before this can be submitted: Logo is required. Primary is required. Items is required. …`
(Brad, 2026-08-11). Two independent defects, both now fixed; the UI half is the next piece of work.

**1. ✅ The gate was asking for things that were already there.** The required pass decided satisfaction with
`typeof value === 'string' && value.trim().length > 0`, so `required` was **unsatisfiable on every field that does
not hold a string** — an image is `{src, alt}`, a button `{url, label}`, a repeater an array. Measured across the
SS&C catalog by feeding each component *its own shipped preview values*: **68 false findings on 81 components**,
labelled exactly as Brad saw them (`Items` 14, `Image` 9, `Button` 6, `Primary` 3, `Logo` 3, `Tags` 2) plus
`Show_stats` — a **boolean**, where `false` read as missing. Now `hasAuthoredValue`, and the same probe reports
**0**. It only surfaced when E.9 wired *component-declared* `required` into the gate; before that only a brief's
text rules reached it.

**2. ✅ The findings were computed and then thrown away.** `throw new Error(summarizeBlocking(blocking))` flattened
a list of structured findings — each with `path`, `label`, `blockIndex`, `code`, `severity` — into one sentence, and
the route mapped it to a generic 500. `GuardrailBlockedError` now carries them (mirroring `AuthorizationError`'s
`code` + `is*` idiom), and the guest submit route answers **422 with `findings`** — a well-formed request whose
content did not pass, not a server failure.

**3. ✅ The UI — `components/Playground/FindingsList.tsx`, shared by both audiences.** The reviewer's build view
listed audit findings as flat `<li>{message}</li>` text and the guest's submit path showed nothing at all; both now
render the same list, with the field **named** and the block numbered (`Block 2 · Logo`).

It takes the **intersection** of the two finding types — `message` / `path` / `blockIndex` — rather than unifying
`GuardrailFinding` and `AuditFinding`. They are produced by different passes for different reasons, and forcing a
shared vocabulary would serve neither; they already agree on those three fields, so that agreement is the contract.
`onSelect` is optional, so a host with no canvas beside it renders inert text instead of a control that cannot work.

**4. ✅ Jump to field.** Clicking a finding selects its block and highlights the field.

**A `window` message (`playground-reveal-field`), not a prop or a context** — because the two callers sit on opposite
sides of the playground and no single React path connects them. `BuildPanel` is *rendered* inside `PlaygroundBuilder`
(it arrives as the `leftPanel` element, so context would reach it), but `GuestAuthoring` renders the whole editor as a
child and sits **above** it, where a context provided by the builder is invisible — and threading a callback upward
would invert the data flow through three components. The builder already runs a hub for exactly this class of request
(`playground-scroll-to-block`, `playground-highlight-field`, `playground-edit-field`), so this is the existing idiom,
and it keeps the guest surface ignorant of the playground's internals: it says *what* it wants, not *how*.

Only the builder can satisfy it — a finding names a block by **index**, and the builder holds the ordered blocks that
turn that into a `uniqueId`, plus the canvas ref to point at. Scroll first, then highlight; a page-level finding
(no path) still brings its block into view, because being shown the right block is most of the answer even when no
single field is at fault.

**Verified in a real browser**, since the mechanism rests on one assumption that would fail silently: that
`window.postMessage` to the same window reaches that window's own listener. Driving the real handler shape — 3 of 5
messages acted on, an out-of-range block and a foreign message type both ignored, `items.2.paragraph` normalising to
`items.paragraph`. The SSR guard is tested too: `BuildPanel` and `GuestAuthoring` are both in the server-rendered
tree, so an unguarded `window.postMessage` would turn "the jump doesn't work" into "the page 500s".

**5. ✅ Both decisions taken** (Brad, 2026-08-11: *"advisory in the build view, don't block invisible fields"*).

**Advisory findings now show in the build view**, as their own **Content rules** section — deliberately not folded
into the audit categories, because they come from a different pass and none of them belongs to an audit category.
`advisoryFindings()` is the exact complement of `blockingFindings()`. They previously "travelled to the review queue
instead", so opening a build showed the deterministic audits but not the advisory guardrails: two half-views of one
submission. Same `FindingsList`, so they are clickable too.

**Invisible fields no longer block.** For a guest submission the rules are derived from the **filtered** property
tree, so *"we only enforce what we showed you"* is structural rather than a condition inside the checker — a config
field that `contentOnlyProperties` removes simply has no rule to break. Internal editors are unaffected: they see
config, so a required `theme` still holds for them.

**That needed a boundary fix, and it is the interesting part.** `content-only.ts` imported `resolveFieldType` from
`Field.tsx` — a `'use client'` module — so the server could not ask *"can the guest see this field?"* without pulling
the client component graph into the server build. `resolveFieldType` is now its own pure module
(`fields/field-type.ts`) which `Field.tsx` re-exports, so the original guarantee holds ("what is hidden cannot drift
from what is drawn") while the classifier became server-safe. Same shape as the `FieldGuardrailsContext` fix: when
the boundary is in the way, extract the pure part rather than duplicating it.

**Tested as a property, not as plumbing:** that config carries no rule once filtered, and that an empty required
config field therefore yields no finding. That survives a refactor of the query layer, which mocking
`componentRulesForBlocks` would not.

⚠️ **`tsc --noEmit` is not the gate for app-layer changes.** It passed clean while `next build` failed twice — a
guessed db-client path and a missing `export` on `checkPatternGuardrails`. Second time in one day; `src/app`
type-checks under its own tsconfig, so the Next build is the check that counts.

### E.4 — Guardrail editor for templates — ⤵ ABSORBED into E.6

Slice 3 enforces `template.data.guardrails` in three places (editor, submit, review) but nothing *sets* it
from the browser — today it is a JSON field. Now that a template is a real, frozen object with its own
inspector, that inspector is where per-field limits, required flags and the alt-text severity belong. Small
and high-leverage: it is what lets Craig and Andrew define the rules SS&C asked for without editing JSON.

**Sequencing:** E.1 ✅. E.3 ✅ (before E.2, because "one save path" is only coherent once the record is the
source of truth). E.2 → **E.2b, E.2a, E.2c, E.2d** in that order: fix the template-editing defect first
because it is wrong behaviour on an object that already exists, then unblock sharing, then remove the
control the library replaces. E.4 and E.5 last. **E.5 before E.4** on Brad's steer (2026-08-05): the reused editor is the bigger quality
jump, and it is cheaper than it looked because guests need no new endpoints.

## Phase F — Direct manipulation in the playground editor (Brad, 2026-08-05)

### The target is the **guest**, not us (Brad, 2026-08-06)

> "why wouldn't we use the F mechanics for the build - exposed to the end consumer?"

The strongest case for F is not that our field editor is rough — it is that **the guest surface requires
design-system vocabulary.** An invited outsider gets fields called `bodySlot`, `overlineSlot`, `titleSlot`.
Clicking the headline on the page needs no vocabulary at all, which is the difference between a tool you have
to be taught and a link you can send a stakeholder cold. E.5 already points guests at the real editor, so every
F improvement reaches them for free.

**Decision: invites lock config — guests edit content only.** ✅ *Shipped 2026-08-06*, ahead of the rest of F,
because it is small and was a live gap: guests could change `theme`, `layout`, `direction`, every boolean, and —
worse — reach `RawJsonField`, a raw JSON editor over the block args that bypasses every field-level rule.
`components/Playground/fields/content-only.ts` filters the properties tree (`contentOnly` on
`PlaygroundProvider` → `EditContextProvider`), so a hidden field is absent rather than disabled. 13 tests.

**Two consequences for the phase:**

1. **The tracer's blind spot stops mattering where it counts.** F.2 traces text and images and deliberately
   refuses enums/booleans/numbers. With config locked, the traceable set *is* the guest-editable set — so inline
   editing has no hole on the surface it is aimed at, on the registries that need a tracer at all.
2. **"Render the options" becomes internal-only.** Picking an enum by sight is real value, but guests no longer
   see enums — so it drops to **F.5**.

**And it raises the stakes on the capture bug rather than lowering them.** F.3 is the first phase that *writes*;
19% of stored preview values on 38 of 76 components are serialized render output, which feeds back either
ignored or throwing. An internal author hitting that is confused; an **unattended guest with no support channel**
produces a silently wrong page you discover at review, after they have gone. So `F.-1` below is mandatory.

**`F.-1` started 2026-08-10 — the content-limit half is done.** The E.9 rewire landed with it, because reading
the real limits without correcting them would have blocked 74% of the ALPS corpus on day one:

- **E.9 read a key nothing used.** Limits are declared `rules.content.{min,max}` — what
  `config/templates/component/template.json` models, what `docs/schemas/component.schema.json` declares, what
  `RulesSheet` renders, and what registries carry. E.9 shipped reading a flat `maxLength` I had invented
  alongside it. `content` is now canonical in `IHandoffPropertyRules`, the extractor and `TextField` read
  `content.max`/`content.min`, and `maxLength` survives as a documented legacy alias (`prompt-builder.ts` has
  read it since before either existed). **`content.min` maps to `minLength`, which the checker already
  enforced** — so the rewire turns on minimum-length checking that was previously dead.
- **Root cause of the boilerplate found, and it was upstream of every author.**
  `config/templates/component/template.json` shipped `{min: 5, max: 25}` on **both** its example properties —
  including `url`, where a 25-character cap rejects almost every real URL. Every component scaffolded from it
  inherited that block, which is why the identical `{max:25,min:5}` appeared on `title`, `read_time`,
  `publication_date` and `authors[].*`. Fixed: `label` keeps a plausible `max: 40` with no arbitrary minimum,
  `url` keeps `required` and loses the cap. New components stop inheriting it.
- **`lib/contract-limit-audit.ts` — the first F.-1 check, and the oracle is the component's own previews.** A
  cap that rejects the value the component ships is wrong without needing the content corpus, so it can be acted
  on rather than argued about. Four codes: `preview-exceeds-max`, `preview-under-min`, `max-on-url`,
  `duplicated-rules` (3+ fields sharing one block — the paste signature). Deliberately holds **no opinion about
  what a limit should be**: that needs the corpus and belongs to whoever owns the content. 14 tests.
- **Repeatable, not a one-off script:** `GET /api/admin/contract-limit-audit` (admin session or
  `HANDOFF_SYNC_SECRET` bearer, mirroring `field-bridge-audit`), with `?component=`, `?code=`, `?limit=`.
- **First run over SS&C: 45 of 83 components, 89 findings** — `preview-exceeds-max` **36**,
  `duplicated-rules` **29**, `max-on-url` **23**, `preview-under-min` **1**. Not just `blog_header`: 76 of 83
  declare limits and over half are wrong. Triage list handed to Brad; **correcting that data is a change in
  `ssc-handoff-next`, not here.**

**`F.-1b` — the survey and the proposal, 2026-08-11. `lib/content-length-plan.ts` + `?plan=1`.**

Brad asked to rationalize SS&C's limits and framed it as audit → best guess → refine, and to make the check
standing rather than a one-off: *"bake this in as a health check on the sites that have explicit field definitions
(eg not necessarily on react sites)"*. So the audit above keeps stating only facts, and a second module states an
**opinion** with its reasoning attached — the non-goal recorded above is reversed on request, not abandoned by
drift.

**Scope needs no format check.** A React component's fields are inferred and carry no `rules`, so it contributes
nothing and is counted separately (`inferredOnly`) rather than filtered out. A React component that *does* declare
rules gets the same treatment, which is the behaviour worth having.

**The survey — 83 components, 614 fields, 420 with a length rule** (source contracts, not the built `dist`):

| | |
|---|---|
| `remove-rule` | **50** — a length rule on a reference: URL, icon, composite, config |
| `not-a-length` | **78** — a row count or a numeric range; left exactly as authored |
| `raise-max` | **195** — 36 evidence-driven (the cap rejects the component's own content), 159 role-driven |
| `drop-min` | **84** |
| `lower-max` | **7** |
| `keep` | **6** |
| `no-basis` | **0** — every field had a preview or a default to measure |

**`min` is the real damage: 389 of 420 fields carry one.** A minimum length cannot prevent a layout break; it only
rejects legitimately short copy ("Go", "Q1 2026", "APAC"). It exists because the scaffolding template shipped
`{min: 5, max: 25}` and it was pasted down every property list — 80 fields carry that exact pair. Requiredness is
`rules.required`, which is what anyone actually meant. Proposed for removal everywhere, no exceptions.

**The guess is a role table** (`ROLE_LIMITS`, editable and meant to be argued with), floored by evidence: a proposal
is never below `observed × 1.2` where the component already ships longer content, so **applying the plan cannot
reject copy that renders today**. The role default is the opinion; the floor is the fact.

**Two bugs the recommender only revealed when run over the real catalog** — both now pinned by tests:

- **`menu.primary.*.mega.link` is a label, not a URL.** Typed `text`, named "Bottom Link Text", rendered as the
  anchor's text (`template.hbs:149`) with a sibling `href` holding the URL. Matching `link` as a URL *name* stripped
  a cap that is real, because that label sits in a fixed-width mega-menu footer. `link` is now handled by type, not
  by name.
- **Richtext must never be pulled in.** Its cap counts *markup*, so it is not comparable to a floor derived from
  plain text, and the generous caps are usually deliberate — proposing 320 for `accordion.items.*.paragraph` (5000)
  would have broken a multi-paragraph body whose real constraint is the component's own guidance, "avoid lengthy
  body text, 3 paragraphs+". 26 richtext caps are flagged `countsMarkup` instead.

**A live follow-on this exposed: E.9 enforcement counts markup too.** The rail's counter and the inline overlay both
measure raw string length, so a richtext field spends 15 characters on `<b>Hi</b>`. The limit is enforced against
the HTML, not the copy — worth fixing where richtext limits are enforced, not by changing the numbers.

**One number to distrust: `blog_header.title` → 80.** That is the field that started this (177 of 240 ALPS titles
exceeded its cap of 25), and a role floor cannot know a corpus — 80 clears every preview but may still be short for
real ALPS headlines. Exactly the kind of thing the refine pass is for.

Full per-field record, all 420 rows: `docs/SSC-CONTENT-LENGTH-PLAN.md`. 25 tests.

**`F.-1c` — applied to `ssc-handoff-next`, 2026-08-11. 76 files, 342 fields, left uncommitted for review.**

**Surgical edits, because the files are neither uniform nor JSON.** A wholesale re-serialize reflowed 81 of 83 —
preview arrays hold hand-compacted one-line objects — and `bar_chart.js` writes its description as a **template
literal**, so a JSON scanner cannot find the spans either. The applier parses each file with **acorn** and replaces
only the `rules` object of each affected property, verified two ways: the span must `JSON.parse` back to the rules
block the plan was computed from (a mismatch aborts that field), and the rewritten file must still parse as JS.
Confirmed afterwards that the only non-`rules` lines in the diff were Brad's own pre-existing edits to `404.js` and
`video.js`, which the run preserved.

**⚠️ The third bug the real data caught, and the worst of the three: `content` is not always a length.** The plan as
first written classified `array` and `number` as "not free text" and proposed deleting all **78** of their rules. On
an `array`, `content` is a **row count** — `hero_split.breadcrumb` max 4, `menu.utilities` max 4,
`blog_header.authors` max 2, `blog_header.tags` min 1 max 10 — and on a `number` it is a **value range**
(`stats.items.*.duration` spans ±10,000,000). Every one of those reads as a deliberate decision. Nothing in the app
enforces either today (`componentFieldRules` extracts `content` for all types; only `TextField` consumes it) but
**unenforced is not meaningless** — deleting an author's stated intent because the runtime currently ignores it is how
information gets lost. New `not-a-length` action: hands off entirely, minimum included.

**Convergence, checked by re-running both tools over the rewritten contracts:**

- The plan re-runs to **0** `raise-max` / `lower-max` / `drop-min` / `remove-rule` — 292 `keep`, 78 `not-a-length`.
- `selfContradicting` **36 → 0**. Every cap now clears the component's own content.
- The independent F.-1 audit goes **89 findings → 4**.

**That 89 → 4 needed two audit fixes, both false-positive classes created by the rationalization itself** — and a
report with permanent noise stops being read, which is the same lesson as the 107 → 14 render-audit pass:

- **`max-on-url` reported `mega.link` forever.** Its URL detection matched the *name* `link`; the plan's corrected
  rule matches the **type**. `isReferenceField` is now shared, so the two cannot disagree.
- **`duplicated-rules` fired on deliberate consistency.** `menu` has six `title`-role fields at 60 because a card
  title *should* be 60 everywhere — flagging that is flagging the fix. It now skips non-length types and skips any
  block where every field's own role agrees on the number. A paste smell is fields of *different* roles sharing one
  cap, which is exactly what the 4 survivors are.

**Not rebuilt, deliberately.** `handoff/components/*/dist/*.json` is tracked and was already dirty from an earlier
build; regenerating it would bury this diff. The registry gets these via `handoff-app push:all`.

**`F.-1d` — the last 4 findings, pulled to their floors. 4 files, 10 fields. Audit now reports 0.**

All twelve fields behind those findings **state their own purpose** in `name`/`description`, so the roles came from
evidence rather than from the key: "Column 1 Label", "The search placeholder", "Title (Muted Line)", "Bottom Link
Text", "This is the header of the card". Three names joined `ROLE_LIMITS` — `search` 40, `link` 32, `header` 80/60 —
which is the durable half: the audit's `roleAgrees` check now recognises them, so these findings stay closed instead
of reappearing.

**Two of the ten moved *up*, not down**, and that is worth stating plainly because it reverses something recorded
above. `menu.primary.*.mega.link` and `…menu.*.link` went 25 → 32. `F.-1b` defended their 25-character cap as real
("a fixed-width mega-menu footer"), but that was an argument about whether the field is a URL, which is settled — it
is a label. The cap *value* came from the same `{min: 1, max: 25}` paste that put six `title` fields in `menu` at 25,
and the evidence agrees: "View all solutions" fills **18 of 25**, so the evidence floor alone (18 × 1.2 → 30) already
exceeds it. `mega.card.header` went 25 → 60 as an in-row heading.

**`filters.sort.*.sort` was left at 45 on purpose.** It holds `alp_asc` — a machine sort key, not copy — so neither
a pull nor a raise means anything, and the honest options are "classify it as config and drop the rule" or "leave it".
Left it, and the finding cleared anyway because the block of three broke up. Worth a decision later: `sort` is
config wearing a `text` type, the same shape as `class`.

`ROLE_LIMITS` adding `link: 32` is only safe because the reference check runs **first** — a `link`-*typed* field never
reaches the role lookup, so the entry can only ever match a `text` field named `link`, which is exactly the label
case. Two tests changed to record that, both deliberately.

**Converged, checked with both tools:** F.-1 audit **0 findings**; the plan proposes **0** further changes (292
`keep`, 78 `not-a-length`, `selfContradicting` 0).

**`F.-1e` — rebuilt and pushed to the live registry, 2026-08-11.** 83 components rebuilt, `push --components <ids>
--no-build` applied **83/83**; `ssc-handoff.vercel.app` went 3046 → 3129 sync events with counts unchanged at
83 components / 16 patterns / 67 pages. Verified through the MCP rather than the exit code: `blog_header.title` is
`{max: 80}` with no minimum, `tags` still `{min: 1, max: 10}` and `authors` still `{min: 1, max: 2}` (the row counts
survived), the four `url`-typed fields carry `{required: true}` only, and `authors.*.image` keeps its `dimensions`
rules untouched.

**Confirmed from the registry itself, 2026-08-11.** `GET /api/admin/contract-limit-audit?plan=1` on
`ssc-handoff.vercel.app` (admin session, run in the browser) reports **0 findings**, `selfContradicting` 0, and a plan
of **292 `keep` / 78 `not-a-length`** — "plan is settled, nothing left to change". That is the whole-catalog sweep
against the **stored rows**, independent of the local contracts and of the MCP spot check, so all three agree.

**⚠️ `push:all` must not be run from this workspace as it stands.** Its `/api/registry/tokens` and `/api/registry/dtcg`
steps send `public/api/tokens.json` (local: **June 7**) and `design-system/` (local: **June 17–18**), but the registry
took a **figma-sync on 2026-07-17** — 225 tokens added, then 100 modified, then typography and shadow keys twice more.
Pushing would revert a month of token work on a live client registry. It also **does not push components at all**:
`push:all` is config, theme, navigation, pages, tokens, DTCG, icons, logos. Contracts travel via `push` →
`POST /api/sync/upload`. Run `npm run fetch` first if the token push is ever wanted.

**Two mechanics worth knowing for the next push.** A component push **replaces** `properties` *and* `previews`
(`sync-queries.ts`, `onConflictDoUpdate`), so registry-contributed previews are at risk — check
`handoff_recent_changes({entityType: 'component'})` first; here it was empty for 365 days. And `--components` with no
ids still sweeps in **60 pages**; passing explicit ids makes the push selective (0 pages, 0 patterns). `--dry-run`
needs no token, so the change set is always inspectable first.

**Sync state repointed.** `handoff/.handoff/sync-state.json` read `remoteUrl: http://localhost:4002`,
`lastSyncVersion: 3`, `lastSyncAt: 2026-06-06`, with 3 fingerprints naming `*.handoff.ts` files that no longer exist —
against a remote at 3129. Now `{remoteUrl: https://ssc-handoff.vercel.app, lastSyncVersion: 0, lastSyncAt: '',
fingerprints: {}}`, byte-for-byte what `run-pull` writes for fresh state.

**Cursor 0 is the only honest value, and it stays there** (Brad, 2026-08-11: "Leave it at 0, I'll deal with the
conflicts"). It means "nothing pulled from this remote", so no registry change can be silently skipped. Setting 3129
would declare the workspace current and skip real content — the registry's 16 patterns are not in the workspace at
all, and 7 of its 67 pages are not local. **Do not advance this cursor to quiet a noisy pull.** The noise is the
known cost: a pull from 0 replays every historical version (260 component entries, 60 pages) and reports **180
conflicts across 60 unique pages**. Conflicts are parked in `.handoff/conflicts/` rather than applied, so nothing is
overwritten — they are Brad's to triage.
`run-pull` would have done this repoint itself on the next pull (`state.remoteUrl !== baseUrl → lastSyncVersion = 0`).

**Correction:** push skipping is **not** governed by `sync-state.json` — `run-push` never reads it. It uses
`.handoff/.cache/build-cache.json`. All 83 re-uploaded because explicit `--components <ids>` makes the push
**selective**, and selective pushes disable the skip-cache by design.

### Porting the length + validation work to the live SS&C design system

`ssc-handoff.vercel.app` is a **beta** registry. The live design system gets hooked up later and this work has to come
with it (Brad, 2026-08-11). Recorded here rather than in `docs/SSC-CONTENT-LENGTH-PLAN.md` because that file is
**generated output** — a hand-edit there is lost on the next run.

**Most of it is already ported, because it is code in this repo, not data.** These travel automatically to any
registry and any workspace:

- `lib/content-length-plan.ts` — the role table, the `not-a-length` distinction, the evidence floor.
- `lib/contract-limit-audit.ts` — with both false-positive fixes (name-matched `link`, role-consistent duplicates).
- `GET /api/admin/contract-limit-audit?plan=1` — the health check; it reads whatever registry it is deployed against.
- **`config/templates/component/template.json`** — the root cause. It shipped `{min: 5, max: 25}` on every scaffolded
  property; fixed, so nothing new inherits the paste in any workspace.

**What does *not* travel is the 342 applied values**, and how much work that is turns on one question:

1. **If the live system is a different *registry* fed by the same `ssc-handoff-next` workspace** — the contracts
   already carry the changes. Porting is a `push --components <ids>` at the other remote, plus a `sync-state.json`
   repoint (which `run-pull` does itself). Near-zero work.
2. **If it is a different *workspace* / repo** (an older Handoff version, or the V1 system) — the contracts are
   different, so the plan must be **re-run** against them, not copied. That is the real job, and it is a day's work
   of the same shape as `F.-1b`–`F.-1d`.

Check which before planning anything: whose `handoff.config.js` feeds the live site, and whether its component
declarations are these same `handoff/integration/**/<id>.js` files.

**Four things learned here that will bite the port either way:**

- **`content` is not always a length.** On `array` it is a row count, on `number` a value range — 78 of SS&C's 420.
  Anything sweeping `rules.content` generically must know this.
- **`min: 0` means "no minimum"** and appears on 31 fields. Compare normalised values or every one reads as stale.
- **Editing contracts needs an AST.** They are hand-formatted JS, not JSON — `bar_chart.js` uses a template literal —
  so re-serializing reflows 81 of 83 files and a JSON scanner cannot find the spans. **Now a committed script:**
  `npm run contracts:lengths -- --workspace <dir> [--write] [--component id]`
  (`scripts/apply-content-length-plan.ts`). Dry run by default; discovers contracts through `handoff.config.js`
  `entries.components` (a list of **directories**, not ids); guards each edit twice — the span must `JSON.parse` back
  to the rules block the plan was computed from, and the rewritten file must re-parse clean.

  It uses the **TypeScript compiler API**, not acorn: acorn resolves here only transitively and is not a declared
  dependency, so a committed script relying on it could break on a future install. `typescript` cannot go missing in a
  repo that builds with `tsc`, and gives the same exact offsets.

  **Verified by replaying the real change.** Restored `blog_header`, `bar_chart` and `menu` from `HEAD` into a fixture
  workspace and re-ran it: output **byte-identical** to what shipped, on all three — including `menu` at 1220 lines.
  Nothing outside the `rules` blocks moved, the template literal and the compacted one-line preview objects survived,
  a second run changed nothing, and against the live contracts it is a clean no-op (0 edits, 292 `keep`, 78
  `not-a-length`).

  **The two-phase pass is now one pass.** `F.-1d`'s targeted pull was hand-authored, but its values came from roles
  that now live in `ROLE_LIMITS` (`search` 40, `link` 32, `header` 80/60) — so the script reproduces `mega.link: 32`
  and `card.header: 60` on its own. A port needs one run, not a bulk pass plus a cleanup pass.

- **The per-field record generates from the same run:** add `--report <path>` (plus optional `--title` / `--note`).
  It is a flag rather than a second script on purpose — the first version read a separately-produced `plan.json`, the
  two drifted as soon as a field was revised by hand, and `docs/SSC-CONTENT-LENGTH-PLAN.md` had to be repaired to stop
  it describing labels that never shipped. Rendering from the plan that was just applied removes that failure mode.

  The **role-floor table is derived from `ROLE_LIMITS`** rather than typed out — the hand-written one went stale within
  a day of adding three roles. Deriving it immediately caught a real inconsistency: `subtitle_muted` had no
  `IN_ROW_OVERRIDE` while `subtitle` did, so the same field would cap at 160 in a repeater row and 120 outside one.
  Fixed; no SS&C field uses that name, so no values moved.

  The header carries **no absolute path** — this document is committed, and a run's `--workspace` would bake a home
  directory into it. Provenance goes in `--note`, which is also how a regenerated record can state that it already
  shipped (a fixture run cannot know that).

  `docs/SSC-CONTENT-LENGTH-PLAN.md` is now regenerated output: 420 rows, 76 component sections, reproducible from the
  pre-change contracts. Every headline number matches the hand-made version (420 fields, 50 / 78 / 198 / 7, 389 with a
  `min`, 36 self-contradicting, 26 richtext); the `drop-min` / `lower-max` / `keep` split moved (81 / 7 / 6 rather than
  76 / 14 / 4, same 94 fields) because the old doc carried hand-written action labels for the ten targeted fields and
  every label is now derived.
- **E.9 enforcement still counts markup on richtext** (26 SS&C fields). Unfixed, and it applies to the live system too.

**`F.-1` shape half done 2026-08-10 — `lib/contract-render-audit.ts`.**

**It does not render React, and says so.** `constructComponentPreview` emits a props script plus a client-side
mount for a React component and `renderPreview` server-side returns that same mount — there is no server-side
React render in this codebase to assert against, so a harness claiming to render would be asserting over a
`<script>` tag. What it asserts instead is grounded in the browser round-trip already recorded in
`FIELD-BRIDGE.md` rather than in rules invented for the harness:

- **`unfeedable-preview`** — an element-shaped stored value against a plain declared type. The round-trip
  established the outcomes: declared shape renders, `props.src` element is silently replaced by the component's
  default, stored value verbatim **throws** `(e || []).filter is not a function`. Slots are excluded, or every
  correct React slot would be flagged.
- **`undeclared-reference`** — the template renders `properties.X` the contract never declares. Unsettable
  through any API and empty on every page; `scaffold_args` cannot see it (`declared: 9, provided: 9,
  emptySlots: []`), which is why it needs its own check.
- **`declared-unrendered`** — the mirror: declared, never rendered, so the API accepts a value that does nothing.

**First run — 8x8 (React), from the DB:** **86 unfeedable fields across 37 of 76 components.** Split matters:
**23 crash** when fed back (declared `array`, stored element → `.filter` throws) and **63 silently render the
component's default**. The `crashesWhenFedBack` count is surfaced separately for exactly that reason.

**First run — SS&C (Handlebars), templates from disk:** 14 undeclared references + 7 declared-unrendered across
12 of 83. Includes `blog_header.paragraph` — the original finding #4 — plus two name mismatches worth having:
`blog_header` renders `author.linked_in` while the contract declares `authors`, and `related_posts` renders
`items.*` while the contract declares `related_posts`.

**A correction caught by reading the output instead of the count.** The first pass compared template refs against
*top-level* keys only, so `{{#field "items.title"}}` inside an `{{#each}}` was reported as undeclared on every
component with a repeater: **107 findings across 41 components**. Resolving nested and array-item paths took it
to **14 across 12** — the difference between noise and a triage list, and the reason `declaredPaths()` exists.

**Repeatable:** `GET /api/admin/contract-render-audit` (admin session or `HANDOFF_SYNC_SECRET` bearer), with
`?component=`, `?code=`, `?limit=`. Templates come from `handoff_component_source` when a workspace has pushed
them; that table is empty on a registry syncing only built artifacts, so `withTemplate: 0` means **not checked**,
not clean. 18 tests.

**Capture repaired at the sync boundary — ✅ 2026-08-10 (Brad's call).** The build that produces output-shaped
previews is upstream, but `sync-queries.ts` is where they enter this app, so that is where they stop.
`lib/normalize-preview-values.ts` reads a faithful plain equivalent back out — through `deriveLens`, so it cannot
disagree with the rest of the field bridge about where a value lives.

**Four rules, because this rewrites data on ingest:** never guess (replace only what can be read out); never
touch slots (`React.ReactNode`/`object`/`any` legitimately hold elements); idempotent (sync runs repeatedly);
and report every substitution, so a sync logs rather than silently rewriting a registry.

**Measured against the live 8x8 registry, dry run: unfeedable fields 86 → 23**, from 221 substitutions across 33
components (`image` 65, `richtext` 130, `text` 26). **What remains is exactly the 23 declared-`array`-holding-an-
element cases** — the *throwing* kind, whose real items are unrecoverable. Wrapping them as `[element]` would stop
the crash and render the wrong thing, trading a loud failure for a silent one, so rule 1 says leave them.

**Two entry points:**
- **On ingest** — `applyUploadedChange` normalises before storing, and normalises `data.previews` alongside the
  column so `getComponent` and the docs page cannot disagree about the same field. Verified end to end: an image
  element became `{src, alt, width, height}` with the real values and dimensions kept, a richtext element became
  its markup string, the declared array was left alone and still reported, and the preview wrapper's own `title`
  survived.
- **Backfill** — `POST /api/handoff/admin/normalize-previews`, admin-only, **`dryRun` defaults to `true`** because
  it rewrites registry data; `{"dryRun": false}` applies. Safe to re-run.

**Dimensions are lifted from the img props, not the lens:** `WRITABLE_LEAVES` deliberately excludes
`width`/`height` (nobody edits them), but dropping them collapses a slot and the page loses its proportions.

**The 23 arrays turned out mechanical, so they were encoded rather than hand-patched — 86 → 0.**

Brad asked for them fixed by hand. Looking at the real data first showed all 23 were **one shape in two
variants**: a wrapper element whose `props.children` are `<a>` nodes (`buttonSlots`), or a single `<a>`
(`footerButtonSlot`, `buttonSlot`, `productInfoButtonsSlot`). Each anchor carries `props.href` and a label as its
first string child, with a trailing `null` or a chevron `<span>`. That inverts to `{ url, text }` — the shape
`ButtonField` already reads and writes — by reading, not guessing, so it belongs in the normaliser.

Encoding it rather than patching the rows also makes it **durable**: a hand-fixed row is overwritten the next time
that component is pushed, because the upstream build still emits render output. The normaliser catches it on every
ingest.

**Live dry run after the change: unfeedable fields 86 → 0**, from 313 substitutions across 37 components
(`richtext` 130, `array` 92, `image` 65, `text` 26). Example:
`hero-split.buttonSlots → [{"url":"#","text":"Get Started"},{"url":"#","text":"Watch Demo"},{"url":"#","text":"Learn More"}]`.

Two details worth keeping:
- **The button branch runs before the lens gate.** `isElementish` requires a `type` key, and a rendered
  `buttonSlots` wrapper is `{ key, props, _owner }` with no `type` — so gating on the lens made it depend on React
  internals happening to be present. Finding an anchor is the evidence instead.
- **An element with no anchors still yields nothing.** An empty array would read as a deliberate "no buttons" and
  quietly drop whatever was really there, so rule 1 still holds for anything unrecoverable.

**F.3's data gate is clear.** Nothing in the catalog is unfeedable once the backfill runs, so inline editing has
no field it would write into and silently lose. The remaining F.3 prerequisites are its own (tracer coverage from
F.2, and the in-frame overlay), not data.

⚠️ **The order this section originally proposed is superseded** — it read `F.-1 → F.2 (tracer) → F.3 (inline)`,
which put the sentinel tracer first and gated inline editing on its coverage number. See **"two engines, two
mechanisms"** below: Handlebars needs no tracer, so it goes first, and the tracer becomes an extension rather
than the foundation. The in-frame overlay refinement that was recorded here is now part of **F.2**.

**Known weak point of the config lock:** config declared as a bare string is invisible to a type check.
`hero-split` declares `theme`/`layout`/`direction` as `enum` (locked correctly) but `anchor` and `imageTheme` as
`type: 'text'` — indistinguishable from a headline, and a guest editing `anchor` breaks in-page navigation. Held
off with a deliberately narrow name list (`anchor`, `id`, `slug`, `class`, `className`, `*Theme`). The real fix is
declaring config-ness on `rules` or via F.4's annotations, at which point the list goes away.

Full design: **`docs/PLAYGROUND-DIRECT-MANIPULATION.md`**. Distinct from `PLAYGROUND-EDITING.md`, which
covers AI-proposed edit *operations*; this is the human editing surface — the left-rail form.

The field editor works and is not slick. Three complaints with three different fixes: fields arrive in
schema order with patchy help text; block-builder parameters (`light`/`dark`, `left`/`right`, overlay) can't
be explained by a label as well as by being *seen*; and the form is visually rough. Constraint throughout:
components stay arbitrary production React/Handlebars — **no Handoff authoring sauce may be required.**

### The mechanism: **two engines, two mechanisms** — corrected 2026-08-10

> "our goal when we speced phase F was to make this in line editing work both for the react components
> (inference plus field bridge) and handlebars (field wrappers)." — Brad

**The original spec unified them and that was a mistake.** It chose sentinel tracing for both engines, on the
grounds that the path is then "identical for React and Handlebars", and demoted the Handlebars `field` helper to
"a useful cross-check while validating the tracer". Two objections were given: the helper requires template
authoring, and it has array-index ambiguity. Both are weaker than they look:

- **The authoring cost is already paid.** The build-time helper at `src/transformers/utils/handlebars.ts:41`
  already emits `<span class="handoff-field…" data-handoff-field="title" data-handoff="…descriptor JSON…">`, and
  SS&C's templates already use `{{#field}}` throughout — 72 of 83 components have a template, and the contract
  audit reads `{{#field 'title'}}`, `{{#field "items.title"}}`, `{{#field 'author.linked_in'}}` out of them. This
  is an asset already in the repo, not a cost to impose.
- **The real blocker is three lines.** The *playground's* copy of the helper is stubbed to a pass-through
  (`Preview.tsx:16` — `return options.fn(this)`), so playground previews emit no wrappers at all. The spec
  treated that as a reason to sidestep the helper rather than as a fix.
- **Index ambiguity is tractable.** The wrapper is emitted *inside* the `{{#each}}`, so the Nth occurrence in
  document order is the Nth item — and the helper can carry `@index` besides.

**So the mechanisms split by engine, and the sequence follows:**

| Engine | Mechanism | Coverage | Registries |
|---|---|---|---|
| **Handlebars** | the existing `{{#field}}` wrapper, un-stubbed | deterministic, ~total | SS&C, Cynosure |
| **React** | sentinel tracing (mark before render, find the marks after) | inferred, 60–80% of text/image props | 8x8 |

**Handlebars goes first.** It is the smaller change, it has no coverage question, and it puts a working inline
editor in front of users on two of three registries. It also lets the *overlay* half of F.3 — geometry, in-frame
editing, writing back — be built and debugged against **reliable** marks, so when the tracer lands the only new
variable is the tracer.

⚠️ **A correction to how this phase was being sequenced.** "60–80% coverage" is a *sentinel* number, and it was
being quoted as the gate on F.3 generally. It is not: for Handlebars the mapping is exact. A React constraint had
become a Phase F constraint.

**What survives from the original reframe, unchanged.** For React, don't detect props in the DOM — that is
reverse-engineering an arbitrary render. **Mark the values before render and find the marks after**; the
component's own render is the oracle. Zero-width sentinels for text, a `?__hf=` query param for URLs, and
deliberately **no** tracing of enums/booleans/numbers (a sentinel there corrupts a class name or flips a branch).
That exclusion is the design: tracing works on exactly the props worth editing inline and fails on exactly the
ones where inline editing is meaningless — so the surface is a hybrid, **content inline on the canvas,
configuration as rendered choices in chrome.** With invites now locking config, the traceable set *is* the
guest-editable set.

---

### F.1 — Playground `field` helper marks — ✅ SHIPPED 2026-08-10

`lib/field-marks.ts`. Deterministic node↔field mapping, no inference, no coverage question. **Verified against the
real thing: all 72 SS&C templates compile, 70 emit marks, 551 marks total, 361 carrying a row index.**

**Comment pairs, not the `<span>` wrapper the build-time helper uses.** That wrapper is fine for the
`-inspect.html` debug artifacts it serves; it is not fine in the live canvas. Measured across those templates,
**26 of 292 field blocks wrap block-level content** — `footer.submenu` wraps `<li>`, `hero_video.breadcrumb` wraps
`<ul>` — and a `<span>` there is invalid nesting the browser reparents, breaking the layout *and* the association
the mark exists to create. A comment pair is valid anywhere, invisible to layout and CSS, cannot be reparented,
and yields an exact **node range** rather than a guess at "the next sibling" — which is what
`Range.getBoundingClientRect()` needs for the overlay. (Also checked before committing to comments: `{{#field}}`
never appears inside an HTML attribute in those templates, where a comment would corrupt the value instead.)

Format is `<!--hf:field:index-->…<!--/hf:field:index-->` — **name and row index only** (Brad: "just the field name
and index seems like plenty"); the descriptor is already in the editor's hands, so carrying it would be a second
copy to keep in sync. `@index` comes from `options.data.index`, which is what disambiguates `items.title` across
rows — the ambiguity that made annotation-only mapping look unworkable.

**Writer, reader and tests share one module**, because a wire format with three participants is how formats drift,
and a mismatch here fails *silently* — the editor just finds nothing. 12 tests.

Two things the tests caught: the parser must **recurse**, since `{{#field "items"}}` wraps `{{#field "items.title"}}`
on `accordion` and a single `matchAll` pass consumes the outer body and hides every field inside a repeater; and
`FIELD_MARK_RE` is global and therefore stateful, so recursion needs its own instance. Note the string parser is
for build-time checks and tests — **in the browser the editor walks comment nodes via `TreeWalker`**, where nesting
is not a problem because the nodes are flat siblings.

### F.2 — The editing surface, on Handlebars marks — 🔄 CORE SHIPPED 2026-08-10

`components/Playground/inline-edit-script.ts` (in-frame) + the commit path in `PlaygroundBuilder`. Click a marked
field in the canvas, edit it in an overlay, commit; the value goes through the **same `updateComponent` the rail
writes with**, so autosave, guardrails and the audits see an ordinary change.

**In-frame, as the design note specified.** The frame is opaque-origin so the parent cannot measure it; the overlay
lives inside the frame, which removes the rect protocol, scroll/resize/font-load invalidation and all drift. The
iframe channel still carries no geometry and never needs to.

**Never `contenteditable` on the component's own node** — a plain `<textarea>` positioned over the field's box.
Verified the component node is untouched while editing.

**The guardrail counter travels with it**, resolved through `resolveFieldGuardrail`, so the canvas shows the number
the rail shows and the server enforces — three places agreeing because they share a resolver.

**Field order comes free.** The frame reports marks in document order (`playground-fields`), which is the answer to
"fields come in the order they come in" with no inference at all.

**⚠️ The bug that testing caught, and the whitelist it forced.** Driving the overlay over real template output
showed two shapes where seeding from the marked range's *text* is wrong:

- **A field wrapping a repeater.** `footer.menu` wraps `<li>Privacy</li><li>Terms</li>`; the range reads back
  `"PrivacyTerms"`, and committing that writes a **string over an array of objects** — silent corruption of exactly
  the kind this phase exists to prevent.
- **Richtext.** `<strong>One</strong> unified system.` reads back as `One unified system.`, so a commit quietly
  strips the markup.

So the parent now derives a whitelist from each component's contract (`textEditableFieldPaths` — `text`/`string`
only) and the frame gives **no hit area at all** to anything else. Confirmed: 4 affordances instead of 6, and
clicking the `<ul>` or the richtext paragraph opens nothing. **Richtext stays in the rail**, which has the
formatting controls, until the overlay can carry markup rather than text.

**Verified** against real `{{#field}}` output driven in a browser: marks found in document order with block ids
resolved, overlay seeded with the current value, counter turning at the limit (`items.paragraph:1  10/12`), Escape
cancelling without a commit, Enter committing a single-line field, an **empty slot still clickable** (the range rect
is zero, so it falls back to the parent box), and a repeater row committing as `items.paragraph:1` — the index
surviving into the args path, which is the join that has to be right. 25 tests on the pure parts.

**⚠️ The bug that first real use caught: a committed edit did not stick** (Brad, 2026-08-11 — "the UI works the way
we had hoped", but "the content doesn't persist"). The commit was writing `data` and *only* `data`.
`constructComponentPreview` draws a Handlebars block from **`component.rendered`, a cached HTML string**, and never
re-renders it from `data` — so the commit updated the record, autosave saved it, and the canvas was then rebuilt from
the stale string. The text snapped back the instant it was committed, which reads exactly like "it didn't save".
`EditContext.handleSave` had always refreshed `rendered` for the rail; the inline path now does the same thing for
the same reason, and the comment at the commit site says why so it cannot be dropped again.

Two things came out of fixing it:

- **`setAtArgsPath` is now its own tested module** (`lib/set-at-args-path.ts`, 12 tests). The subtle part is what an
  absent intermediate becomes: `['items', 1, 'paragraph']` has to create an **array**, not an object keyed `"1"`, or
  the value lands where the template's `{{#each}}` never looks and the edit is accepted, saved and invisible. That
  is exactly the silent-success failure this phase exists to stop, and it is not testable inside a `useEffect`.
- **The canvas keeps its scroll position across a rebuild.** Every commit replaces the whole `srcdoc` — there is no
  partial update, because a Handlebars block *is* a rendered string — so each edit threw you back to the top of the
  page. Tolerable while edits came from the rail; unusable when you are editing text in the canvas. The frame is
  opaque-origin, so the frame reports its scroll offset (coalesced to one message per frame) and the parent hands it
  back on rebuild. Restored twice — once immediately, once after `load`, because images finishing changes the
  document height and a scroll set past the old height is silently clamped — and abandoned if *input* events say you
  moved yourself. Position alone can't tell "user scrolled away" from "restore fell short", which is why it watches
  `wheel`/`touchstart`/`keydown`/`mousedown` instead of comparing offsets. This lives in the **block-controls**
  script rather than the inline-edit one, so rail edits keep their place too.

**The orientation half — ✅ SHIPPED 2026-08-11.** `components/Playground/FieldLinkContext.ts`, a provider-optional
context mirroring `FieldGuardrailsContext` for the same two reasons: the field layer must not reach server code, and
these fields also render in `ComponentWorkbenchDialog` with no provider above them. Its default means "no canvas to
link to" — nothing highlights, `onHover` is a no-op, schema order stands.

- **Hover links both ways.** A rail row highlights its field in the canvas and vice versa. The frame had been
  emitting `playground-field-hover` and accepting `playground-highlight-field` since the core landed with nothing
  listening; `playground-field-focus` now also selects the block in the rail, so opening an overlay and using the
  rail agree on what "current" is.
- **Document order applied.** `orderPropertiesByDocument` sorts the rail by reported position — the answer to
  "fields come in the order they come in", applying a fact rather than inferring one, because a `TreeWalker` yields
  marks in document order for free. Two rules, both load-bearing: **no report means no reordering** (a React block
  or a canvas mid-load keeps schema order rather than being scrambled), and **unreported fields keep schema order
  after the reported ones** (config, anchors and theme switches have no document position, and inventing one would
  move them on every reload).
- **`fieldLinkKey` is the join, and it is tested.** The rail walks real args (`items.1.paragraph`); a mark carries
  `@index` (`items.paragraph:1`). Both normalise to `items.paragraph` — get it wrong and hover linking silently
  never matches, which reads as "not wired" rather than as a bug. The frame's highlight handler compares row-less
  too, so hovering the one editor the rail shows for a repeater lights up every row it covers.
- **Visible save/discard on the overlay.** The subtlety is `mousedown` + `preventDefault`: a click blurs the
  textarea first and **blur commits**, so "discard" would have committed before its own handler ran. The label and
  the buttons are separate nodes because `paint()` rewriting `meta.textContent` would remove the controls on the
  first keystroke.

### F.2b — Richtext inline — 🔄 SHIPPED 2026-08-12, commit path unverified

**Reversing the F.2 decision to leave richtext in the rail** (Brad, 2026-08-11: *"of course the guests are going to
hit richtext inline editing. It's weird to make most of the content editable but not this section for opaque
reasons."*). He is right, and the original reasoning was an implementation constraint presented as a product
decision: the overlay is a `<textarea>`, a textarea cannot carry markup, therefore richtext was excluded. That is a
statement about our overlay, not about what an author should expect — and from a guest's seat the rule reads as
"this paragraph is mysteriously special".

**The real problem to solve**, restated honestly: the overlay seeds from the marked range's *text*, so committing it
would strip `<strong>`, lists and links (measured — see `textEditableFieldPaths`). Inline richtext therefore needs an
editor that round-trips markup, which means the overlay grows a `contenteditable` variant for richtext marks only.
Three things make that harder than the textarea, and all three are already understood:

1. **No `contenteditable` on the component's own node** — React reconciliation eats it and a Handlebars re-render
   discards the caret (the caret-loss note in `RichTextField.tsx` is the same bug). So the overlay keeps owning its
   own node, seeded imperatively via a ref, exactly as `RichTextField` does.
2. **Seed from the mark's `innerHTML`, not its text.** The `TreeWalker` already gives an exact node range, so the
   HTML is available — this is the part the textarea threw away.
3. **The counter must measure copy, not markup** — already solved by `measuredLength` (E.9 addendum), so the inline
   counter can reuse it unchanged.

**Built 2026-08-12.** `richtextEditableFieldPaths` marks which paths are richtext; the frame gives those a
`contenteditable` overlay seeded from `cloneContents()` innerHTML, commits `innerHTML`, and counts **copy not
markup** with a `copyLength` mirroring `richTextToCopy` (an inline counter that disagrees with the gate would be the
E.9 bug again). Enter makes a paragraph rather than committing — ✓/blur commit — and ⌘/Ctrl+B/I/U format, because a
formatting control without them reads as broken.

The path-collection walk is now **shared** between text and richtext via one `collectEditablePaths` with two
predicates. The array-item rule is subtle enough that a second copy would drift, and drift there shows up as a field
silently offering no affordance.

**Verified in a browser** against real markup: the script parses, two hit areas appear (`<h2>` text, `<div>`
richtext), the overlay is `contenteditable`, it seeds with `<strong>`, `<a href>` and `<ul><li>` intact, and the
counter read `13/320` for "Changed copy." — markup correctly excluded.

⚠️ **The commit dispatch is NOT verified.** The harness proved unreliable: the preview pane renders `file://` as a
*static snapshot*, so `navigate` did not reload and state leaked between runs — caught when a "fresh" page reported
two pre-existing meta bars. Richtext differs from the working text path by one line
(`o.rich ? o.input.innerHTML : o.input.value`), inspected but not executed. **Needs one real click-through.**

⚠️ **Two process findings.** Unescaped backticks inside the injected template literal terminated it and turned
`</b>` into a regex — and **root `tsc --noEmit` passed anyway**; only esbuild caught it. Fourth time in two days that
the root typecheck missed something under `src/app`, which it evidently does not cover. Use `next build` (or `tsx`
against the module) as the gate.

**Also still to do in F.2:** **images.** These need the media browser, which lives in the rail — so the honest inline
affordance is "click the image → open the picker", not an overlay.

### E.9 addendum — a limit must be measured the way it is displayed (2026-08-11)

Two defects, found by asking where a limit is actually *counted*:

**Richtext limits counted markup.** `<b>Hi</b>` measured 15 characters instead of 2, and `RichTextField` showed
**no counter at all** — so an author could be blocked on submit by a limit they were never shown, counting tags they
never typed. 26 of SS&C's ruled fields are richtext.

`measuredLength(value, richtext)` and `richTextToCopy` now live in `authoring-guardrails.ts` beside the limits,
because **three surfaces have to agree**: the rail's counter, the overlay's counter and the server gate. Regex-based
rather than `DOMParser` **on purpose** — the identical function has to run in the browser and on the server, and
agreement is the entire point. A tag boundary becomes a *space*, so `<p>Alpha</p><p>Beta</p>` is not one
ten-character word; entity decoding covers numeric escapes and a handful of names, of which only `&nbsp;` really
matters (editors emit it constantly and 6 characters for a space is absurd — the long tail is one character either
way). The type marker rides on `FieldGuardrail` as `richtext: true`, set in `componentFieldRules`: the only place
that sees both the declared type *and* the field path, since by check time there are only args, where richtext is an
indistinguishable HTML string. A brief override can change the number but **not** how the value is measured.

**The canvas counter only knew about brief-configured fields.** Built from `guardrails.fields` alone, so on a
registry whose limits all come from component contracts — SS&C, every one of them — the overlay showed no counter
while the rail showed one and the server enforced it. Same class of gap as E.9's original `maxLength`-only read. Now
built from the component declarations too and keyed **per block**, because `title` is 60 on one component and 80 on
another and a flat map showed one block the other's number.

**Two process notes.** The root `tsc --noEmit` passed while `next build` caught a real type error — `src/app`
type-checks under its own tsconfig, so app-layer changes need the Next build. And the existing suite correctly failed
on a fixture asserting `bodySlot: { maxLength: 240, required: true }`, which now carries `richtext: true`; the
expectation was updated rather than worked around.

### F.3 — The React sentinel tracer

Extend `slot-probe.ts`'s existing sentinel technique to record *where* each mark landed. **This is where coverage
gets measured.** Consume it through the same F.2 surface, so a missing trace degrades to *nothing* rather than to
a broken affordance.

**The trap to avoid:** building the tracer *for* inline editing. Build it for hover-linking and ordering, where
partial coverage is a win and absence is invisible, and let inline editing on React be the payoff if the measured
numbers earn it. Handlebars users are not waiting on that number.

### F.4 — LLM-populated field annotations (parallel)

`FieldAnnotation` was built for hand-authored labels/help/groups and nobody hand-authors them. Generate at build
time from source + screenshot into a checked-in, editable artifact. Biggest lever on missing help text; asks
authors for nothing; docgen already carries TSDoc into `description`, so generation only fills gaps. **Worth
doing after guest testing**, because guest confusion is the evidence for which fields actually need help.

Also the home for the **config-lock name heuristic**: `content-only.ts` guesses at config declared as a bare
string (`anchor`, `*Theme`) because nothing declares config-ness. An annotation could, and then the guess goes.

### F.5 — Render the options instead of naming them (internal)

Miniature renders per enum/boolean value, pick by sight. The direct fix for the opaque-parameter complaint, needs
no tracer, machinery already exists (`m.update(props)`). Vary one prop at a time — two enums crossed is a matrix,
not a picker. **Internal-only now**: invites lock config, so guests never see an enum.

### F.6 — The unglamorous pass (internal)

Styling/layout/grouping; wire up `SlotMetadata.rules` (modelled, only `ImageField` reads it) and
`SlotCapability.threw` as validation; undo/redo + per-field revert; surface `previews` as a *start from* strip
(today only the first is used, to seed data). Most of the felt improvement for internal authors, no new
machinery — but it grooms the rail, and F.2 may change what the rail is *for*, so it comes after.

---

**Prerequisites: both cleared.** `F.-1` closed the capture bug that gated any phase which *writes* — unfeedable
preview values went 86 → 0 on 8x8, normalised at the sync boundary. Nothing in the catalog is now a field inline
editing would write into and silently lose. The config lock shipped too, which is what makes the traceable set and
the guest-editable set the same thing.

## Phase D — Outbound export (ship assets to Jira / Asana / CMS / Figma)

Nothing exists today (Figma is inbound-only; sync is Handoff-internal registry ⇄ workspace). Build a
**publish/export surface** on the existing event backbone rather than bolting on per-integration code.

- **D.1 Export abstraction:** a `publish(target, resource)` interface with per-target adapters; targets
  register capability (create issue / attach asset / create page / push frames).
- **D.2 First adapters (sequence by demand):** Jira (issue + design-brief/spec attachment — the
  Atlassian MCP + `handoff_export_design_md` already produce the brief), then Asana, then CMS
  (WordPress/Gutenberg — note the WP *asset-source* enum is inbound, unrelated), then push-to-Figma.
- **D.3 Provenance on export:** record what was shipped where (extends the sync/event model), so a
  design artifact or pattern carries its outbound lineage. ⚠️ **Track-6 seam:** this is the natural
  join with the MCP-driven "author → verify → ship" arc — export should be reachable as MCP tools too.

---

# Part 3 — Onboarding & provisioning installer

Productization layer: stand up a new Handoff deployment (per-client registry) with Postgres + Blob
wired **automatically**, so adopters other than Brad — and Brad's own per-client rollouts — don't
hand-wire infra. Decoupled from Parts 1–2; must never block them.

**Principle: the installer orchestrates; the user authenticates and consents.** No resource is
provisioned into a user's account without an explicit, cost-surfaced yes ("this creates a billable Neon
DB + Blob store on *your* Vercel account"). Re-runs are idempotent — detect and wire existing resources,
never duplicate (critical when re-provisioning a half-set-up client).

- **3.1 `handoff init` CLI — FIRST (Brad's priority).** Extend the existing Handoff CLI with a
  provisioning command: Vercel auth/link → provision **Neon** (`vercel integration add neon` Marketplace,
  or Neon API) → create + connect a **Blob** store (injects `BLOB_READ_WRITE_TOKEN`) → `vercel env pull`
  → migrations auto-run on boot → seed → deploy. Takes a client/project name so each deployment gets
  isolated DB + Blob (matches the per-deployment isolation model today). The agency-scale accelerator for
  spinning up client registries.
- **3.2 Deploy Button + template — LATER.** A template repo declaring required storage integrations so a
  non-technical adopter clicks Deploy, Vercel walks them through connecting Neon + Blob, env vars inject
  automatically. Zero CLI. Lower-control, higher-reach counterpart to 3.1.
- **3.3 Spike (prerequisite for 3.1).** Confirm which provisioning steps are stable as CLI subcommands
  (`vercel blob store add`, `vercel integration add neon`) vs REST API in current Vercel CLI (57.x), so
  3.1 targets stable surfaces. Small; do before building 3.1.

⚠️ Depends on nothing in Parts 1–2, but **benefits from Phase 1**: once images live in Blob a fresh
install needs a Blob store from first boot — 3.1 provisions it as a standard part of setup.

---

## Sequencing summary

| Phase | Theme | Gate before next |
|---|---|---|
| 0 | Quick DB wins (indexes, projections, status-poll, pooler config, playground parallel) | ships alone |
| 1 | Images → Vercel Blob (+ backfill) | 0 done |
| 2 | Pagination, bounded feeds, driver ADR, caching | 1 done |
| A | Ownership + authz in shared cores + policy layer | **hard gate** for all of Part 2 |
| B | Visibility enum + share links + grants | A done |
| C | Lifecycle, library org, concurrency, attribution | A done (B parallel) |
| D | Outbound export adapters on the event backbone | A done; demand-driven |
| E | Pages as documents; one save path; templates as the shared object | B done; E.1 → E.3 → E.2 → E.5 |
| E.6 | Invite to Build: briefs, built pages, publication record ([spec](INVITE-TO-BUILD.md)) | E.5 done |
| F | Direct manipulation: form polish → rendered option pickers → field tracer → inline editing | none for F.0/F.1/F.4; F.2 after F.1; F.3 needs F.2 coverage + preview-capture fix |

**Open decisions (not blocking Phase 0):**
- C.3 concurrency: optimistic-lock only, or invest in real-time multiplayer? (Recommend lock-first.)
- D.2 adapter order — driven by which integration you demo first.
- Whether the policy layer (A.3) ships with a latent `orgId` param now or is refactored in if/when a
  multi-org tier is ever greenlit.
