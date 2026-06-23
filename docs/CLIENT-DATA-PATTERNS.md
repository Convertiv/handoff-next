# Client Data Management Patterns

A cross-client analysis of how the four active Handoff deployments manage their data — tokens, images, components, and Figma integration — with notes on what varies and what the coherent recommended pattern looks like.

---

## The Four Clients

| Client | Registry URL | Stack | Brands | Components | handoff-app |
|---|---|---|---|---|---|
| **8x8** | 8x8-handoff.vercel.app | Tailwind v4 + React+HBS | 1 (default) | 70 | feature/mcp-prototype |
| **SS&C** | ssc-handoff.vercel.app | Bootstrap 5 + Handlebars | 0 (no brands/) | 83 | feature/mcp-prototype |
| **Resolvet** | — | Tailwind v4 + React | 2 (resolvet, hagyard) | 119 | feature/mcp-prototype |
| **Cynosure** | — | Tailwind v4 + Handlebars | 0 (no brands/) | 103 | **1.2.2-4** (release!) |

---

## 1. CSS Framework

### Observed pattern

Three of four clients use **Tailwind v4** as the primary CSS framework. SS&C is the sole Bootstrap 5 client and is the only project with `stackProfile: "bootstrap-handlebars"` set explicitly.

Cynosure uses Tailwind v4 for its component system but has Bootstrap 5 in `package.json` as well (inherited from the WordPress build pipeline, not the component system).

### Config surface

```js
// handoff.config.js
app: {
  stackProfile: 'bootstrap-handlebars'  // SS&C only; others omit
}
```

### Recommended pattern

- Set `stackProfile` explicitly on every project. React+Tailwind clients should use `react-tailwind`. Handlebars+Tailwind clients should use a `tailwind-handlebars` profile when one exists.
- The absence of `stackProfile` means Handoff uses default heuristics — fine for prototyping, fragile for production.

---

## 2. Templating Engine

### Observed pattern

Two hybrid models exist:

| Client | Atoms | Blocks/Pages |
|---|---|---|
| 8x8 | React TSX (imports `8x8-component-library`) | Handlebars `.hbs` (also has `.tsx` in some) |
| SS&C | Handlebars | Handlebars |
| Resolvet | React TSX (`defineReactComponent`) | React TSX |
| Cynosure | Handlebars | Handlebars |

8x8 is the only hybrid — its atom-level components are React because they're built in and imported from the monorepo's `component-library` package. Blocks are Handlebars for easy CMS/snippet embedding.

### Recommended pattern

Choose one templating engine per project and enforce it. The hybrid at 8x8 works because atom React components are consumed through a completely different path (npm package) from block Handlebars templates — they don't share rendering context. If a project truly needs both, document which layer is which.

---

## 3. Token Structure

This is the most variable axis across clients.

### Observed structures

```
8x8:        tokens/brands/default.tokens.json       ← flat brand file
            tokens/color.tokens.json                ← flat root files
            tokens/grid.tokens.json, etc.

SS&C:       tokens/primitive/*.tokens.json           ← no brands/
            tokens/semantic/typography.tokens.json

Resolvet:   tokens/brands/resolvet.tokens.json      ← multi-brand
            tokens/brands/hagyard.tokens.json
            tokens/primitive/color.tokens.json
            tokens/semantic/typography.tokens.json
            tokens/shared/border-radius.tokens.json ← extra tier

Cynosure:   tokens/primitive/color.tokens.json
            tokens/semantic/ (exists)               ← no brands/
```

### Implications

- **Colors page** only renders from `brands/` by default. SS&C and Cynosure have no `brands/` directory, so the colors page falls back to `localStyles.color` from the Figma export snapshot (92 Figma color styles → synthetic "default" brand). This fallback is now built into the app.
- **8x8** has one brand (`default`) in `brands/` — works correctly with the standard path.
- **Resolvet** is the only fully correct multi-brand setup: two brands, each with a matching CSS file in the monorepo's `packages/ui/src/styles/brands/`.

### Recommended pattern

All projects should adopt the `primitive/` + `semantic/` + `brands/` three-tier structure:

```
tokens/
  primitive/       ← raw values (colors, shadows)
  semantic/        ← role-mapped aliases (typography roles)
  brands/          ← one file per brand; references primitive/semantic
    default.tokens.json   ← always include a default
    [brand].tokens.json   ← additional brands
```

The `brands/` directory is the signal that drives the Colors, Effects, and Typography display pages. Without it, display falls back to `localStyles` (Figma snapshot) which is read-only and can't be organized into groups.

Single-brand projects should still have `brands/default.tokens.json` — it keeps the data path consistent.

---

## 4. Multi-Brand Setup

### Observed pattern

Only **Resolvet** is a true multi-brand deployment:
- `tokens/brands/resolvet.tokens.json` + `tokens/brands/hagyard.tokens.json`
- Brand CSS lives in the **monorepo** at `packages/ui/src/styles/brands/[brand].css`, not in the handoff workspace
- Config wires brands to external CSS via `brands.entries`:

