# Handoff → Design System Knowledge Base — Roadmap

Reshape Handoff from a Figma extraction pipe into a complete design-system knowledge
base: a canonical file-tree-in-git store, transformable token outputs, human-facing
foundation pages for every token area, and machine-facing API/MCP access — with
pluggable ingest from many sources and DTCG/DSDS as I/O adapters.

## Guiding principles

1. **Canonical = file-tree-in-git.** DTCG token files + DSDS-shaped docs + a provenance
   envelope. The DB is only a presentation/MCP read model. Registry reconciliation runs
   over a REST API we control.
2. **Specs are adapters, never the internal model.** Internal model is a superset carrying
   provenance, sync state, lineage, ownership. Import normalizes *into* canonical; export
   serializes *out*.
3. **Two layers, two specs.** Token *values* → **DTCG** (stable 2025.10, build on it now).
   Documentation/system layer → **DSDS** (draft, version-pinned, output-first).
4. **Each token area is a vertical slice.** Schema → seed values → human UI page → transform
   output. Shippable independently once the structure exists.
5. **Native, not standalone.** All UI (foundation pages, image browser, drift views) lives
   *inside* the handoff app. The standalone static generators (image browser, etc.) are
   POCs that proved the shape — they are not the destination. Migrate their capability into
   the native app as we go.

---

## Phase 0 — Canonical structure  ⟵ *start here*

The foundation everything else projects from. Nothing downstream can begin until this is real.

**Deliverables**
- File-tree layout (proposed):
  ```
  design-system/
    tokens/                  # DTCG files — canonical token VALUES
      primitive/             #   tier 1: raw values (color ramps, spacing scale)
      semantic/              #   tier 2: intent aliases → reference primitives
      component/             #   tier 3: component tokens → reference semantic
    docs/                    # DSDS-shaped entities — point into tokens/ via source pointers
      foundations/
      components/
    manifest.json            # provenance / sync envelope
    ds.config.js             # project identity, source registry, export targets
  ```
- **Provenance envelope schema** — per entity: `source` (figma:file/node | token-studio | hand-authored),
  `syncState` (in-sync | drifted | overridden), `lineage` (derived outputs), `ownership`, `lastSynced`.
  **Decided (from the Token Studio spike):** the envelope lives *inline* in the DTCG files under
  `$extensions['handoff']` — the DTCG-sanctioned escape hatch (this is exactly how Token Studio
  uses `$extensions['studio.tokens']`). Tokens stay spec-compliant and portable; `manifest.json`
  becomes a cross-cutting *index* over the inline data, not the primary store.
- **DTCG file conventions** — three-tier model, alias/reference syntax, `$type`/`$value`.
- **Validation** — JSON Schema validation for DTCG files + manifest (AJV).
- **Round-trip the existing 5 foundations** (Logo, Icons, Colors, Foundations, Effects)
  into the new structure with no data loss.

**Acceptance:** existing colors + fonts live as DTCG files in the tree, validated, with a
manifest recording their Figma provenance. The current handoff output still builds from them.

---

## Phase 1 — DTCG token core + transform engine

Make the canonical tokens transformable. Low risk now that DTCG 2025.10 is stable.

**Deliverables**
- Adopt DTCG 2025.10 as the token file format.
- Wire **Style Dictionary v4** (consumes DTCG natively) as the transform engine.
- **Default transform set** (the out-of-the-box outputs every project ships with):

  | Transform | Status | Notes |
  |-----------|--------|-------|
  | CSS custom properties | existing | |
  | Sass / SCSS | existing | |
  | Style Dictionary | existing | the engine itself; also exposes its native output formats |
  | **Tailwind 4** | **new** | CSS-first — emit a `@theme { --color-*: … }` block, not a JS `tailwind.config.js` (v4 dropped the JS config as primary) |
  | **Native DTCG download** | **new** | the canonical token files served as-is — the portable, spec-compliant artifact a consumer can take to any other DTCG tool |
- Bootstrap remains available as a Style Dictionary platform/format on top.
- Transform build step producing all outputs into the handoff build pipeline.

**Acceptance:** colors + fonts transform cleanly to all five default targets from canonical,
with alias references resolved correctly across the three tiers. The DTCG download
round-trips back into a validator without loss.

---

## Phase 2 — Foundational token areas + UIs

The iterative heart. Each area is a vertical slice using a **consistent foundation-page
anatomy**, built once and reused:

> **Foundation page anatomy** — scale/visual preview · token table (name, value, resolved
> reference, live preview swatch/box) · copy-to-clipboard per token · transformed-output tabs
> (CSS / SCSS / Tailwind / DTCG) · provenance badge (source + sync state).

**Token areas, sequenced by dependency + value:**

| # | Area | DTCG type(s) | Notes |
|---|------|--------------|-------|
| 1 | **Spacing scale** (padding, margin, gap) | `dimension` | Foundational — most other areas reference it |
| 2 | **Border radius** | `dimension` | Quick, high-visibility win |
| 3 | **Sizing** (width/height, min/max, icon sizes) | `dimension` | |
| 4 | **Layout & grid** (columns, gutters, container widths) | `dimension`, `number` | |
| 5 | **Breakpoints** | `dimension` | Underpins responsive everything |
| 6 | **Borders** | `border` (composite: width+style+color) | References color + dimension |
| 7 | **Motion / animation** | `duration`, `cubicBezier`, `transition` (composite) | Easing + duration scales |
| 8 | **Elevation / z-index** | `number`, `shadow` | Effects already partially exist |
| 9 | **Opacity** | `number` | Small, finish-up |

