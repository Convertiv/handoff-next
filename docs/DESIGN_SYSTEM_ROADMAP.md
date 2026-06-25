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

## Strategic initiative — Handoff as the Claude design system

**The opportunity.** Claude's AI coding tools (Claude Code, Claude Desktop, Cursor) generate UI,
but produce *generic* output unless framed by a real design system. Handoff already holds that
system — tokens, foundations, components, assets — and already exposes it over a **live MCP
server** at `/api/mcp`. The unlock: wire any Handoff registry into Claude Code/Desktop as an MCP
server so any developer on the project gets real tokens, real components, and brand framing
baked into every AI-assisted component they write.

The first target is the **Claude product's own design system** — an eat-your-own-dogfood
deployment that proves the thesis and gives us a high-fidelity reference registry for testing.

**What we already have (the foundation — do not re-build).** The MCP server is live and
significantly capable:

| Tool | Category | Status |
|------|----------|--------|
| `handoff_get_project_context` | Context | Live — stack profile, paths, Figma key, translation rules |
| `handoff_get_stack_guide` | Context | Live — Markdown authoring rules for bootstrap/react stacks |
| `handoff_get_design_guidelines` | Context | Live — Design.MD from workspace settings |
| `handoff_get_brand_voice` | Context | Live — formatted copy guidelines |
| `handoff_get_tokens` | Tokens | Live — raw token snapshot |
| `handoff_get_reference` | Tokens | Live — generated catalog, tokens, icons, property-patterns |
| `handoff_search_components` | Components | Live — filter by id/title/group/tag |
| `handoff_get_component` | Components | Live — full component row |
| `handoff_get_component_reference` | Components | Live — reference images for buttons/inputs/iconography |
| `handoff_get_icon_catalog` | Icons | Live — full catalog with SVG content |
| `handoff_search_icons` | Icons | Live — substring search |
| `handoff_get_logo_set` | Logos | Live — all variants with SVG + usage guidance |
| `handoff_search_assets` | Assets | Live — fills, images, logos with CDN URLs |
| `handoff_get_asset` | Assets | Live — single asset with component usages |
| `handoff_list_asset_collections` | Assets | Live — Figma section groupings |
| `handoff_list_design_artifacts` | Design | Live — saved workbench generations |
| `handoff_get_design_artifact` | Design | Live — single artifact |
| `handoff_create_design_artifact` | Design | Live — save a new design |
| `handoff_get_component_spec` | Design | Live — structured spec + markdown for a design |
| `handoff_generate_component_from_design` | Design | Live — full generation brief with queued spec |
| `handoff_sync_status/pull/push` | Sync | Live — registry sync cursor + change streaming |

The developer page at `/developer/mcp` documents all tools and shows the setup snippet for Claude
Code / Cursor. Connection requires only a single JSON stanza.

---

### Phase A — Spike: end-to-end connection with the Claude DS registry

*Gate: before any tool additions, verify the connection actually works well.*

**Goal:** Claude Code connected to a real Handoff registry responds to "build a hero section" by
using registry tokens, components, and brand guidance instead of generic defaults.

**Steps:**
1. Deploy a Handoff registry for the Claude design system (or use an existing SSC/8x8 registry).
2. Generate a scoped service-account token (read-only, `reference:read design:read`).
3. Add the MCP config to the project's `.claude/settings.json` or `CLAUDE.md`:
   ```json
   {
     "mcpServers": {
       "handoff": {
         "url": "https://registry.vercel.app/api/mcp",
         "transport": "http",
         "headers": { "Authorization": "Bearer <token>" }
       }
     }
   }
   ```
4. Run a structured prompt session — 10 standard prompts covering:
   - "What colors are available in this design system?"
   - "Build a primary button using this design system's tokens"
   - "Build a hero section with a headline and CTA"
   - "What components are available for navigation?"
   - "Show me the icon for [search/close/arrow-right]"
   - "What's the brand voice / tone for copy?"
5. Score each response against the actual design system: did it use real tokens? Real components?
   Real brand colors?

**Deliverables:** a written spike report documenting what worked, what produced generic output,
and which tool gaps were most responsible. This report directly drives Phase B and C scope.

**Acceptance:** at least 7/10 prompts produce output that references actual registry data (correct
token names, real component ids, actual brand colors) without the developer having to manually
provide that context.

