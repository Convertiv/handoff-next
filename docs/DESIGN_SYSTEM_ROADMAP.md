# Handoff Design System — Roadmap

The delivery view for Handoff (the design-system platform: workspace CLI + registry app + MCP).
Authoritative specs live in their own docs — this roadmap points to them rather than duplicating:
- [COMPONENT_PREVIEW_SCHEMA.md](COMPONENT_PREVIEW_SCHEMA.md) — the component + preview standard,
  incl. **§2a contract-vs-instance**, §12a the `fields` annotation layer, §14 render isolation.
- [MCP_CLAUDE_SPIKE_REPORT.md](MCP_CLAUDE_SPIKE_REPORT.md) — the MCP/Claude spike findings.
- [schemas/component.schema.json](schemas/component.schema.json) — the component JSON Schema.

**How to read this:** [NOW](#now) is the current priority. [Tracks at a glance](#tracks-at-a-glance)
is the durable structure. [Open work](#open-work) has detail only for what isn't done. The
[Shipped ledger](#shipped-ledger) at the bottom is the condensed done-archive (full detail in git +
the spec docs).

---

## Guiding principles

1. **Canonical = file-tree-in-git.** DTCG token files + DSDS-shaped docs + a provenance envelope.
   The DB is only a presentation/MCP read model; reconciliation runs over a REST API we control.
2. **Specs are adapters, never the internal model.** The internal model is a superset (provenance,
   sync state, lineage, ownership). Import normalizes *into* canonical; export serializes *out*.
3. **Two layers, two specs.** Token *values* → **DTCG** (stable). Documentation/system layer →
   **DSDS** (draft, version-pinned, output-first).
4. **Each token area is a vertical slice.** Schema → seed values → human UI page → transform output.
5. **Native, not standalone.** All UI lives inside the handoff app; the standalone POC generators
   proved the shape but are not the destination.
6. **The data lifecycle is the product:** *Well-structured data → easy for devs/designers/PMs to
   update → validate & track → feed out to UI/MCP/REST.* Author once, in structured form, and
   *project* to every consumer. If a consumer can't see something, enrich the canonical data — don't
   special-case the consumer. (Contract-vs-instance §2a is this applied to the component layer.)

---

## NOW

**Track 6 — Handoff driven from Claude ⭐ FRONTLOADED (2026-06-30).** Demo-driven: put a genuinely
powerful, *write-capable* MCP in front of people. Frontloaded **ahead of** finishing the typed-React
per-component rollout (Track 2), which is paused at engine-done + Hagyard/8x8 proof.

**Hero demo flow (the north star):** one prompt-driven arc that exercises every goal —
1. create a new landing page → 2. prompt-compose it from existing components with generated
images/content, **saved in the playground** → 3. realize we need new *structural* hero functionality
→ 4. prompt a new design layout (maybe from a wireframe), **saved in the design workbench** →
5. generate a spec → 6. generate component code, push to workspace + registry → 7. swap the new hero
into the landing page.

**Immediate next:** ✅ 6.1 instance write surface is **done** (page compose/read/swap, preview
authoring, pattern changelog, doc-page CRUD — all `sync:write`, contract-validated, tracked). Next:
**6.2 embedded preview app** (reuse the §14 iframe). See [Open work → Track 6](#track-6--handoff-driven-from-claude).
*Pending: live test against a registry.*

**Bugs from the 8x8/SS&C pass:** (1) React not live-updating = **not a code bug** — needs the
component's `-client.mjs` rebuilt with #3's render/update + registry deployed (verify on rebuilt
Hagyard). (2) image-select crash — **FIXED** (`2ca6cd22`, `handleInputChange` immutable/primitive-safe).

---

## Tracks at a glance

Markers: ✅ shipped · 🔄 in progress · ⬜ outstanding · ⛔ externally gated.

- **Track 1 — Token canonical spine.** ✅ DTCG + `tokens:build` + CSS/SCSS/Tailwind + foundation
  pages; spacing/radius/grid live. 🔄 focus+elevation extractor. ⬜ remaining token areas · Token
  Studio ingest · DSDS export.
- **Track 2 — Component + Preview standard (typed-React builder).** ✅ schema + engine (fields
  annotations → build extraction → field builder → render bridge), proven on Hagyard + 8x8.
  🔄 **PAUSED** — per-component annotation rollout resumes after Track 6.
- **Track 3 — MCP / Claude read + context.** ✅ spike PASS · slim tools · DESIGN.md loop · quality
  harness · change-inquiry tools. ⬜ `query_tokens` · component template (gated on component.html) ·
  CI gate · `check-mcp`.
- **Track 4 — Substrate.** ✅ workbench/assets/registry plumbing · CDN image fills · Neon egress cut.
  ⬜ backlog (below).
- **Track 5 — Image sizing guide.** ⬜ self-contained; capture → store → surface.
- **Track 6 — Handoff driven from Claude.** ⭐ NOW — MCP instance-write surface + embedded apps.

---

## Open work

### Track 6 — Handoff driven from Claude

Today's MCP is ~90% *read* + a generic `sync_push`. The unlock is a coherent **write surface over
*instances*** (§2a). The shipped change-tracking + "why" layer is its **safety foundation** — every
Claude-driven write is versioned, attributed, explained, diffable. The four goals map onto
**Design↔Code × Contract↔Instance**: goal 3 (code/patch components→push) = Code×Contract = the Claude
Code + `push` loop (mostly works); goals 1/2/4 (designs, pages, playground compositions) = instance
writes = the new surface.

- ✅ **6.1 Instance write surface (DONE — no external dep).** All writes gated by `sync:write`,
  validated against the contract, version-tracked, and carry an optional `message` ("why").
  - ✅ **Playground page tools** (`4f4d5fa5`): `handoff_list_pages` / `get_page` / `create_page` /
    `update_page` — compose/read/swap component blocks (`{id, preview?, args}`), each validated against
    its component contract. Rides a shared actor-param `pattern-write.ts` core. Demo steps 1–2, 7.
    *(A playground page = a pattern, `source: playground` — distinct from doc pages.)*
  - ✅ **Preview authoring** (`88abf7ca`): `handoff_create_preview` / `update_preview` wrap the
    contract-validating registry preview CRUD (`source: llm`).
  - ✅ **Pattern changelog** (`f1b7489b`): `handoff_pattern_change` table + recording; pattern entries
    in the unified changelog + `change_why` + MCP change tools; UI renders them.
  - ✅ **Doc-page CRUD** (`f0387530`, goal 2): `handoff_list/get/create/update_doc_page`; actor-param
    `writeDocPage` upsert records `page_change` + syncs nav.
- ⬜ **6.2 Embedded Claude apps (MCP-UI / Apps SDK), reusing shipped code:** §14 opaque-origin iframe
  → embedded preview renderer (**first**); playground field builder + render bridge → embedded
  builder; changelog/diff → embedded review.
- ⬜ **6.3 Component source-patch tool (goal 3):** expose editable source files
  (`handoff_component_sources`) for Claude Code to patch → build → push. Small; rides the existing loop.
- ⛔ **6.4 Claude Design native (goal 1):** design inside Claude Design pulling Handoff foundations
  natively — **gated on Anthropic** (Phase G). Now: the artifact bridge (`create_design_artifact` +
  `generate_component_from_design` + read-context).

### Track 2 — typed-React builder rollout *(PAUSED)*

Engine is done and proven (Hagyard ProductCard + 8x8 hero-split overlay). Remaining when resumed:
- Roll `fields` annotations out across more 8x8/Hagyard components; then Cynosure/SS&C playground polish.
- Design item surfaced during the pass: **preview `args` typing** — args are typed `Partial<TProps>`,
  but an annotated field's stored value can be a different shape than its prop (e.g. image editor emits
  `{src,alt}` for a `string` prop). Sidestepped for now by keeping args prop-shaped + a `render`
  adapter; longer-term the args type may need to reflect editor values.
- Full design authoritative in [COMPONENT_PREVIEW_SCHEMA.md](COMPONENT_PREVIEW_SCHEMA.md) §12/§12a.

### Track 1 — remaining token spine

- ⬜ **Focus + elevation extractor** (shared with substrate). DTCG types + foundation pages are built
  and waiting; the gap is the `tokens:build` extractor deriving `focus` (ring width/offset/color) and
  `elevation` (shadow scale) from Tailwind utility usage. **Highest leverage-per-effort** — lights up
  idle infra.
- ⬜ Remaining token areas: sizing, breakpoints, borders, motion, opacity (each a vertical slice).
- ⬜ **Phase 4 — Token Studio ingest** (the multi-source proof; spec spike DONE). Importer =
  Style Dictionary v4 + `@tokens-studio/sd-transforms` (register `preprocessors: ['tokens-studio']`).
  **Import the NATIVE format, not TS's DTCG export** (theirs is incomplete). Gotchas captured in git
  history / spike notes: `$value`/`value` variants, type remapping (spacing/sizing→dimension,
  boxShadow→shadow), composite expansion (typography/shadow/border), inline-math eval, `{alias}`
  resolution across `source` sets, `$metadata.tokenSetOrder` flatten, strip `$figma*`. Set→tier via
  `$themes[].selectedTokenSets` tri-state. Generalize the Figma crawler into the first `Source` plugin.
- ⬜ **Phase 5 — DSDS export adapter** (version-pinned, output-only) + drift/reconciliation UI.
- ⬜ Phase 0 hardening: AJV validation of DTCG files + manifest (aspirational).

### Track 3 — remaining MCP read/context

- ⬜ **Phase B:** `query_tokens` (B1) · `export_tokens_as`/`brief` (B2) · reference-material quality (B3).
- ⬜ **Phase C:** component template (C1) — **gated on an open question: are built `component.html`
  templates stored in the registry DB after push, or only local?** Investigate before C1 (may need a
  DB column + push endpoint). Then search enrichment (C2) · usage (C3).
- ⬜ **Phase E:** CI gate (E3) + live-model capture (need infra/API key).
- ⬜ **Phase F:** `check-mcp` connectivity/scope validator · token gen.
- ⬜ Reference freshness: confirm `handoff_get_reference('tokens')` regenerates on push vs. staleness (feeds B3).

### Track 5 — Image sizing guide

Capture Figma image-slot sizing (already in the fetched node tree) as first-class guidance.
- Data model: new `handoff_image_slot` table (a slot is a *spec*, independent of assignment) —
  `componentId, variantKey, slotName, nodeId, recommended{W,H}, aspectRatio{W,H}, scaleMode,
  isResponsive, min{W,H}`.
- **A — Capture:** extend `imageAssetsFromNodeTree()` (`component-linking.ts`) to carry boundingBox /
  scaleMode / isResponsive / min — zero extra API calls; compute GCD aspect ratio.
- **B — Store:** push to `/api/registry/assets/image-slots`, idempotent upsert by (componentId, slotName, variantKey).
- **C — Surface:** per-component "Image Slots" tab + a foundation page.

### Change-tracking follow-ups

- ⬜ Backfill token `change_details` from the stored consecutive snapshots (analogous to the version-cleanup tool).
- ⬜ Token compare-two-arbitrary-snapshots view (per-push diffs already ship).
- ⬜ Design-system-native "why": link token changes ↔ the components that consume them (needs a token→component usage map).
- ⬜ Token-version diffs (tokens have change records but no per-version browser like components).

### Backlog (Track 4)

- ⬜ **Decoupled batch image endpoint** — move component-referenced images off the push payload onto a
  batched upload endpoint (mirrors fonts); removes the 1.5MB/image cap + 413 risk, enables large hero images.
- ⬜ **Push-cache invalidation on CLI capability changes** — stamp a cache/feature version so a plain
  `push:all` picks up output-changing CLI features once after upgrade (today keyed only on source hashes).
- ⬜ **OAuth-backed Figma tokens for CLI fetch** — mint short-lived Figma tokens from the registry's
  OAuth grant (`/api/figma/cli-token` reusing `getValidFigmaAccessTokenForUser`) instead of hand-managed
  PATs. Open Qs: project access scope, mid-run refresh, blast radius of the sync token, offline PAT
  fallback, read-only scope coverage.
- ⬜ **Egress follow-ups:** `getRuntimeComponent` full scans (→ by-id); visibility-gated client polling;
  `unstable_cache`/tags for static `/api/registry/*`.

### Deprioritized

- ⬜ **Validation gating** (`components:validate` build/push gate) — pushed to the bottom; enforcement
  not wanted yet. Pure validators exist and run at authoring time.

---

## Key references & load-bearing decisions

- **Contract vs instance (§2a):** component *properties/code* are code-only, replace-on-push (workspace);
  *previews/pages/compositions* are registry-contributable. Never conflate. → COMPONENT_PREVIEW_SCHEMA §2a.
- **Render isolation (§14):** previews render in an opaque-origin sandboxed iframe (`allow-scripts`, no
  `allow-same-origin`), `srcdoc` + postMessage height + CSP; route CORS on js/css. Shipped + verified.
- **DB migrations:** auto-run on boot/page-load. **NEVER `db:generate`** (snapshot intentionally drifted
  → bogus diffs) — hand-write idempotent `CREATE TABLE IF NOT EXISTS` SQL + a `_journal.json` entry.
- **Registry deploy:** registry sites deploy from handoff-app on push to `feature/mcp-prototype`.
  Workspaces consume handoff-app as a git dep (`github:Convertiv/handoff-next#feature/mcp-prototype`) —
  reinstall with `--force` to pick up a new branch commit (`prepare` rebuilds `dist`).
- **Provider parity:** MCP/consumers must read the DTCG canonical source, not just the Figma snapshot.

---

## Shipped ledger

Condensed archive (full detail in git history + the spec docs).

**Token spine (T1):** DTCG token core + `tokens:build` + CSS/SCSS/Tailwind transforms + foundation
pages; spacing / border-radius / grid areas live.

**Component + Preview standard (T2):** canonical schema drafted + validated (SS&C button round-trip)
+ §2a contract-vs-instance locked; lenient preview normalizer + enum-membership validation; unified
preview surface + component workbench (shared field builder, responsive controls); §14 hardened
opaque-origin iframe render; registry preview CRUD + 422 validation. **Typed-React builder engine:**
`fields` annotation spec §12a + `defineReactComponent` types; #1 build-time extraction
(`applyFieldAnnotations`); #2 field builder honors `editorType` + scalar array items; #3 render bridge
(`-client.mjs` exports render/update + `applyRenderFns`, reusing the hydration bundle); 8x8
enum/slot/function/any field handling; proven on Hagyard + 8x8 hero-split.

**MCP / Claude (T3):** Phase A spike PASS; `tools/list` fix; `get_tokens` slim (22K→6.6K, now serving
spacing/radius/grid); `get_component` slim (143K→~1K); `get_reference` `type` alias; DESIGN.md loop
(`export_design_md` + `init-claude` writing DESIGN.md/`.mcp.json`/CLAUDE.md + `push:all` refresh);
quality harness (golden prompts + scorer + runner, `npm run mcp:quality`).

**Change-tracking & inquiry:** versioning churn fixed (volatile-field fingerprint → canonical +
history projection + by-id fetch + one-time `cleanup-versions` admin tool); component
compare-two-versions content diff; token change parity (before/after values + pusher + expandable
diffs); capture "why" (CLI `--message` + lazy AI-drafted summary, shown in changelog + version
history); MCP inquiry tools (`recent_changes` / `component_history` / `change_why`).

**Substrate (T4):** workbench reliability; DTCG→workbench foundations; registry fonts; playground
React; asset library + library-in-workbench; nav cleanup; S3/CloudFront CDN for image fills; Neon
egress cut (list/menu column projection · `getComponent` by-id · `React.cache` per-render dedupe ·
token snapshot `LIMIT 1`).

**Fixes:** image-select crash (`handleInputChange` immutable + primitive-safe, `2ca6cd22`).
