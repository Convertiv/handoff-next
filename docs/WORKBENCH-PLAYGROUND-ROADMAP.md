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

## Phase 2 — Robustness & scale headroom

- **2.1 Pagination** for the Library (cursor on `updated_at,id`) — replace the hard `limit 200`.
- **2.2 Bounded feeds:** add `LIMIT` + cursor to `fetchSyncChangesSince` (`sync-queries.ts:63`) and the
  append-only `sync_event` / `event_log` reads; consider retention/rollup for the change-log tables.
- **2.3 Driver decision:** benchmark `@neondatabase/serverless` (HTTP) vs tuned `postgres-js` for cold
  serverless latency; adopt whichever wins. Document in an ADR.
- **2.4 Caching:** short-TTL cache on read-heavy list endpoints keyed by user+visibility; verify the
  workbench server-render uses `getComponentSummaries()` (never jsonb `data`) not `getComponents()`.
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

## Phase A — Ownership & authorization consistency *(must precede any feature work)*

- **A.1 Unify the ownership model.** Ensure `handoff_pattern` and any user-authored content carry a
  non-null `owner_user_id`; backfill existing rows (attribute to admin/creator where known).
- **A.2 Enforce authz *inside the shared write cores*, not just routes.** Add ownership/permission
  checks in `pattern-write.ts` and `doc-pages.ts` so **both** the browser server-actions path and the
  MCP path are covered. ⚠️ **Track-6 seam:** MCP writes are currently scope-gated but **not
  ownership-gated** — closing this in the core is what keeps the MCP cycle from bypassing it.
- **A.3 Introduce a thin policy layer** (`can(user, action, resource)`) both cores + routes call, so
  authorization logic lives in one place. Design its signature to accept a future `orgId` without churn.
- **A.4 Audit every pattern/page route** for the missing owner filter (list, `[id]`, clone, delete).

**Exit:** no route or MCP tool can read/mutate content the actor doesn't own or isn't shared with.

## Phase B — Sharing & visibility

- **B.1 Unified visibility enum** across patterns, design artifacts, and (where relevant) doc pages:
  `private` → `team` (all authenticated users in the deployment) → `public`. Replaces the one-off
  `public_access` boolean; migrate it to the enum.
- **B.2 Share links with tokens** (revocable, optionally expiring) — generalizes the existing
  public-share page (`design/library/[id]/share/`) beyond binary public, and covers patterns too.
- **B.3 Lightweight per-resource grants** (share *with specific teammates*, view vs edit). This is the
  seam an org/role tier would later plug into; keep it minimal now (owner + explicit grants + team + public).
- **B.4 Public read paths** stay a *safe field subset* (the design-artifact `/public` route is the model).

## Phase C — Workbench & playground multiplayer UX

The usability layer that makes producing assets intuitive.

- **C.1 First-class object lifecycle:** create / save / duplicate / rename / delete, with **draft vs
  published** state, consistent across both surfaces.
- **C.2 Library organization:** folders/collections, tags, search, sort, owner/shared/public filters,
  pagination (built on Phase 2.1). Applies to both patterns and design artifacts.
- **C.3 Concurrency safety:** at minimum optimistic-lock (version/`updated_at` check) with a clear
  conflict UI; evaluate soft-lock ("X is editing") before any real-time CRDT investment. The write
  cores already emit `edit_history` + `sync_event` per write — lean on that for conflict detection.
- **C.4 Attribution & activity:** show owner/last-editor, recent activity, and per-object history
  (surfacing `edit_history` / `*_change` tables that already exist).

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

**Open decisions (not blocking Phase 0):**
- C.3 concurrency: optimistic-lock only, or invest in real-time multiplayer? (Recommend lock-first.)
- D.2 adapter order — driven by which integration you demo first.
- Whether the policy layer (A.3) ships with a latent `orgId` param now or is refactored in if/when a
  multi-org tier is ever greenlit.
