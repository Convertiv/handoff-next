# handoff-app — DEVLOG

Reverse-chronological running journal (newest at top). Decisions, state, gotchas, learnings.
Complements `CLAUDE.md`/`ROADMAP.md` (stable) and `docs/` specs. Whoever works this repo appends here.

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
