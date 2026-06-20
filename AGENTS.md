# Handoff App — Agent Context

This document exists to give AI agents the architectural context needed to make correct
decisions. Read it fully before modifying data flow, storage, API routes, CLI commands,
or page-rendering code.

---

## The Two Concepts: Workspace and Registry

Handoff has exactly two roles. Every piece of code serves one of them.

### Workspace
A **workspace** is a client project repo (e.g. `ssc-handoff-next/handoff/`). It contains:
- Component source files and build artifacts
- Page and doc markdown
- `handoff.config.js` — project identity and settings
- A `design-system/` directory (DTCG token pipeline, new as of Phase 0/1)

The workspace **never deploys itself**. It uses `handoff-app` as a CLI tool:
- `handoff-app dev` — runs a local, filesystem-backed preview of the site (Static mode)
- `handoff-app fetch` — pulls design tokens from Figma into `public/api/tokens/`
- `handoff-app push:all` — pushes all workspace data to a remote registry via HTTP API

### Registry
A **registry** is a clean, standalone deployment of the `handoff-app` Next.js server (e.g. on Vercel). It:
- Contains **no client-specific data** at deploy time
- Stores all tenant data in **Postgres** after workspaces push to it
- Is multi-tenant in the sense that one registry serves one workspace (one `figma_project_id`)
- Serves foundation pages, component docs, changelog, etc. by reading entirely from the database

**`ssc-handoff.vercel.app` is a registry. It is a clean handoff-app deploy. SSC data arrived
there via `push:all`, not by building the SSC workspace.**

---

## Data Flow (end to end)

```
Figma
  ↓  handoff-app fetch
Workspace: public/api/tokens/{color,typography,effect}.json
  ↓  scripts/tokens-to-dtcg.js   (Phase 0 — DTCG conversion)
Workspace: design-system/tokens/{primitive,semantic}/*.tokens.json
  ↓  scripts/tokens-transform.js  (Phase 1 — Style Dictionary)
Workspace: design-system/dist/{css,scss,tailwind,dtcg}/
  ↓  handoff-app push:all
Registry API (HTTP POST to /api/registry/*)
  ↓  stored in Postgres
Registry serves pages via DynamicDataProvider (DB reads)
```

Everything on the left of the arrow lives in the workspace repo. Nothing on the right
is baked into the `handoff-app` source code — it arrives at runtime via push.

---

## DataProvider Pattern

This is the most important pattern in the codebase. **All data reads in page components
must go through the DataProvider.** Never read directly from the filesystem in a way
that only works for workspace-dev mode.

```
getDataProvider()  →  StaticDataProvider  (workspace dev — reads filesystem)
                  →  DynamicDataProvider (registry — reads Postgres)
```

`StaticDataProvider` reads from the workspace filesystem using `HANDOFF_WORKING_PATH`.
`DynamicDataProvider` reads from the Postgres database.

The switch happens at startup based on whether a database URL is configured.

### The wrong pattern (do not copy)
```ts
// BAD: only works in workspace dev mode, silently returns null on the registry
const raw = fs.readFileSync(path.join(process.cwd(), 'design-system/dist/...'));
```

### The correct pattern
Add the data you need to the `DataProvider` interface. Implement it in both providers.
Call it through `getDataProvider()` in your page server component.

---

## Push/Pull CLI Commands

### push:all
Orchestrates a full workspace sync to the registry. Calls these endpoints in sequence:

| Endpoint | Payload | Source in workspace |
|---|---|---|
| `POST /api/registry/config` | handoff.config.js app block | `handoff.config.js` |
| `POST /api/registry/theme` | theme.css content | `theme.css` |
| `POST /api/registry/navigation` | page tree | derived from `pages/` |
| `POST /api/registry/pages` | all markdown + frontmatter | `pages/**/*.md` |
| `POST /api/registry/tokens` | raw Figma token snapshot | `public/api/tokens.json` |
| `POST /api/registry/dtcg` | DTCG manifest + compiled dist (CSS/SCSS/Tailwind/JSON) | `design-system/manifest.json` + `design-system/dist/` |
| `POST /api/registry/icons` | icon catalog (IconCatalogEntry[]) | `icons/catalog.json` |
| `POST /api/registry/logos` | logo set (LogoSet) | `logos/logo-set.json` |

