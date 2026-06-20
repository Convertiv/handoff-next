# Remediation Plan — Workspace ⇄ Registry Parity & Token Source of Truth

**Status:** Proposed (awaiting approval before code changes)
**Date:** 2026-06-20
**Branch:** feature/mcp-prototype

---

## 0. Diagnosis (confirmed, not theorized)

The reported problems reduce to **one disease**: Handoff maintains redundant parallel data
paths, and nothing enforces that both halves stay in sync. A fix applied to one path silently
leaves the other broken. Two concrete manifestations:

### Face 1 — two token data sources (causes blank foundations AND the changed colors/typography UI)

| Store | Shape | Written by | Read by |
|---|---|---|---|
| `handoff_tokens_snapshots` (append-only) | Figma `localStyles` (`color`/`typography`/`effect`) **or** DTCG object | `POST /api/registry/tokens` **and** `POST /api/registry/dtcg` | `getTokens()` runtime visual reads **and** token-diff history |
| `handoff_registry_dtcg` (singleton) | `css`/`scss`/`tailwind`/`dtcg` | `POST /api/registry/dtcg` | token cards + 6 newer foundation pages |

**Root cause:** `dtcg/route.ts:74` calls `insertTokensSnapshot(body.dtcg, 'push')`, appending a
**DTCG-shaped** row to the same table the visual displays read. `getDbTokensSnapshot()`
(`queries.ts:237-245`) reads the **latest** row regardless of shape. Since `push:all` runs the
DTCG step *after* the tokens step, the DTCG row is always latest → `getTokens()` returns an object
with **no `localStyles`** → effects/typography/colors visual displays map over `undefined` → blank.
The 6 newer pages (grid, spacing, border-radius, motion, focus, elevation) work everywhere because
they read **only** DTCG.

**Live confirmation (2026-06-20):** `hagyard.../api/registry/dtcg` fully populated;
`hagyard.../api/registry/tokens` has **no `localStyles`**, holding DTCG-shaped data.

### Face 2 — two navigation builders (causes the nav bugs)

- **Static** (`staticBuildMenu`, `util/index.ts:243`) passes `icon` and filesystem catalogs through.
- **Dynamic** (`DynamicDataProvider.getMenu`, `dynamic-provider.ts:458`) rebuilds the menu and drops
  `icon` (`menu-merge.ts childToSubSection:239-244`; skeleton `dynamic-provider.ts:486-494`) → no
  sidebar icons on the registry; and builds the System body via order-dependent injection that a
  DB-pushed `/system` node can overwrite with `[]` → System header shows, body empty on registry.
- `MenuIcon` switch (`SideNav.tsx:96-129`) lacks `square`/`zap`/`focus` cases → 3 foundation icons
  blank even locally.
- `guidelines.md` produces a top-level section with empty `subSections`, and the Knowledge branch of
  `SideNav` (207-232) has no skip-empty guard → spurious empty "Guidelines" header.

### On the colors/typography "degradation" — corrected

Earlier claim ("nothing was degraded") was too narrow: the **component files** `ColorGrid.tsx` /
`TypographyExample.tsx` are unchanged, but the **pages changed which components lead the display**.
- Colors (`foundations/colors/page.tsx`) now renders `BrandColorSwatches` (a new brand-swatch model)
  **above** the `ColorGrid` groups. On the registry, `ColorGrid` renders nothing (Face 1 empty
  `localStyles`), so only the new model shows — reading as a wholesale UI swap.
- Typography (`foundations/typography/page.tsx`) keeps the specimen + `TypographyExamples`, but the
  **desired target is cynosure V1**, which displays typography differently/better than even this
  repo's pre-rewrite version.
Net: there is a genuine display regression layered on the data bug. It gets its own phase (Phase 5).

---

## Strategic decision — DTCG as the single canonical token source of truth

Per the goals (one well-supported format powering UI + REST + MCP; normalize imports from Figma,
Penpot, Token Studio, etc.), **DTCG (W3C Design Tokens) is the canonical store.** Token Studio exports
it, Style Dictionary v4 (already in-pipeline) consumes/emits it, Figma Variables map to it.

Target architecture:
```
Figma / Token Studio / Penpot / manual  →  normalize-to-DTCG (edge importers)
                                         →  handoff_registry_dtcg  (single source of truth)
                                         →  UI + REST + MCP (all read DTCG)
```
The Figma `localStyles` snapshot demotes to a transient import format, not a runtime source.
**Crux task:** DTCG must carry the presentation metadata the polished UI needs (color group names,
contrast, font family/weight specimen data, usage). A gap analysis + enrichment of the DTCG
export/normalization is the central engineering effort (Phase 4). Phase 1 is a bridge to that.