Each area ships: DTCG schema + seed values (from existing design or sensible defaults) +
foundation page + verified transform output.

**Acceptance (per area):** values live as DTCG tokens, render in a **native** foundation page
inside the handoff app, and transform to all default targets. Areas are independently releasable.

**Native by default (decided):** foundation pages are built into the handoff app, not as
standalone static generators. The image-browser generator stays as a reference POC; its
capability migrates into a native app view as part of this work.

---

## Phase 3 — REST API + MCP read model

Make canonical machine-consumable. Both are read models over the file tree.

**Deliverables**
- DB projection of the canonical tree (presentation layer).
- REST API for registry reconciliation (the channel we control).
- MCP server exposing **resources** (tokens, components, foundations, pages — alias-resolved)
  and **tools** (query by type/tier, resolve aliases, "give me this DS as Tailwind/DTCG/CSS").

**Acceptance:** an MCP client can pull resolved, typed tokens and request any export format
on demand.

---

## Phase 4 — Pluggable ingest (Source plugins)

Generalize the clearinghouse. The Figma crawler becomes the first conforming plugin, and
**Token Studio is the chosen proof of multi-source ingest**.

**Deliverables**
- `Source` interface: `discover()` → `fetch(ids)` → `normalize()` → canonical (provenance-tagged).
- Refactor the existing Figma crawler (skills/handoff-figma) into the first Source plugin.
- Reconcile/merge layer with precedence rules across sources.
- Later sources: Storybook, Penpot.

**Token Studio ingest proof (the headline of this phase)**

Goal: *a designer using Tokens Studio for Figma can ship their tokens into Handoff cleanly,
with no hand-editing.* Tokens Studio is the right proof because its export is already
DTCG-converging JSON, so a clean import validates the whole "canonical = DTCG" thesis.

*Spec spike: DONE (see research below). Key finding: lean on official tooling rather than
hand-rolling the conversion.*

- **Importer = Style Dictionary v4 + `@tokens-studio/sd-transforms`.** The official
  `tokens-studio` preprocessor already does the hard normalization: aligns native types to
  DTCG (`expandTypesMap`), expands composites, and resolves inline math (`ts/resolveMath`).
  The plugin must explicitly register `preprocessors: ['tokens-studio']` (not on by default).
  The `tokenStudio` Source plugin wraps this and tags provenance.
- **Import the NATIVE format, not TS's DTCG export** — their DTCG export is incomplete
  (missing types; `composition` pending removal #2800; shadow `x/y`→`offsetX/offsetY` pending #2052).
- **Concrete gotchas the importer must handle** (from the spike):
  1. Both `value`/`type` and `$value`/`$type` field variants (RequireOnlyOne on value).
  2. Type remapping: `spacing`/`sizing`/`borderRadius`/`borderWidth` → `dimension`;
     `boxShadow` → `shadow`; pluralized font types; preserve original at
     `$extensions['studio.tokens'].originalType`.
  3. Composite expansion (4 types): typography (9 sub-props), boxShadow, border, legacy composition.
  4. Property renames on expand: shadow `x/y` → `offsetX/offsetY`; TS-only typography extras
     (`paragraphSpacing`/`paragraphIndent` → dimension, `textDecoration`/`textCase` → other).
  5. Evaluate inline math (DTCG has no math semantics).
  6. Resolve `{alias}` references, including across `source`-only sets.
  7. Single-file export nests sets under top-level parent keys → flatten (`excludeParentKeys`);
     honor `$metadata.tokenSetOrder`.
  8. Strip Figma-internal fields (`$figma*`, `id`).
- **Set→tier mapping:** `$themes[].selectedTokenSets` tri-state — `source` (resolves refs,
  emits nothing) → primitive tier; `enabled` (emits) → semantic/component tier; `disabled` → ignore.
- **Round-trip test** — import a real Token Studio export (e.g. their `lion-example`),
  transform to all five default targets, confirm values + references survive, re-export to
  native DTCG and diff.

**Acceptance:** a Token Studio export drops into Handoff and produces valid canonical tokens
+ all default transforms with zero manual fixup; Figma and Token Studio sources coexist in
one tree without clobbering, with per-entity provenance preserved.

---

## Phase 5 — DSDS export + reconciliation UI

The "pane of glass" + the pitch vehicle.

**Deliverables**
- **DSDS export adapter** — version-pinned (e.g. v0.11.0 bundled schema), output-only.
  Token entities link to DTCG files via `source: {file, path}`.
- **DESIGN.md export** (Google Labs) — agent-facing target for the MCP/coding-agent audience.
- **Drift / reconciliation UI** — surface sync state, upstream drift, local overrides.
- Pitch Handoff to PJ Onori as a DSDS reference implementation.

**Acceptance:** canonical tree exports to valid pinned-version DSDS; drift between a source
and canonical is visible and actionable in the UI.

---

## Dependency summary

```
Phase 0 (structure) ──┬── Phase 1 (DTCG + transforms) ── Phase 2 (token areas + UIs)
                      │
                      └── Phase 3 (API + MCP) ── Phase 4 (ingest plugins) ── Phase 5 (DSDS/drift)
```

Phases 0→1→2 are the critical path for the feature work the team wants. 3→4→5 layer the
machine-facing and multi-source capabilities on top and can proceed partly in parallel once
the canonical structure (Phase 0) is solid.