### push (component sync)
Pushes individual components, patterns, and pages via `POST /api/sync/upload`.
Includes declaration metadata, build artifacts, source files, and screenshots.

### pull
Pulls changeset from `GET /api/sync/changes` and writes back to the workspace:
pages, component declarations, build artifacts, source files.

---

## DTCG Token Pipeline (Phases 0–1)

The DTCG pipeline is a new addition layered on top of the existing raw-token pipeline.

**Phase 0** (`scripts/tokens-to-dtcg.js`): reads Figma-extracted tokens from
`public/api/tokens/*.json` and writes DTCG 2025.10 format to `design-system/tokens/`.
Also picks up any hand-authored token files (e.g. `spacing.tokens.json`).

**Phase 1** (`scripts/tokens-transform.js`): runs Style Dictionary v4 over
`design-system/tokens/` and writes four output formats to `design-system/dist/`:
- `css/tokens.css` — CSS custom properties
- `scss/_tokens.scss` — Sass variables
- `tailwind/theme.css` — Tailwind 4 `@theme {}` block
- `dtcg/tokens.resolved.json` — alias-resolved DTCG passthrough

**Run**: `npm run tokens:build` from `handoff/` in the workspace.

### DTCG and the registry

`src/app/components/util/dtcg.ts` is now an async thin wrapper that delegates to
`getDataProvider()`. Both modes work:

- **StaticDataProvider** (workspace dev): reads `design-system/dist/` from the filesystem
  using `HANDOFF_WORKING_PATH`.
- **DynamicDataProvider** (registry): reads from the `handoff_registry_dtcg` Postgres table,
  populated by `push:all` step 7.

The full pipeline:
1. Workspace runs `npm run tokens:build` → produces `design-system/dist/`
2. `push:all` calls `pushRegistryDtcg()` → POSTs to `POST /api/registry/dtcg`
3. Registry stores the payload in `handoff_registry_dtcg` (singleton upsert)
4. Foundation pages call `getDtcgTokenStrings(type)` / `getDtcgManifest()` through
   the DataProvider — this now works on both workspace dev and the deployed registry.

---

## Foundation Pages

The foundation pages (`/foundations/colors`, `/foundations/typography`, etc.) are
framework page templates in `src/app/app/foundations/`. They render:

1. **Visual preview** — color swatches, type scale, spacing bars, etc.
   - Reads raw token data via `getDataProvider().getTokens()` (works in both modes)
2. **TokenOutputTabs** — CSS / SCSS / Tailwind / DTCG code blocks with copy + download
   - Reads from `dtcg.ts` → needs DataProvider integration (current gap above)
3. **ProvenanceBadge** — sync state indicator (source, last synced)
   - Reads from `dtcg.ts` → same gap

**Default docs** for foundation pages live in `config/docs/foundations/*.md` inside
`handoff-app`. These are fallbacks. A workspace can override them by placing files at
`pages/foundations/*.md`.

---

## Three Access Surfaces

Every piece of design system data in Handoff is structured to be consumed via three surfaces.
When adding new data types (icons, tokens, components, etc.), implement all three.

### 1. UI — Foundation & component pages

Pages under `src/app/app/foundations/` and `src/app/app/[...slug]/` render data from
the DataProvider into visual documentation. The rules:
- Always read through `getDataProvider()` — never directly from the filesystem in page components
- Use `InlineEditHeader` for user-editable title/description (persisted to `handoff_page`)
- Use `TokenOutputTabs` for code output blocks
- Pages must render a useful empty state when data hasn't been pushed yet