---

## Phase 1 — Restore the token data feed (bridge fix; unblocks blank pages now)

Lowest-risk, no schema migration, no UI changes.

1. **Shape-correct the runtime read.** `getDbTokensSnapshot()` (`queries.ts:237-245`) returns the
   latest row whose payload contains `localStyles` (fetch latest N and pick, or jsonb `? 'localStyles'`).
   Verify `DynamicDataProvider.getTokens()` (`dynamic-provider.ts:354-366`) resolves identically.
2. **Stop DTCG from corrupting the snapshot table.** Decouple the `insertTokensSnapshot(body.dtcg)`
   call in `dtcg/route.ts:74` (see Open Question 1 for history ownership).
3. **Make the Figma-tokens push loud.** `pushRegistryTokens` (`push-registry-content.ts:324-339`)
   currently warns+returns when `public/api/tokens.json` is missing, and `push:all`'s `tryStep`
   swallows it. Make a missing/failed tokens push a hard, visible failure.
4. **Fix doc path drift.** `push-all.ts:41`, `developer/cli/page.tsx:57`,
   `developer/push-pull/page.tsx:60` say `tokens/tokens.json`; code reads `public/api/tokens.json`.

**Verify:** local effects/typography/colors still render visuals + token cards; after re-`push:all`,
`GET hagyard.../api/registry/tokens` has non-empty `localStyles`; registry pages render visuals; diff
localhost:3002 vs hagyard.

> **Per-workspace data caveat (resolvet, confirmed 2026-06-20):** resolvet's
> `public/api/tokens.json` has `localStyles` counts color=0, typography=26, effect=5. So Phase 1 fully
> restores **typography and effects** on the registry, but **colors `ColorGrid` stays empty** — resolvet
> has no Figma color styles; its colors live only in the DTCG brand pipeline (`tokens:build`). The rich
> color grid + "Color Info" drawer can only be restored for resolvet by feeding `ColorGrid` from DTCG
> (Phase 4/5). For workspaces that DO author Figma color styles, Phase 1 restores colors too.

---

## Phase 2 — Navigation parity (fixes the nav bugs)

1. **Icon passthrough** in `menu-merge.ts childToSubSection` (239-244) and the foundations skeleton
   (`dynamic-provider.ts:486-494`).
2. **Complete `MenuIcon`**: add `square`/`zap`/`focus` (`SideNav.tsx:96-129`); audit `foundations.md`
   icon names vs the switch.
3. **Robust System body**: re-run catalog injection after `mergeDbNavIntoSkeleton`, or guard
   `coerceDefinitionToSubSections` so unresolved markers never collapse an injected catalog to `[]`.
4. **No default "Guidelines" / no empty sections (per decision):** remove the bundled
   `config/docs/guidelines.md` so sections are **site-specific only** — a section appears only if the
   workspace authors a page (e.g. `pages/guidelines.md`). Add a skip-empty guard to the Knowledge
   branch of `SideNav` (207-232) matching `renderSubSection`'s `if (!hasPath && !hasMenu) return null`,
   so any empty section (now or future) never renders a lone header.

**Verify:** registry nav matches local — System populated, every foundation item has an icon, no empty
headers.

---

## Phase 3 — IA consolidation (per decision)

1. **Drop the Tokens nav.** Remove the `/system/tokens/*` route group (the plain `<Table>` views at
   `system/tokens/foundations/{colors,typography}/…`) and any nav entries pointing at it; the
   foundation pages are the single home for token presentation.
2. **Move Assets into Foundations.** The current assets view (`/assets`, confirmed at
   `hagyard.../assets/`) moves to `/foundations/assets`. Relocate the route + components, add the item
   to the foundations nav skeleton (both providers), and redirect old `/assets/*` → `/foundations/assets/*`.
3. Reconcile the foundations nav skeleton so the consolidated IA is identical in both providers.

**Verify:** one coherent Foundations section (tokens + assets); no orphaned Tokens nav; old asset URLs
redirect.

---

## Phase 4 — DTCG as canonical source of truth (the strategic core)

1. **Gap analysis:** enumerate presentation metadata the UI needs (color group/sort, contrast, font
   family→weights, usage, brand) and check what the current DTCG export carries.
