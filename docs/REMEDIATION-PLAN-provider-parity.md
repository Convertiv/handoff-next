# Remediation Plan — Workspace ⇄ Registry Parity & Token Source of Truth

**Last updated:** 2026-06-20
**Branch:** feature/mcp-prototype

---

## 0. Diagnosis (confirmed, not theorized)

The reported problems reduce to **one disease**: Handoff maintains redundant parallel data paths, and nothing enforces that both halves stay in sync. A fix applied to one path silently leaves the other broken. Two concrete manifestations:

### Face 1 — two token data sources
`handoff_tokens_snapshots` (append-only Figma `localStyles`) and `handoff_registry_dtcg` (singleton DTCG). The `dtcg/route.ts` was previously calling `insertTokensSnapshot(body.dtcg)`, appending a DTCG-shaped row to the same table the visual displays read. `getDbTokensSnapshot()` returned the latest row regardless of shape, so DTCG always won → no `localStyles` → blank colors/typography.

### Face 2 — two navigation builders
`staticBuildMenu` (filesystem) and `DynamicDataProvider.getMenu` (DB + skeleton) were diverging on icons, utility links, empty-section handling, and component catalog injection.

---

## Phase 1 — Restore the token data feed ✅ DONE

1. ✅ `getDbTokensSnapshot()` now filters for the `localStyles` shape specifically (jsonb presence check), so a DTCG row never masks the Figma snapshot.
2. ✅ `dtcg/route.ts` decoupled — no longer writes to `handoff_tokens_snapshots`. That table is now Figma-only.
3. Foundation pages now read from `fetchDtcgTokenStrings()` directly (spacing, grid, effects, border-radius, motion, focus, elevation, typography, colors).

**Outstanding from Phase 1:**
- ⬜ **Push failure verbosity** — `pushRegistryTokens` warns+returns when `public/api/tokens.json` is missing; `push:all`'s `tryStep` swallows it. Make a missing tokens push a hard, visible failure.
- ⬜ **Doc path drift** — `push-all.ts`, `developer/cli/page.tsx`, `developer/push-pull/page.tsx` still say `tokens/tokens.json`; code reads `public/api/tokens.json`.

---

## Phase 2 — Navigation parity ✅ DONE

1. ✅ Icon passthrough in `menu-merge.ts childToSubSection` — icon spread in place.
2. ✅ Foundations skeleton in `dynamic-provider.ts` includes all icons (palette, type, rulers, grid, sparkles, shapes, image, square, zap, focus).
3. ✅ `MenuIcon` switch has `square`, `zap`, `focus` cases.
4. ✅ Skip-empty guard on the Knowledge branch of SideNav — sections with no path and no subSections are skipped.
5. ✅ `injectSystemUtilityLinks` moved to `menu-merge.ts` and called from both `DynamicDataProvider` and `StaticDataProvider` — Overview/Health/Changelog/Tokens always appear in Design System sidebar.

**Minor open item:**
- ⬜ `config/docs/guidelines.md` is a bundled default. Per the IA decision, nav sections should be site-specific only. Either remove the bundled file (workspace authors provide their own `pages/guidelines.md`) or make it opt-in via config. Low urgency since the skip-empty guard prevents a spurious header.

---

## Phase 2.5 — Workspace component sidebar (path resolution) ⬜ OPEN

`staticBuildComponentMenu()` reads from `getPublicApiDir()/components.json` = `process.cwd()/public/api/components.json`. When the workspace Next.js dev server or Vercel build runs from the materialized `.handoff/app` directory, this resolves correctly. When `process.cwd()` is the project root (e.g. Vercel without Root Directory configured), `components.json` isn't found → `fetchComponents()` returns `[]` → no component groups appear in the Design System sidebar (utility links from Phase 2 still show correctly).

Fix options (pick one):
1. **Fallback path** — when `getPublicApiDir()` returns a path that doesn't exist, retry with `HANDOFF_WORKING_PATH/.handoff/app/public/api` before returning empty. Near-term, low-risk.
2. **Async DataProvider interface** — add `getComponentSummaries()` to the `DataProvider` interface so both providers use the same async path (static reads filesystem, dynamic reads DB), and the menu builder is fed from whichever is available. Right long-term architecture.

---

## Phase 3 — IA consolidation ✅ DONE

