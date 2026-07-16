# P1.6 kickoff — multi-axis theming in handoff-app (storage · resolve · serve · Figma routes)

**Branch:** work **directly on `feature/mcp-prototype`** (Brad, 2026-07-16 — no sub-branch; this
is the active integration branch). · **Profile:** A
**Upstream:** consumes `handoff-core@feature/multi-axis-theming` (the `Dtcg.*` namespace).
**Parent design:** `../handoff-figma-plugin/docs/rfc-001-multi-axis-theming-figma-sync.md` (RFC-001)
and `../handoff-core/docs/p1-kickoff-multi-axis-theming.md`.

> **Hard rule:** no commit/push without Brad's approval — leave changes in the working tree.
> Build incrementally; append a `DEVLOG.md` entry before finishing.

## What P1 (handoff-core) already gives you

A pure, tested `Dtcg` engine (`import { Dtcg, Types } from 'handoff-core'`):
- `Dtcg.buildDtcgSourceFromFigmaSnapshot(snapshot, mapping) → { source, diagnostics }`
- `Dtcg.resolveTokens(source, { brand, scheme, … }) → DtcgGroup` (resolved literal tree, shape
  == today's per-brand tree — back-compat)
- `Dtcg.diffDtcgSource(next, prev) → DtcgChangeset` (originalId-keyed, stamps `syncState`)
- `Dtcg.serializeDtcgSource(source)` / `Dtcg.resolveAndFormat(source, selector, {format})`
  (`css|scss|map|style-dictionary`, units from `$type`)
- Types: `Types.DtcgSource`, `Types.DtcgToken`, `Types.FigmaFoundationsSnapshot`,
  `Dtcg.AxisMappingConfig`, `Types.Diagnostic`.

## Dependency (settled — Brad, 2026-07-16)

The `^0.2.0` pin is a non-issue: `0.2.0` was just a re-release of `0.1.0` (the original release
was corrupted) — no divergent code to reconcile. **Plan:** this initiative's handoff-core work
lands as a fresh **`0.3.0`** that rethinks the engine; app + plugin are both being rebuilt, so
**correctness is guaranteed by testing handoff-app and handoff-figma-plugin against the branch**,
not by matching the old pin.
- **Dev:** `"handoff-core": "file:../handoff-core"` (siblings under `Projects/Handoff/`).
- **Checkpoint pin:** `"git+https://github.com/Convertiv/handoff-core.git#feature/multi-axis-theming"`.
- When the engine stabilizes, cut `0.3.0` and repoint to the version.

## Ground truth to work from (from 2026-07-16 scope)

- Tokens = JSONB, not per-token rows. Canonical `handoff_registry_dtcg` singleton
  (`src/app/lib/db/schema-pg.ts:690-701`) with `dtcg` + **`brands`** jsonb + precompiled
  `css/scss/tailwind`. Migrations `0010_registry_dtcg`, `0011_dtcg_brands`.
- Registry serves **opaque precompiled bytes; no resolution registry-side** (ADR-001 §2). Our
  hybrid decision keeps that hot path; the resolver is for query/viz only.
- Leaf `$value` = literal; `$extensions.handoff.reference` = CSS var name (not a DTCG alias);
  **`originalId`/`syncState` are dropped registry-side**. `dtcg-normalizer.ts` **dedups across
  brands** (first-seen-wins) — must be bypassed for multi-axis.
- Brand axis works end-to-end (storage → `getDtcgBrands()` → brand switcher in
  `components/Foundations/ColorsDisplay.tsx`); **scheme axis absent everywhere**.
- Device-code OAuth exists (`/api/oauth/*`); scope `figma:sync` **defined but unenforced**; the
  one Figma route (`/api/handoff/figma/component-properties`) uses `authOrCloudToken`.

## Scope & sub-sequencing

### P1.6a — Storage & migration
- New migration: add a **reference-preserving source-of-truth column** to
  `handoff_registry_dtcg` (e.g. `dtcg_source jsonb` holding a `Types.DtcgSource`), and make
  `brands` **axis-aware** (persist the `axes[]` + per-axis values; legacy literal `brands` map
  reads as `{ brand:<name>, scheme:"default" }`).
- **Persist `originalId` + `syncState`** on token leaves (first-class) — required for
  `diffDtcgSource` on re-push.
- Back-compat: additive columns only; existing registries keep rendering from precompiled
  bytes. **No forced re-ingest** — a registry stays single-axis/literal until it re-pushes.

### P1.6b — Resolve + query (REST & MCP)
- Add generic axis params (`?brand=&scheme=&…`) to `/api/registry/dtcg` (+ tokens); when
  present, return `Dtcg.resolveTokens(source, selector)`; when absent, default axes / full tree.
- MCP `handoff_get_tokens`: extend input to `{ brand?, scheme?, include? }`; call the resolver
  (it currently never touches `getDtcgBrands()`). Same for `handoff_export_design_md`.
- Generalize `dtcg-normalizer.ts` to stop collapsing brands (carry axis provenance).

### P1.6c — `/api/figma-plugin/*` routes (the plugin contract)
Build the namespace RFC §3d specifies, each **scoped via `verifySyncAuth` + `requireScope`**,
and **enforce `figma:sync`** (retire `authOrCloudToken` on the Figma path):
- `POST /api/figma-plugin/auth/device`, `/auth/token`, `/auth/revoke` → map onto existing
  `cli-device-oauth`; issue scoped JWTs.
- `POST /api/figma-plugin/foundations/preview` → body = `Types.FigmaFoundationsSnapshot`
  (+ saved mapping config); run `Dtcg.buildDtcgSourceFromFigmaSnapshot` then
  `Dtcg.diffDtcgSource` vs stored source; return changeset + diagnostics. **No writes.**
- `POST /api/figma-plugin/foundations/commit` → persist the curated `DtcgSource` + team-shared
  `AxisMappingConfig`; append `handoff_token_change`.
- `GET /api/figma-plugin/foundations?brand=&scheme=` → resolved slice for pull-to-canvas (later).

### P1.6d — Visualization
- Extend the colors-page brand switcher with a **scheme toggle** → brand × scheme matrix.
- Store the team `AxisMappingConfig` so repeat syncs + a future headless REST sync reuse it.

## Hand-off to the plugin (P3/P4)
The plugin depends on: the `/api/figma-plugin/*` shapes above, the `Types.FigmaFoundationsSnapshot`
it must emit, and the `preview` changeset shape it renders in the curate UI. Keep these stable
and documented in this DEVLOG as they land.