---

### Phase B — Token surface: queryable, alias-resolved, exportable

The current `handoff_get_tokens` returns a raw snapshot that's hard to use in generation prompts.
Three additions make tokens genuinely useful to a model:

**B1 — `handoff_query_tokens`**
```
query?: string               // substring match on name
type?: 'color' | 'dimension' | 'typography' | 'shadow' | 'duration' | ...
tier?: 'primitive' | 'semantic' | 'component'
resolve_aliases?: boolean    // default true — dereference alias chains to concrete values
limit?: number
```
Returns matched tokens with `name`, `value` (resolved), `$type`, `tier`, `aliasOf` (the alias
chain), `cssVariable`. Covers "what are all semantic color tokens?" and "what is `--color-primary`
resolved to?" without returning the entire snapshot.

**B2 — `handoff_export_tokens_as`**
```
format: 'tailwind' | 'css' | 'dtcg' | 'brief'
tier?: 'primitive' | 'semantic' | 'component'
type?: string
```
Returns the token set in a specific output format on-demand. `format: 'brief'` returns a
compact (~4K token) natural-language summary of the key design decisions — colors by role,
spacing scale, type scale — suitable for injecting into a system prompt without blowing context.
This is the "framing brief" that replaces the unstructured large dump.

**B3 — Reference material quality pass**
`handoff_get_reference('tokens')` already exists but the generated content needs to be audited:
is it compact enough for a context window? Is it alias-resolved? Does it group by semantic role
(brand, neutral, feedback, surface) rather than raw Figma layer order? Update the reference
material generator to produce a model-friendly format rather than a dump.

**Acceptance:** a model can ask "what are all the semantic color tokens, resolved?" and get a
clean, compact list under 2K tokens in response. `handoff_export_tokens_as('brief')` produces a
concise design-system framing brief that fits in a system prompt.

---

### Phase C — Component surface: implementation-ready data

The current `handoff_get_component` returns the full component DB row, which includes Figma
metadata and internal fields that aren't useful for generation. Three improvements:

**C1 — `handoff_get_component_template`**
```
id: string
stack?: 'bootstrap-handlebars' | 'react-tailwind' | 'react-scss'
```
Returns the compiled `component.html` template for the component (the actual renderable output
from the last `handoff-app build`). This is the ground truth for what a generated component
should look like — the model can use it as a starting point rather than inferring structure from
metadata.

**C2 — Component search improvements**
`handoff_search_components` currently returns `{ id, title, group, type }`. Add:
- `cssClasses: string[]` — the `.hds-*` utility classes the component uses
- `tokens: string[]` — the CSS variable names the component references
- `preview?: string` — small thumbnail URL if available
- `variants?: string[]` — variant key list (so the model knows what props exist)

**C3 — `handoff_get_component_usage`**
```
id: string
```
Returns where the component is used across the design system: which pages reference it, what
variants are used, and any usage guidelines from the component's documentation. Helps the model
understand *when* to use a component, not just *what* it looks like.

**Acceptance:** "build a card component" prompt produces HTML that uses the registry's actual card
class names, correct token variables, and the right variant structure — not a generic Bootstrap
card.

---

### Phase D — DESIGN.md framing artifact (project-level context)

The DESIGN.md concept from Phase 5 has a specific role in the Claude integration: it's the
file checked into the client project that gives Claude framing context without an MCP call.

**D1 — `handoff_export_design_md` tool**
```
// no params — exports the current registry state
```
Returns a structured Markdown document (~2–4K words) covering:
- **System identity** — project name, stack, version
- **Token compact brief** — colors by semantic role, spacing scale, type scale (the `brief`
  format from B2)
- **Component vocabulary** — list of components with one-line description + primary CSS class
- **Brand voice** — key principles, do/don'ts for copy
- **Do/don'ts** — top-level design rules (from `designMd` workspace field)
- **Figma source** — link to the source file for reference

This document should be committable to the client project as `DESIGN.md` and referenced in
`CLAUDE.md` so Claude Code loads it as project context even without the MCP server configured.

**D2 — Regenerate-on-push**
Wire the `handoff-app push:all` pipeline to regenerate `DESIGN.md` and write it to the client
project's `handoff-output/` directory alongside the existing `theme.css`, `tokens.json`, etc.
Developers can then commit the generated DESIGN.md as part of their design sync workflow.