1. ✅ `/assets` moved to `/foundations/assets`; `/assets/page.tsx` redirects to `/foundations/assets`.
2. ✅ `/system/tokens/*` route group deleted. All nav paths pointing at `/system/tokens/*` updated:
   - `injectSystemUtilityLinks` Tokens link → `/foundations`
   - `staticBuildTokensMenu()` replaced with a no-op stub; `tokens: true` in system.md frontmatter is now a no-op — the old submenu is gone
   - `dynamic-provider.ts` `tokens()` resolver returns `[]`
   - Known-paths list in `util/index.ts` cleaned of all `system/tokens*` entries

---

## Phase 4 — DTCG as canonical source of truth ✅ MOSTLY DONE

1. ✅ `getDbTokensSnapshot()` filters by `localStyles` shape; DTCG decoupled from snapshot table.
2. ✅ All foundation pages read from `fetchDtcgTokenStrings()`.
3. ✅ DTCG push (`POST /api/registry/dtcg`) is the canonical write path.
4. ✅ `tokens:build` CSS brand parser (resolvet + hagyard → DTCG); brand metadata in manifest.
5. 🔶 `getTokens()` still used by some non-foundation displays (design page, settings). These eventually need to read from DTCG or be retired. Not blocking for Phase 5.

**Outstanding (Phase 5 prerequisites — do not close until Phase 5 is complete):**
- ⬜ **Retire `localStyles` runtime dependency** — `foundations/colors`, `foundations/typography`, and `foundations/effects` pages still call `getTokensForRuntime()` to get `tokens.localStyles`. Once Phase 5 wires these displays from DTCG, remove those calls and the `DynamicDataProvider.getTokens()` / `getDbTokensSnapshot()` code path.
- ⬜ **Normalization layer for importers** — Figma/Token Studio/Penpot all normalize into DTCG at the edge. Currently only the CSS brand parser exists; Figma `localStyles` import is still a parallel path. Address after the localStyles retirement above.

---

## Phase 5 — Display reconciliation ✅ MOSTLY DONE

The original scope was Colors + Typography. Code audit reveals Icons and Logos had the same problem: new UI was invented instead of extending existing patterns. All four addressed together.

### 5a — Colors ✅ DONE

- ✅ **Fix hardcoded `rgba(0, 49, 82, 1)` in `ColorGrid.tsx:127`** — now copies `hexToRgbaCss(color.value)`.
- ✅ **Lead-display** — removed `BrandColorSwatches` (separate model); created `ColorsDisplay` client component that maps DTCG brand tokens → `IColorObject[]` and feeds `ColorGrid` with brand-selector tabs for multi-brand registries.
- ✅ **Removed `getTokensForRuntime()` / `localStyles`** from colors page — DTCG brands are the sole color source.
- ⬜ **Wire `ColorSheet` placeholders** — description and Figma breadcrumb still hardcoded; needs DTCG metadata enrichment (deferred).

### 5b — Typography 🔶 PARTIAL

- ✅ **Added `PrevNextNav`** (Colors → Typography → Spacing chain).
- 🔶 **`getTokensForRuntime()` still called** for Typefaces + Scale specimen sections. Full DTCG migration of typography requires composite token support (`$type: typography` with structured `$value`). Current DTCG model stores each property as a separate flat token, so specimens can't be reconstructed. Blocked pending DTCG typography composite token format decision.
- ⬜ **Wire `TypographySheet` placeholders** — description + Figma breadcrumb hardcoded; needs DTCG metadata.

### 5c — Icons ✅ DONE

- ✅ Replaced custom H1/button header with `InlineEditHeader` (established pattern).
- ✅ Added `PrevNextNav` (Icons → Logo).
- ✅ Kept `IconCatalogGrid` for display — icons are catalog data, not tokens; no DTCG/ProvenanceBadge applies.

### 5d — Logos ✅ DONE

- ✅ Added `PrevNextNav` in both LogoSet and legacy rendering branches (Icons → Logo).
- 🔶 `getTokens()` legacy fallback retained for workspaces without a pushed LogoSet (low priority to remove).

### 5e — Sign-off

- ⬜ Visual sign-off with you, both providers (workspace + registry), all four display types.

---

## Phase 6 — Guardrails ⬜ OPEN