```ts
// handoff.config.ts (V2 format)
brands: {
  sharedCss: '../packages/ui/src/styles/theme.css',
  entries: {
    resolvet: '../packages/ui/src/styles/brands/resolvet.css',
    hagyard: '../packages/ui/src/styles/brands/hagyard.css',
  }
}
```

### Recommended pattern

For multi-brand projects in a monorepo, brand CSS should live in the shared package (`packages/ui`) and be referenced by path from the handoff config. The handoff workspace should own only the token JSON files; the CSS lives where the rest of the product code uses it.

For single-brand projects, a `brands/default.tokens.json` in the workspace is sufficient. No external CSS reference needed.

---

## 5. Component Organization

### Entries and naming conventions

```js
// 8x8
entries.components: ['./components/atoms', './components/blocks', './components/navigation']

// SS&C (unique: has a "data" category)
entries.components: ['./integration/atoms', './integration/data', './integration/components']

// Resolvet
entries.components: ['atoms', 'blocks']

// Cynosure (unique: uses "nextgen/" prefix and has "elements" vs "components")
entries.components: ['./nextgen/components', './nextgen/elements']
```

SS&C is the only client with a first-class `data` entry type (7 data visualization components). This is a meaningful distinction from regular `components` because data viz components have no static preview.

Cynosure uses `elements` (41 directories) to distinguish smaller, reusable primitives from full `components` (62 directories) — functionally the same as atoms/blocks but named differently.

### Recommended pattern

Settle on two or three entry types:
- `atoms` / `elements` — small, reusable primitives
- `components` / `blocks` — full layout sections
- `data` — data visualization components (optional, for chart-heavy projects)

Avoid project-specific prefixes (`integration/`, `nextgen/`) in entry paths — they leak implementation details into component IDs and make migration harder.

---

## 6. Image Storage

### Observed patterns

Four distinct image storage approaches:

| Client | Source location | How referenced in templates | Push path |
|---|---|---|---|
| **8x8** | `handoff/images/`, `handoff/public/images/` | `https://placehold.co/…` (hardcoded placeholder) | Via per-image endpoint |
| **SS&C** | `handoff/public/images/`, `handoff/integration/images/` | Handlebars: `{{properties.backgroundImage.src}}` | Via per-image endpoint |
| **Resolvet** | `handoff/public/images/figma-export/[page]/` | Component `.handoff.ts`: `/images/components/…` | Via per-image endpoint |
| **Cynosure** | `handoff/images/nextgen/figma-export/[page]/` | Handlebars: `{{slide.image.src}}`, `{{properties.image.src}}` | Via per-image endpoint |

Resolvet and Cynosure both organize Figma-exported images under `figma-export/[page-name]/` — this comes from Figma's own section/page structure. 8x8 and SS&C use a flatter structure without the Figma page grouping.

The **per-image push endpoint** (`/api/registry/assets/ingest`) is now the universal path for all four clients. Images are content-addressed (`img_<sha256[:12]>`) and stored separately from component payloads.

### The image reference rewrite flow

1. CLI collects component artifact text + source files
2. `collectReferencedImages()` extracts image refs (quoted strings, CSS url()), resolves them to local files, assigns content-addressed IDs
3. `applyImageRewrites()` replaces original refs with `/api/handoff/assets/{assetId}/raw`
4. Component payload is pushed (with rewritten artifact text)
5. Images are pushed separately via `pushComponentImages()` → per-image POST

This means the registry always serves images from its own asset store, regardless of where they lived locally.

### Recommended pattern

- Keep source images under `public/images/` so the CLI resolver finds them without special config
- For Figma-exported page images, use `public/images/figma-export/[page-name]/` consistently
- Use Handlebars property bindings (`{{properties.image.src}}`) rather than hardcoded paths — they work with the push rewrite system
- Avoid `https://placehold.co/` in production components — these don't get rewritten and won't show real content in the registry

---

## 7. Monorepo Structure

### Observed patterns

All four clients are in monorepos, but with very different shapes:

**8x8** — npm workspaces, handoff is a peer workspace
```
8x8-website/
  handoff/          ← handoff workspace, imports from siblings
  component-library/ ← atoms live here, consumed by handoff
  web/
  studio/
  common/
```
Unique: atoms are built in `component-library` and imported into handoff as a package dependency.

**SS&C** — monorepo with `handoff/` as a subdirectory, `handoff-app` installed at the **root**
```
ssc-handoff-next/
  handoff/          ← workspace (no handoff-app dep here)
  src/              ← Next.js app
  components/
  patterns/
  package.json      ← handoff-app installed here
```
Unique: `handoff-app` is a root dependency, not a workspace dependency. This means handoff CLI commands are run from the monorepo root.

**Resolvet** — pnpm workspaces + Turbo, brand CSS lives outside handoff
```
resolvet/
  handoff/          ← workspace
  packages/
    ui/
      src/styles/brands/  ← brand CSS referenced by handoff config
  web-resolvet/
  web-hagyard/
  shopify-app/
```
Unique: brand CSS in `packages/ui` — handoff config uses `../packages/ui/src/…` relative paths.