**D3 — CLAUDE.md stanza generator**
Add a `/developer/setup` page section (or `handoff-app init-claude` CLI command) that prints the
`CLAUDE.md` lines to add to a project for both:
- The MCP config block (live connection)
- The `# Design System` section referencing the generated `DESIGN.md`

**Acceptance:** a developer runs `handoff-app push:all` and gets a `handoff-output/DESIGN.md`
they can commit. When they add two lines to `CLAUDE.md`, Claude Code has full design system
context without an MCP server configured.

---

### Phase E — Quality framework

Quality here means: *does AI-generated code actually use the design system?* Subjective review
doesn't scale. We need repeatable, automated measurement.

**E1 — Golden prompt set**
A committed set of 20 representative prompts covering the full tool surface:
- Token lookup (5): "what's the primary button background color?", "what's the base font size?"
- Component generation (8): hero, card, button, nav, form, table, badge, modal
- Icon/logo lookup (3): retrieve a specific icon by name, find all icons in a category
- Brand framing (4): "write a CTA headline for a signup page", "what's the color for error states?"

Each prompt has an **expected behavior spec**: list of token names, class names, or brand
principles that should appear in the response (not exact string match — coverage check).

**E2 — Automated coverage scoring**
A Node.js test script (`scripts/mcp-quality-test.ts`) that:
1. Connects to a registry via MCP
2. Runs each golden prompt through a lightweight model call (haiku or equivalent)
3. Parses the response for coverage markers (token names present in `handoff_get_tokens`, class
   names from component catalog, brand colors from logo/token data)
4. Reports: `passes: 17/20, coverage: 85%, tool_calls_used: 12`

**E3 — Regression gate**
The quality test runs in CI when the MCP server code changes (`src/app/lib/mcp/**`). A score drop
below 80% coverage blocks merge. This prevents tool changes from silently degrading the output
quality the AI produces.

**E4 — Tool call audit**
Instrument which MCP tools get called during a typical Claude Code session (log at the transport
layer). If the model isn't calling `handoff_get_tokens` before writing token-dependent code, the
tool descriptions are wrong — iterate on them.

**Acceptance:** quality test suite is committed, runs in CI, and scores ≥80% on a reference
registry (8x8 or SSC). Tool call audit shows models are hitting token + component tools before
generating UI code.

---

### Phase F — Distribution & developer experience

Once the integration quality is solid, make it easy to set up for any Handoff registry user.

**F1 — One-click MCP token generation**
Add a "Generate MCP Token" button to `/developer/mcp` that creates a read-only service-account
token scoped to `reference:read design:read` and shows the ready-to-paste config snippet. No
manual token management.

**F2 — Stack-specific CLAUDE.md templates**
For each supported stack (`bootstrap-handlebars`, `react-tailwind`, `react-scss`, `tailwind-handlebars`),
provide a pre-written `CLAUDE.md` section that includes:
- The MCP connection stanza
- Stack-specific authoring rules (already in `stack-guides/`)
- A `# Design System` section referencing `DESIGN.md`
Available on the `/developer/mcp` page as copy-paste blocks.

**F3 — `handoff-app init-claude` CLI command**
Writes the MCP config stanza + CLAUDE.md additions directly to the project directory. Takes
`--registry-url` and `--token` and optionally `--stack`. The developer runs one command after
`handoff-app login` and they're connected.

**F4 — Validation: `handoff-app check-mcp`**
Verifies the MCP endpoint is reachable, the token has the right scopes, and a sample tool call
(`handoff_get_project_context`) returns valid data. Gives a clear pass/fail before the developer
tries to use Claude Code.

**Acceptance:** a new developer can go from zero to "Claude Code is using my design system" in
under 5 minutes, following the `/developer/mcp` setup guide.

---

### Phase G — Claude Design native integration (future-gated)

*This phase is blocked on Anthropic opening a design-system connector surface in Claude's design
mode. Do not build against assumptions — spike first when that surface becomes available.*

**The question to spike:** Does Claude.ai's design/prototyping mode accept a user-supplied MCP
server as a design system source? If yes, what resource/tool shape does it expect?

**If MCP-native is supported:**
- Verify the existing tools map to what Claude Design expects (it may want resources, not just
  tools — add `resources` for tokens, components, and logos alongside the existing tools)