1. ⬜ **Registry parity smoke test** (extend task #54): seed a test Postgres, render every foundation page + System nav in registry mode, assert non-empty visuals + token cards + nav icons + System body.
2. ⬜ **Reframe AGENTS.md** — document DTCG as canonical source of truth; table ownership (no cross-writing); dual-path failure mode as a first-class hazard; parity checklist (both providers ✓, push fails loudly ✓, seeded-registry smoke test ✓).

---

## Bug Queue

These are confirmed bugs to fix before or during the phases above.

### B1 — Border-radius: 10 tokens, 1 display ⬜

`parseRadiusTokens()` in `foundations/border-radius/page.tsx:19-32` does a flat `Object.entries(obj)` assuming DTCG is `{key: {$value}}`. The resolved DTCG from Style Dictionary wraps tokens under a `border-radius` group key: `{"border-radius": {"0": {$value}, "1": {$value}, ...}}`. The parser sees only the outer wrapper → extracts `$value = undefined` → one 0px token displayed.

**Fix:** same approach as the spacing page — unwrap the top-level group key, then `flattenDtcgLeaves` recursively.

### B2 — Focus page: server component error ⬜

`foundations/focus/page.tsx` throws a server component error at runtime. `React.CSSProperties` is referenced as a return type on line 36 but `React` is not imported — likely the surface symptom. Needs a reproduction + stack trace to confirm root cause.

### B3 — CLI button hidden on workspace/local ⬜

`showDevelopLocally` in `Header.tsx:77` is gated on `authEnabled && Boolean(session?.user)`. In workspace mode, auth is disabled → `authEnabled = false` → button never shows. Per product intent, the CLI button should appear unconditionally (or at minimum in workspace mode) since local setup is the primary use case for workspace users. Fix: show the button when `!authEnabled` (workspace) OR when `authEnabled && session?.user` (authenticated registry user).

### B4 — Figma asset fetch integration ⬜

We built an asset-fetch system that pulls images from Figma and populates them into the asset DAM. Currently it's a separate flow from the existing Figma fetch controls (`handoff-app fetch` CLI / OAuth UI). These should be unified: the Figma asset fetch should be triggerable from the same fetch control surface (CLI command and the registry UI OAuth fetch panel) rather than a standalone mechanism. Design the integration point; implement the unified fetch command and UI hook.

---

## Feature Queue

### F1 — Figma asset fetch integration (see B4 above)

Surface the Figma-to-DAM asset fetch through the existing `handoff-app fetch` CLI command and the registry OAuth fetch UI. Assets fetched should land in the DAM and be versioned in the same changelog feed as other push events.

### F2 — Registry logo customization ⬜

As part of the theme upload flow, allow registry admins to upload a custom logo that replaces the default Handoff wordmark in the header. Needs:
- A logo upload field in the registry settings / theme panel.
- Storage in `handoff_registry_theme` (or a new `handoff_registry_logo` table if binary size is a concern).
- The `Header.tsx` logo to read from the stored value (falling back to the default wordmark).
- Push/pull support so the workspace can send a logo via `push:all` and the registry renders it.

---

## Open items from task backlog (to be scheduled)

| # | Task | Phase / Area |
|---|---|---|
| T12 | Metadata diff/conflict handling on push | Sync |
| T23 | Cynosure: diff V1 vs V2 API output JSON schema | Cynosure |
| T24 | Cynosure: upgrade handoff-app to V2 | Cynosure |
| T25 | Cynosure: verify WordPress compiler produces valid Gutenberg blocks | Cynosure |
| T26 | Cynosure: create Tailwind+Handlebars stack guide and MCP config | Cynosure |
| T61 | Chat flow: token lookup ("what token should I use for X?") | Chat |
| T62 | Chat flow: component comparison ("compare X and Y") | Chat |
| T63 | Chat session persistence (localStorage) | Chat |
| T64 | Chat suggestion chips: dynamic chips based on page context | Chat |
| T65 | Validation re-run trigger from ChatValidationPanel | Validation |
| T77 | Component brand tagging — frontmatter + registry filter | Components |

---

## Strategic decisions (resolved)

- **DTCG is the single canonical token source of truth.** Importers normalize into DTCG; UI + REST + MCP all read DTCG. Figma `localStyles` snapshot demotes to a transient import format.
- **Nav sections are site-specific only.** No bundled default sections (e.g. guidelines.md); a section appears only if the workspace authors a page.
- **IA:** Drop `/system/tokens` nav; Assets/DAM lives under `/foundations/assets`.
- **Display pattern:** All foundation pages follow the same component conventions (InlineEditHeader → content → DownloadTokens → ProvenanceBadge → TokenOutputTabs). No parallel UI models.

---

## Open questions

1. **Token-change history ownership** after DTCG becomes fully canonical: diff DTCG into a DTCG-scoped change record; during the Phase 1 bridge, Figma-token snapshot owns the diff.
2. **`/system/tokens/*` removal** — confirm no external links or workspace-side references before dropping the route group.
3. **Figma asset fetch** — confirm whether assets are fetched per-component or per-library; this affects the CLI command signature and the push/pull payload shape.
