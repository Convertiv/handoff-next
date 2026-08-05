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

### E.2 — One save path; templates as the shared object

**Partly shipped 2026-08-05, with three corrections outstanding** (found by Brad testing it).

Shipped: `savePageAsTemplate` (a separate, **frozen**, team-visible copy — the page carries on as the
author's own), the freeze guard in `patchPattern`, save-on-first-block + autosave so dynamic mode has no
save button, clone-of-a-template recording `template_id`, and "page" wording.

**Still to do, in this order:**

- **E.2a — Share from the library.** The blocker: `AssetInspector` (which now hosts `ShareLinkPanel`) is
  consumed *only* by the playground's `PatternPicker` dialog. The library has no inspector and therefore no
  way to share anything — so a template, the object whose whole purpose is being sent out, cannot be shared
  from the place it lives. Wire the inspector (or at least the share panel) into `/library`, and give
  templates a visible identity + filter there.
- **E.2b — Templates are read-only in the editor.** The freeze is enforced server-side but nothing says so
  in the UI: you can edit a template's canvas, and the refused write surfaces only as "Not saved". Opening a
  template must present a read-only canvas plus **Use this template** (clone → new page, which the existing
  `/clone` route already does), and autosave must not attempt a write it knows will be refused.
- **E.2c — Drop the "Saved pages" control.** Opening a page belongs in the library, not in a modal inside
  the builder. Remove the `FolderOpen` control and retire `PatternPicker` once E.2a means the library can
  open *and* share. (This is the control Brad asked to drop; it is still there.)
- **E.2d — ✅ DONE 2026-08-05.** `TemplateManager`, `saveAsTemplate`/`loadTemplate`/`deleteTemplate`, the
  `templates` state and the `Template` type are gone, plus a one-time `purgeRetiredLocalTemplates()` sweep of
  the `handoff-playground-template-*` keys. Data loss accepted deliberately: `saveAsTemplate` returned early
  whenever `isDynamicApp`, which has been hardcoded `true` since static export was removed — so only a
  pre-removal build could ever have written one.

### E.3 — `playground/{page}` as a real route, autosaved, no local storage

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

### E.4 — Guardrail editor for templates

Slice 3 enforces `template.data.guardrails` in three places (editor, submit, review) but nothing *sets* it
from the browser — today it is a JSON field. Now that a template is a real, frozen object with its own
inspector, that inspector is where per-field limits, required flags and the alt-text severity belong. Small
and high-leverage: it is what lets Craig and Andrew define the rules SS&C asked for without editing JSON.

**Sequencing:** E.1 ✅. E.3 ✅ (before E.2, because "one save path" is only coherent once the record is the
source of truth). E.2 → **E.2b, E.2a, E.2c, E.2d** in that order: fix the template-editing defect first
because it is wrong behaviour on an object that already exists, then unblock sharing, then remove the
control the library replaces. E.4 last, since it needs the template inspector E.2a builds.

## Phase F — Direct manipulation in the playground editor (Brad, 2026-08-05)

Full design: **`docs/PLAYGROUND-DIRECT-MANIPULATION.md`**. Distinct from `PLAYGROUND-EDITING.md`, which
covers AI-proposed edit *operations*; this is the human editing surface — the left-rail form.

The field editor works and is not slick. Three complaints with three different fixes: fields arrive in
schema order with patchy help text; block-builder parameters (`light`/`dark`, `left`/`right`, overlay) can't
be explained by a label as well as by being *seen*; and the form is visually rough. Constraint throughout:
components stay arbitrary production React/Handlebars — **no Handoff authoring sauce may be required.**

**The reframe.** Don't detect props in the DOM (intractable on arbitrary code). **Mark the values before
render and find the marks after** — the component's own render is the oracle. Zero-width sentinels for text,
a `?__hf=` query param for URLs, and deliberately *no* tracing of enums/booleans/numbers (a sentinel there
corrupts a class name or flips a branch). This is `slot-probe.ts`'s existing technique extended to record
*where* the sentinel landed. The exclusion is the design, not a limitation: tracing works on exactly the
props worth editing inline and fails on exactly the props where inline editing is meaningless — so the
surface is a hybrid, **content inline on the canvas, configuration as rendered choices in chrome.**

- **F.0 — the unglamorous pass.** Styling/layout/grouping; wire up `SlotMetadata.rules` (modelled, only
  `ImageField` reads it) and `SlotCapability.threw` as validation; undo/redo + per-field revert; surface
  `previews` as a *start from* strip (today only the first one is used, to seed data). Most of the felt
  improvement, no new machinery.
- **F.1 — render the options instead of naming them.** Miniature renders per enum/boolean value, pick by
  sight. The direct fix for the opaque-parameter complaint, needs no tracer, machinery already exists
  (`m.update(props)`). Vary one prop at a time; two enums crossed is a matrix, not a picker.
- **F.2 — the tracer, consumed for orientation only.** Bidirectional hover linking (panel ⇄ canvas),
  automatic field ordering by document position (the real fix for "fields come in the order they come in"),
  and dead-prop/impact detection for free ranking. Every consumer degrades to *nothing* when a trace is
  missing. **This is where coverage gets measured** — expect 60–80% of text/image props.
- **F.3 — inline overlay editing.** Absolutely-positioned overlay over the traced node's bounding box,
  never `contenteditable` on the component's own node (React reconciliation eats it; see the caret-loss note
  in `RichTextField.tsx`). Identical path for React and Handlebars.
- **F.4 — LLM-populated field annotations** (parallel). `FieldAnnotation` was built for hand-authored
  labels/help/groups and nobody hand-authors them. Generate at build time from source + screenshot into a
  checked-in, editable artifact. Biggest lever on missing help text; asks authors for nothing; docgen already
  carries TSDoc into `description` so generation only fills gaps.

⚠️ **F.3 has a hard prerequisite outside this phase:** `field-lens.ts` documents that stored preview values
are serialized render *output, not input props*, and the fix is repairing capture. F.3 is the first phase
that writes, so it inherits that bug; F.0–F.2 only read and are unblocked.

**The trap to avoid:** building the tracer *for* inline editing. Build it for hover-linking and ordering,
where partial coverage is a win and absence is invisible, and let F.3 be the payoff if the measured numbers
earn it.

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
| E | Pages as documents; one save path; templates as the shared object | B done; E.1 → E.3 → E.2 |
| F | Direct manipulation: form polish → rendered option pickers → field tracer → inline editing | none for F.0/F.1/F.4; F.2 after F.1; F.3 needs F.2 coverage + preview-capture fix |

**Open decisions (not blocking Phase 0):**
- C.3 concurrency: optimistic-lock only, or invest in real-time multiplayer? (Recommend lock-first.)
- D.2 adapter order — driven by which integration you demo first.
- Whether the policy layer (A.3) ships with a latent `orgId` param now or is refactored in if/when a
  multi-org tier is ever greenlit.
