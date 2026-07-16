# handoff-app — DEVLOG

Reverse-chronological running journal (newest at top). Decisions, state, gotchas, learnings.
Complements `CLAUDE.md`/`ROADMAP.md` (stable) and `docs/` specs. Whoever works this repo appends here.

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