### 2. REST API — Machine-readable endpoints

The full API is documented as an **OpenAPI 3.1 spec** at:

- **Static file**: `public/openapi.yaml` (served at `/openapi.yaml` on any deployed registry)
- **API route**: `GET /api/openapi` (same content with CORS headers; use this URL in Swagger UI, Redoc, Postman)
- **Footer link**: Every registry page links to `/openapi.yaml` in the footer

**Keeping the spec current** — whenever you add or change an API route:
1. Update `public/openapi.yaml` — add/edit the path under `paths:`, add any new schemas to `components/schemas:`
2. Keep `info.version` in sync with the release milestone (currently `2.0.0-alpha`)
3. The route file at `src/app/app/api/openapi/route.ts` reads and serves the YAML directly — no codegen step required

Registry API routes live in `src/app/app/api/registry/`. Each data type has:

| Data type | Push endpoint | Read endpoint |
|---|---|---|
| Config | `POST /api/registry/config` | served via DataProvider at runtime |
| Theme | `POST /api/registry/theme` | `GET /api/registry/theme.css` |
| Navigation | `POST /api/registry/navigation` | served via DataProvider |
| Page content | `POST /api/registry/pages` | `GET /api/registry/pages?slug=...` |
| Figma tokens | `POST /api/registry/tokens` | `GET /api/registry/tokens` |
| DTCG tokens | `POST /api/registry/dtcg` | `GET /api/registry/dtcg` |
| Icons | `POST /api/registry/icons` | `GET /api/registry/icons` |
| Logos | `POST /api/registry/logos` | `GET /api/registry/logos` |
| Components | via `POST /api/sync/upload` | `GET /api/handoff/components` |

Public GET endpoints return JSON. Authenticated MCP/API consumers can read all surfaces.
POST (push) endpoints require `Authorization: Bearer <sync-token>`.

Additional API groups covered by the spec:
- **Sync** (`/api/sync/*`) — component upload / changeset pull
- **Changelog** (`/api/handoff/changelog`) — unified entity change history
- **Pages / Patterns / Assets** — session-authenticated CRUD
- **OAuth** (`/api/oauth/*`) — RFC 8628 device authorization for CLI login
- **MCP** (`/api/mcp`) — Model Context Protocol server (SSE + HTTP transports)
- **Admin / AI / Figma** — internal surfaces; documented but subject to change pre-2.0

### 3. MCP — Agent-accessible tools

MCP tools live in `src/app/lib/mcp/create-server.ts`. Each data type should have at minimum:
- A **get** tool (returns the full dataset or a single item by id)
- A **search** tool (filters by name/tag/category substring)

| Data type | MCP tools |
|---|---|
| Project context | `handoff_get_project_context` |
| Stack guide | `handoff_get_stack_guide` |
| Components | `handoff_search_components`, `handoff_get_component` |
| Tokens | `handoff_get_tokens` |
| Icons | `handoff_get_icon_catalog`, `handoff_search_icons` |
| Logos | `handoff_get_logo_set` |
| Assets | `handoff_search_assets`, `handoff_get_asset` |
| Design artifacts | `handoff_get_design_artifact`, `handoff_list_design_artifacts` |

MCP tools must always call `getDataProvider()` — they run in the registry context where
the database is available. Never read from the filesystem in MCP tool handlers.

### Adding a new data type — checklist

When you add a new foundation type (e.g. motion tokens, brand voices), follow this checklist:

- [ ] Add TypeScript types to `src/app/lib/data/types.ts`
- [ ] Add `get<Type>()` to the DataProvider interface
- [ ] Implement in DynamicDataProvider (DB read) and StaticDataProvider (filesystem read)
- [ ] Add `handoff_registry_<type>` singleton table to `schema-pg.ts` + migration SQL file
- [ ] **Add the migration to the journal** — append an entry to `src/app/lib/db/migrations/meta/_journal.json` with the next `idx` value and a `tag` matching the SQL filename (without `.sql`). Without this, Drizzle's migrator ignores the file entirely.
- [ ] Create `POST /api/registry/<type>` and `GET /api/registry/<type>` API routes
- [ ] Add `push<Type>()` to `push-registry-content.ts`
- [ ] Add push step to `push:all` command + update AGENTS.md push table
- [ ] Update the foundation UI page to read from DataProvider
- [ ] Add MCP tool(s) to `create-server.ts`
- [ ] **Add the new endpoints to `public/openapi.yaml`** — both the path entry and any new component schemas
- [ ] Update AGENTS.md

---

## Database Migrations — Critical Rule

**Every new migration SQL file MUST be registered in the journal or it will never run.**

Drizzle's `migrate()` reads `src/app/lib/db/migrations/meta/_journal.json` exclusively. A `.sql` file
with no journal entry is silently ignored — the table will never be created on deployed registries.

When you create `src/app/lib/db/migrations/NNNN_<name>.sql`:

1. Write the SQL file with `CREATE TABLE IF NOT EXISTS` (idempotent).
2. Append to `_journal.json`:
   ```json
   {
     "idx": <next integer>,
     "version": "7",
     "when": <unix-ms timestamp>,
     "tag": "NNNN_<name>",
     "breakpoints": true
   }
   ```
3. Use a timestamp safely in the future of the prior entry (e.g. add 100000 ms).

Do NOT use `drizzle-kit push` on production databases — only `migrate()` via the auto-migrate path.

---

## Spacing — Phase 2 Addition

Spacing tokens are **hand-authored** in the workspace, not extracted from Figma.

- Source: `design-system/tokens/primitive/spacing.tokens.json` in the workspace
- Scale: SSC-specific values derived from `$spacer-base: 1.25rem` (Bootstrap-derived scale)
- The `tokens-to-dtcg.js` script auto-discovers hand-authored token files and merges
  their counts into the manifest without overwriting them.
- The `/foundations/spacing` page is a framework page template that renders the
  spacing scale visually and shows `TokenOutputTabs`.

---

## Key Env Variables

| Variable | Purpose | Set by |
|---|---|---|
| `HANDOFF_WORKING_PATH` | Absolute path to the workspace directory | `handoff-app dev` / CLI startup |
| `HANDOFF_APP_ROOT` | Absolute path to the materialized Next.js app root | `next.config.mjs` at build time |
| `HANDOFF_MODULE_PATH` | Path to the handoff-app package itself | CLI startup |
| `DATABASE_URL` | Postgres connection string | Vercel env / local `.env` |

When `DATABASE_URL` is set, `getDataProvider()` returns `DynamicDataProvider` (registry
mode). When absent, it returns `StaticDataProvider` (workspace dev mode).

---

## What NOT to do

- Do not read workspace files (tokens, components, config) directly from `process.cwd()`
  or `HANDOFF_WORKING_PATH` in page server components. That code runs on the registry
  where those paths don't exist.
- Do not bundle SSC-specific data (token JSON files, design-system dist) into the
  `handoff-app` repository. The framework contains no tenant data.
- Do not add `tokens:build` or similar workspace build steps to `handoff-app`'s
  `package.json`. Those commands belong in workspace repos.
- Do not treat the workspace's `build:vercel` script as a registry deploy. Workspaces
  do not deploy to Vercel. Registries do.

---

## Per-Client Workspace Repos

| Client | Workspace | Registry URL |
|---|---|---|
| SS&C | `ssc-handoff-next/handoff/` | ssc-handoff.vercel.app |
| Cynosure | cynosure-hq (v1, pre-DTCG) | TBD |
| Resolvet / Hagyard | `resolvet/handoff/` | hagyard-handoff.vercel.app |