2. **Enrich the DTCG export/normalization** (`scripts/tokens-to-dtcg.js` / `tokens-transform.js`) to
   preserve that metadata; extend `handoff_registry_dtcg` payload as needed (+ migration + journal).
3. **Normalization layer for imports:** define the normalize-to-DTCG entry point so Figma / Token
   Studio / Penpot all converge on DTCG. (Figma fetch becomes one importer among several.)
4. **Re-feed all foundation displays from DTCG**; retire the `localStyles` runtime dependency.
   Phase 1's bridge can then be removed.
5. Ensure REST (`/api/registry/dtcg` + per-type) and MCP (`handoff_get_tokens`) read the enriched DTCG.

**Verify:** every foundation visual renders from DTCG alone in both providers; importing the same
tokens from two sources yields identical normalized DTCG.

---

## Phase 5 — Colors & Typography display reconciliation (the UI regression)

**Key finding (2026-06-20):** the desired "… contextual menu → right-hand slide drawer" flow for BOTH
colors and typography is **already fully implemented** in the current code and matches the cynosure V1
screenshots — it just renders blank on the registry because of Face 1 (empty `localStyles`). So Phase 1
alone resurrects both drawers. This phase is reconciliation + data-wiring, not a rebuild.

- Colors: `ColorGrid.tsx` → `ColorDropdown` ("…" menu: Name/HEX/RGBA + "Color Info") → `ColorSheet`
  drawer (`ColorInfo`, `ColorSpaces` incl. OKLCH, `ColorContrast` WCAG slider, `ColorTailwind`). Intact.
- Typography: `TypographyExample.tsx` → per-row hover toolbar ("Text Info") → `TypographySheet` drawer
  (specimen, Style Details, Figma breadcrumb). Intact.

Tasks (depends on Phase 4's enriched DTCG so the restored UI is fed from the canonical source):
1. **Colors lead-display decision + DTCG feed:** the page currently stacks `BrandColorSwatches` (new,
   DTCG-fed) **above** the `ColorGrid` groups. Decide the canonical layout — recommend `ColorGrid`
   (with its drawer) as the primary experience, folding brand-awareness into it rather than two
   competing models. **Required for resolvet:** `ColorGrid` must be fed from DTCG colors
   (brands/semantic), because resolvet has no Figma `localStyles.color` (Phase 1 caveat). Map the DTCG
   color tokens into the `ColorGrid` / drawer shape so the rich grid + "Color Info" works regardless of
   whether colors originate in Figma styles or the brand CSS pipeline.
2. **Wire drawer placeholders to real data** (currently hardcoded):
   - `ColorGrid.tsx:127` copies a hardcoded `'rgba(0, 49, 82, 1)'` instead of the actual color → fix.
   - `ColorSheet`/`TypographySheet` show a placeholder description and a hardcoded Figma breadcrumb
     (`Primitives / Text / Heading`) → wire to real Figma variable description + path. **This requires
     Phase 4 to carry description/figma-path metadata in DTCG.**
3. **Typography:** confirm the specimen + scale matches the cynosure V1 target; revive the richer
   per-weight specimen only if wanted (dead block in `git show 53a951ca^:src/app/pages/foundations/typography.tsx`).
4. Visual sign-off with you, both providers.

**Verify:** colors + typography match the approved target — contextual menu + drawer working — on
localhost:3002 and the registry.

---

## Phase 6 — Guardrails (prevent recurrence)

1. **Registry parity smoke test** (extend task #54): seed a test Postgres, render every foundation page
   + System nav in **registry mode**, assert non-empty visuals + token cards + nav icons + System body.
2. **Reframe AGENTS.md** around single-source-of-truth: document DTCG as canonical, table ownership
   (no cross-writing), the dual-path failure mode as a first-class hazard, and a parity checklist
   (both providers ✓, push fails loudly ✓, renders on seeded registry test ✓).

---

## Open questions to resolve during implementation
1. **Token-change history ownership** after decoupling (Phase 1.2): once DTCG is canonical (Phase 4),
   diff DTCG into a DTCG-scoped change record; during the Phase 1 bridge, Figma-token snapshot owns the
   diff. Confirm interim behavior.

## Resolved
- **Assets/DAM scope** (Phase 3.2): move the existing `/assets` view → `/foundations/assets`. ✓
- **Cynosure V1 target** (Phase 5): code already present in repo; restore via Phase 1 + reconcile +
  wire placeholder data. Screenshots supplied confirm the target (… menu → right drawer). ✓