**Cynosure** — npm workspaces, handoff nested deep inside WordPress project
```
cynosure-hq/
  src/
    handoff/        ← workspace (at src/handoff/)
    wp-content/     ← WordPress
    html/
  docker-compose.yml
```
Unique: the deepest nesting — `src/handoff/` rather than `handoff/` at root.

### Recommended pattern

Prefer `handoff/` at the monorepo root (one level below the workspace root) for predictable relative paths. Deeply nested locations (like `src/handoff/`) make relative path config (`brands.entries`, `scss` paths) verbose and error-prone.

Install `handoff-app` as a dependency **in the handoff workspace's own `package.json`**, not at the monorepo root. This makes the workspace self-contained and avoids version conflicts.

---

## 8. Logos and Icons

| Client | logos/logo-set.json | icons/catalog.json | Notes |
|---|---|---|---|
| 8x8 | ✓ | ✓ | icons are React JSX strings (extracted via `extract-icons.mjs`) |
| SS&C | ✓ | ✓ | 3 logo variants, 8 icon entries (social/navigation/interface) |
| Resolvet | ✓ | ✓ | multiple brand logos in public/ root |
| Cynosure | ✗ | ✗ | 46 SVGs in public/svg/, logos.zip in public/ — **not yet extracted** |

Cynosure is the only client missing both `logos/logo-set.json` and `icons/catalog.json`. The raw assets exist (SVGs in `public/svg/`, zipped logo set) but haven't been wired into the Handoff foundation format.

### Recommended pattern

Every client should have both `logos/logo-set.json` and `icons/catalog.json` extracted and committed in the handoff workspace. These are foundation pages — without them, the Logos and Icons nav items point to empty pages.

Icon format: prefer `{ type: 'custom', svg: '...' }` with the SVG string inline. React JSX (as 8x8 uses) works but requires a JSX render context; plain SVG strings work everywhere.

---

## 9. Figma Data Structures

### Config format

Resolvet uses the **V2 config format** (`defineConfig`, camelCase keys like `figmaProjectId`). The other three use **V1 format** (`module.exports`, snake_case like `figma_project_id`).

### What gets pulled from Figma

All four clients pull:
- Component instances and their variants/properties
- Local styles (color, typography) → `localStyles.color`, `localStyles.typography` in tokens.json
- Text styles and color styles → feeds the DTCG pipeline

Resolvet and Cynosure also have custom Figma-extraction scripts for page-level image exports (`figma-extract-design-images.js`, `generate-image-browser.js`) — these run outside the Handoff CLI and produce the `figma-export/` image directories.

### Token snapshot

The `tokens.json` snapshot (pushed by `handoff-app push:all`) includes:
- `localStyles.color` — array of all Figma color styles with group/subgroup structure
- `localStyles.typography` — typography style metadata
- `localStyles.effects` — shadow and blur styles

This snapshot is the authoritative record of what Figma had at push time. The DTCG token files in `design-system/tokens/` are the curated, versioned source-of-truth.

---

## 10. The Version Gap

Cynosure is on **`handoff-app@1.2.2-4`** (a semver release from a tagged branch), while 8x8, SS&C, and Resolvet are all on **`feature/mcp-prototype`** (the current development branch).

This means Cynosure is missing:
- Per-image push endpoint (`/api/registry/assets/ingest`)
- Image rewrite system in push pipeline
- DTCG localStyles fallback on colors page
- Sidebar `defaultOpen` auto-detect fix
- Any MCP-related features

Cynosure should be migrated to the `feature/mcp-prototype` branch before new client-facing features are built on it.

---

## Summary: Variation Axes and Recommended Config

| Axis | Currently varies | Recommended target |
|---|---|---|
| `stackProfile` | 1 of 4 sets it | Set on all projects |
| Templating | React, Handlebars, hybrid | One per project; document hybrid layers |
| Token structure | 4 different shapes | `primitive/` + `semantic/` + `brands/` always |
| Single-brand token file | Missing on 2 clients | `brands/default.tokens.json` always |
| Image source location | Various | `public/images/` root; `public/images/figma-export/[page]/` for Figma exports |
| Image refs in templates | Hardcoded URLs, property bindings | Always use property bindings |
| handoff-app install location | Root vs workspace | Always in workspace `package.json` |
| handoff-app version | Release vs branch | All on same branch/release |
| logos/logo-set.json | 3 of 4 | All 4 |
| icons/catalog.json | 3 of 4 | All 4 |
| Figma config format | V1 (3) + V2 (1) | V2 for new projects; migrate V1 |
| Component entry naming | 4 different conventions | `atoms`, `components`/`blocks`, optional `data` |

---

*Last updated: 2026-06-22. Surveys run against: 8x8 (`cPhnIGloI3RSykDUgu4x5M`), SS&C (`0gKWw8gYChpItKWzh8o23N`), Resolvet (`vKhEowk4cfs2jaOLuBrAPJ`), Cynosure (`3GcQn3eA8Kg9kprYXBXksv`).*