- Wire per-project registry auth into the Claude Design connector
- Test: "prototype a signup page using my design system" → does output use real brand colors?

**If MCP-native is not supported:**
- `DESIGN.md` (Phase D) becomes the primary framing channel — Claude Design loads it as context
- Supplement with a static token/component export in whatever format Claude Design consumes
  (Tailwind config? CSS custom props? JSON?)

**Round-trip future goal:** a prototype generated by Claude Design can be saved back to the
Handoff workbench as a design artifact (`handoff_create_design_artifact`) and from there
converted to a component spec (`handoff_generate_component_from_design`). The full loop: design
system in → prototype out → spec saved → component generated.

---

### Open questions (resolve during Phase A spike)

1. **Claude Code MCP auth model** — does `claude_desktop_config.json` support custom headers for
   Bearer tokens, or does the registry need to accept the token as a query param? Need to test
   both `transport: 'http'` and `transport: 'sse'` against the Vercel deployment.
2. **Token dump size** — `handoff_get_tokens` on a real registry with 200+ tokens: does it fit
   in Claude's tool-result context window without truncation? If not, Phase B (queryable tokens)
   is urgent, not optional.
3. **Component.html availability** — the `component.html` files are generated by `handoff-app
   build` and written to disk in the workspace. Are they stored in the registry DB after a push,
   or only in the local workspace? If only local, `handoff_get_component_template` (Phase C1)
   needs a DB column + push endpoint first.
4. **Reference material freshness** — `handoff_get_reference('tokens')` returns a pre-generated
   blob. Is it regenerated on every push/fetch, or manually? Stale reference material is worse
   than no reference material — it produces confidently wrong output.

---

### Dependency map for this initiative

```
Phase A (spike)
  ├── Phase B (token surface)     ← unblocked after A identifies token tool gaps
  ├── Phase C (component surface) ← unblocked after A identifies component tool gaps
  └── Phase D (DESIGN.md)        ← can run parallel to B/C; depends on workspace designMd

Phase B + C + D →  Phase E (quality framework)
Phase E →          Phase F (distribution/DX)
Phase F →          Phase G (Claude Design native, gated on Anthropic surface)
```

**Acceptance (north star):** a developer adds two lines to their `CLAUDE.md`, and every
subsequent AI-assisted component in that project uses their actual design system — correct tokens,
real component class names, on-brand copy — without them having to manually describe the design
system in every prompt.

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

---

## Active build track — Workbench, Assets & Registry plumbing

The phases above are the destination. This section is the **near-term operational work**
hardening the live POC (8x8, SSC) so the workbench, playground, and registry are demo-solid.
It feeds Phase 2 (native foundation/asset capability) and Phase 3 (registry API plumbing).

### Shipped
- **Workbench generation reliability** — root-caused the silent "No image returned." hang: the
  worker is now `await`ed inline inside the SSE stream (not `after()`/a detached promise, which
  Vercel doesn't reliably execute). Plus `maxDuration=300`, default quality `low`, blank-canvas
  fallback for empty context, a 240s abort on the OpenAI image fetch, and a 30s watchdog + 8s
  Google-font-fetch timeouts on foundation rasterization.
- **DTCG → workbench foundations** — `serializeFoundationsFromDtcgData` feeds brand colors +
  spacing/typography to the image model when there's no Figma snapshot (DTCG-only registries).
- **Foundation raster diagnostics** — `/api/handoff/ai/debug-foundation-raster` (PNG, plus
  `?json` and `?generate` probes) and a "Preview raster" button on `/design/settings`.
- **Registry fonts** — `handoff_registry_font` table + `/api/registry/fonts` push API +
  public `/fonts/<file>` serving (so theme.css `@font-face` resolves on the registry) + the
  foundation rasterizer pulls satori-usable fonts (ttf/otf/woff) from the registry. Upload is
  **batched** under Vercel's ~4.5MB function limit.
- **Playground React components** — render via dynamic `import()` with a static `component.html`
  fallback + `theme.css`, so 8x8's React blocks display instead of going blank.
- **Component referenced-images → asset library** — DB-backed assets (`handoff_asset_blob` +
  `/api/handoff/assets/[id]/raw`, S3-optional); a CLI scanner resolves workspace image refs,
  content-addresses them, and rewrites references to the asset URL; the server ingests them as
  library assets with `handoff_asset_usage` links; bidirectional cross-reference UI (asset ↔
  component). Per-image **1.5MB cap** — oversize images are skipped + flagged (see backlog).
- **Library in the workbench** — saved designs now live in the sidebar Library tab (linking to
  `/design/library/[id]`); the standalone list page redirects there. Failed/stuck generations
  are deletable at the DB level; the "start fresh" unsaved-session restore bug is fixed.
- **Nav cleanup** — dropped Patterns from the tools nav; "Templates" → "Saved Patterns";
  `AnchorNav` renders nothing when a page has no headings/groups.

### In progress / pending decision
- **Focus + elevation token extraction** — derive `focus` (ringWidth/ringOffset/ringColor) and
  `elevation` (box-shadow scale) DTCG tokens from the existing Tailwind utility usage in 8x8's
  components. The registry already has the foundation pages + DTCG types waiting; the gap is the
  `tokens:build` extractor. *Not yet built.*
- **Foundations right-hand TOC** — confirm whether it's missing on data-rich pages (Colors) at
  full width; if so, lower the `xl`→`lg` visibility breakpoint. (Empty pages now correctly show
  nothing; populated focus/elevation pages will gain a TOC once the extractor above lands.)

### Backlog
- **Decoupled batch image endpoint** — move component-referenced images off the component push
  payload onto a dedicated, batched upload endpoint (mirroring the fonts pattern). The component
  push would then carry only the rewritten refs. This removes the 1.5MB per-image cap and the
  payload-size coupling that currently risks a 413 on image-heavy components, and lets large hero
  images (e.g. 2560×1400 backgrounds) be registry-hosted. *Chosen approach when picked up.*
- **Push-cache invalidation on CLI capability changes** — the push cache keys on workspace
  source-file hashes, so a new CLI feature that changes push *output* (e.g. image scanning)
  doesn't invalidate it; components are skipped until source changes or `--force` is passed.
  Consider stamping a cache/feature version so a plain `push:all` picks up output-changing
  capabilities once after a CLI upgrade.
- **OAuth-backed Figma tokens for the local CLI fetch** — today `handoff-app fetch` needs a
  Figma *dev access token* (`HANDOFF_DEV_ACCESS_TOKEN` / `figma_project_id` auth). Figma's
  personal access tokens are now short-lived (~30-day max), so users have to keep regenerating
  and re-pasting them — a recurring papercut. The registry already runs a full Figma OAuth flow
  (connect/refresh, scopes incl. `current_user:read`, `file_content:read`, etc.) and stores
  refreshable tokens per user in the DB. Idea: let the CLI authenticate against the registry's
  OAuth connection and mint short-term Figma access tokens on demand for the local fetch, instead
  of requiring a hand-managed PAT.
  - **Shape to investigate:** the CLI is already OAuth-able to the registry for `push`/`pull`
    (sync bearer token). Add a registry endpoint (e.g. `/api/figma/cli-token`) that, for an
    authenticated CLI session, returns a fresh short-lived Figma access token derived from the
    user's stored OAuth grant (reusing `getValidFigmaAccessTokenForUser` + the refresh path in
    `figma-auth.ts`). The CLI uses it as a bearer for the fetch and discards it.
  - **Open questions:** (1) Figma OAuth tokens are user-scoped — does the connected user have
    access to the target `figma_project_id`? (2) Token lifetime vs. a long fetch — may need
    refresh mid-run. (3) Security: minting Figma tokens for a CLI caller widens the blast radius
    of a leaked sync token; scope/audit it. (4) Offline/no-registry workflows must still accept a
    manual PAT as a fallback. (5) Figma OAuth scopes are read-only by design — confirm they cover
    everything the extractor needs (styles, components, image fills, asset URLs).
  - **Why it matters:** removes the single most common source of fetch friction and unifies auth
    — one Figma connection (the registry's) instead of a per-developer PAT treadmill.

---

## Feature initiative — Image sizing guide

One of the biggest gaps in any handoff process: designers know exactly what size an image
should be, but that knowledge lives only in the Figma file. Content teams guess, placeholders
get the wrong aspect ratio, and image slots get blown up by wrongly-proportioned photos.

Figma already encodes everything needed — every image fill node carries `absoluteBoundingBox`,
`fills[].scaleMode`, `layoutSizingHorizontal/Vertical`, and `minWidth`/`minHeight`. The node
tree is already walked during `fetch` to extract `imageRef` fills. The gap is capturing the
sizing metadata alongside the image reference and surfacing it as first-class guidance.

**Data model decision: `handoff_image_slot` table (Option B)**

A new table rather than augmenting `handoff_asset_usage`, because a slot is a *specification*
that exists independent of whether an image has been assigned to it. Fields: `id`, `componentId`,
`variantKey`, `slotName`, `nodeId`, `recommendedWidth`, `recommendedHeight`, `aspectRatioW`,
`aspectRatioH`, `scaleMode`, `isResponsive`, `minWidth`, `minHeight`.

**Phase A — Capture: augment the node tree walk**

`imageAssetsFromNodeTree()` in `component-linking.ts` already visits every image fill node.
Extend `FigmaImageAsset` to carry:
- `boundingBox: { width: number; height: number }` — from `absoluteBoundingBox`
- `scaleMode: 'FILL' | 'FIT' | 'CROP' | 'TILE'` — from `fills[].scaleMode`
- `isResponsive: boolean` — `layoutSizingHorizontal === 'FILL'`
- `minWidth?: number`, `minHeight?: number` — if set on the node

These are zero-additional-API-calls — data already present in the downloaded node tree, just
not being saved. Compute and store the GCD-simplified aspect ratio (`16:9`, `4:3`, `1:1`) at
this stage. Write image slot specs into the fetch output alongside `figma-fills/`.

**Phase B — Store: push `handoff_image_slot` records**

During `push:all`, read the slot spec manifest from the fetch output and POST to a new
`/api/registry/assets/image-slots` endpoint. The registry upserts by `(componentId, slotName,
variantKey)` — re-pushing is always idempotent. The push follows the same per-record pattern
as font files and Figma image fills.

**Phase C — Surface: per-component "Image Slots" tab**

On the component detail view, add an "Image Slots" tab alongside Props, Variants, etc.
For each slot:
- Aspect ratio (the headline — `16:9`, `12:5`, `1:1`)
- Recommended pixel dimensions at canvas scale (`1440 × 600 px`)
- Fill mode (`FILL — image crops to fit`, `FIT — letterboxed`, etc.)
- Responsive indicator + minimum dimensions when applicable
- Variant breakdown if the slot size differs across Figma variants (mobile vs. desktop)
- Deep link back to the Figma node
- CSS snippet: `aspect-ratio: 16 / 9; object-fit: cover;`

**Phase D — Foundation page: `/foundation/assets/sizing`**

A cross-component sizing reference page — the page content teams bookmark. Lists all image
slots across the whole design system, filterable by aspect ratio (e.g. "show me all 16:9
slots" or "show me all avatar/circular slots"). Each row links to the component where the
slot lives. Built as a native foundation page inside the handoff app (consistent with the
Phase 2 foundation-page-anatomy pattern).

**Tertiary: inline in the asset DAM**

When viewing an uploaded image asset, show which component slots reference it alongside a
sizing conformance indicator — does the uploaded image's actual pixel dimensions match the
slot's spec? Flag mismatches. This closes the loop: a content author uploads an image, the
DAM tells them immediately whether it will work in the hero slot.

**Validation: placeholder dimensions as ground truth**

For projects like SSC that have correctly-sized placeholder images, the push step can read
pixel dimensions directly from PNG/JPEG headers (no Figma API needed). Cross-reference
against the Figma-derived slot spec. If they agree, mark the slot as validated. If they
differ, flag it — either the placeholder is wrong or Figma was updated since the placeholder
was set.

**Future (not in these phases)**

- Per-component Figma image fetch — rather than downloading all image fills from the library
  file at once, associate fetched images with specific component image slots. Gated on the
  broader work connecting components to Figma nodes bidirectionally (the "components ↔ figma
  pull/push" initiative).
- Breakpoint-aware sizing recommendations — for responsive slots, emit recommended dimensions
  at each configured breakpoint rather than just the canvas design size.
- Image optimization guidance — based on slot dimensions, recommend appropriate format
  (WebP/AVIF), compression targets, and srcset breakpoints.
