# Handoff change digest (2.0)

**Since:** `6a6cd5f502fe10deb694ce5edd2a97d613bf4ae4` (`1.2.2-6`, 2026-04-18)  
**Through:** `bb2ac1d` (HEAD)  
**Scope:** 46 commits · 456 files · ~+52k / −14k lines  
**Version:** `1.2.2-6` → **2.0.0**

This span is effectively a **next-generation Handoff**: the same Figma → tokens → docs pipeline, but the documentation app is now a full **database-backed Next.js server** with auth, AI, team sync, and new builder surfaces—not a static export–oriented docs site.

---

## Executive summary

| Area | Then (`6a6cd5f`) | Now |
|------|------------------|-----|
| **Docs app** | Pages Router (`src/app/pages/`) | App Router (`src/app/app/`) |
| **Deployment** | Static export / dual-mode mental model | Always a Node server; Vercel “ephemeral runtime” pattern |
| **Data** | Files + JSON APIs on disk | SQLite locally or Postgres for team; DB overlays filesystem |
| **Auth** | None | NextAuth v5, roles, invites, password reset |
| **New surfaces** | — | Playground, Design workbench, Design library, Admin console |
| **CLI** | fetch, start, build | + push/pull, login, figma audit, Vercel/prepare-runtime |
| **Node** | ≥16 | **≥20.9** |
| **Package** | CommonJS-style build | **`"type": "module"`** + ESM dist fixups |

---

## Big features added

### 1. Playground (pattern builder)

Visual page builder for composing patterns from the component catalog:

- Drag-and-drop canvas (`@dnd-kit`)
- Save/load patterns (DB-backed when Postgres is configured)
- **“Generate with AI”** wizard (BYOK OpenAI key in browser, or server key via admin integrations)
- Dedicated route: `/playground` with doc page integration

**Commits:** `04b3c3d8` (initial), merged via `feature/playground-design` / `feature/handoff-next`.

---

### 2. Design workbench & design library

AI-assisted design exploration tied to your design system:

- **`/design`** — workbench: reference images, component guides, foundation context, iterative image generation, annotations, zoom/pan, conversation history
- **`/design/library`** — saved design artifacts (draft / review / approved)
- **`/design/library/[id]`** — detail view, public share pages, **generate component from design**
- **`/design/settings`** — quality presets, include foundations, component reference toggles
- **Asset extraction** — background worker splits designs into composite assets (`design-asset-worker`, extract API)
- **Cloud AI proxy** — local installs can forward AI to a team server when `HANDOFF_CLOUD_URL` + token are set (no local OpenAI key)

**APIs:** `generate-design`, `design-artifact`, `design-artifact-extract`, `foundation-preview`, `generate-component`, `component-screenshot`, etc.

---

### 3. Authentication, users, and admin

Full team mode when `DATABASE_URL` is set:

- **NextAuth v5** (`/api/auth/[...nextauth]`)
- Credentials + optional OAuth providers
- **Roles** (`admin` / `member`) — admin gates for builds, component PATCH, integrations
- **User admin** — invite, remove, role changes (`/admin/users`)
- **Password reset** — email via Resend (`request-reset`, `reset-password`)
- **Middleware** — JWT gate on `/admin` in Postgres mode; open in local SQLite mode
- **Extensible middleware hook** (`middleware-hook.mjs`) for host-specific rules

**Admin areas:**

| Route | Purpose |
|-------|---------|
| `/admin/users` | User management |
| `/admin/builds` | Component build job queue |
| `/admin/integrations` | Figma OAuth, Playground AI key, sync secrets |
| `/admin/ai-cost` | AI usage / cost analytics |
| `/admin/reference` | LLM reference materials (catalog context) |

---

### 4. Database-backed components & live builds

Components and pages can live in the DB as well as on disk:

- **`DynamicDataProvider`** merges filesystem + DB (DB wins on conflicts)
- **Admin UI** — create/edit components in-app, markdown page editing
- **Async Vite build pipeline** — `POST /api/handoff/components/build` → worker → preview under `public/api/component/`
- **Security baseline** documented in [SECURITY-COMPONENT-BUILDS.md](./SECURITY-COMPONENT-BUILDS.md) (admin-only writes, slug validation, sandboxed previews, rate limits, stripped worker env)

---

### 5. Figma integration upgrades

Beyond CLI `fetch` with a personal access token:

- **Figma OAuth** for GUI-driven token fetch (admin integrations)
- **Figma sync UI** — `/system/figma-sync`
- **Component sync API** — list/sync component properties from Figma (`/api/handoff/figma/*`)
- **CLI audit/scaffold** — `handoff-app audit:figma-components`, improved `scaffold` flow linking Figma components to local declarations
- **`handoff-figma-plugin`** — sibling repo; API contract mirrored in `src/app/lib/figma-plugin-contract.ts` (not an npm workspace dependency)

Recent work (latest commits) focuses on **better Figma ↔ component sync** and path fixes.

---

### 6. Team sync (CLI push / pull)

Hosted Handoff as source of truth for components, patterns, and markdown pages:

- **`handoff-app push`** / **`pull`** / **`sync-status`**
- **`/api/sync/upload`**, **`/api/sync/changes`**, **`/api/sync/status`**
- Append-only **`sync_event`** ledger in Postgres
- Selective push: `--components`, `--patterns`, `--pages`, `--dry-run`
- Conflict files under `.handoff/conflicts/` on pull

See [COMPONENT_SYNC_CURRENT_STATE.md](./COMPONENT_SYNC_CURRENT_STATE.md).

---

### 7. CLI device login (OAuth device flow)

RFC 8628–style login for developers (no long-lived secrets in shell history):

- **`handoff-app login`** → device code → browser approval at **`/cli/device`**
- **`handoff-app logout`**
- Tokens stored in `.handoff/cli-auth.json`
- **`cli_device_session`** table + JWT access tokens (`handoff-cli-sync` audience)
- Legacy **`HANDOFF_SYNC_SECRET`** still works for CI

---

### 8. Component generation from designs

Agentic pipeline from saved design artifacts to shippable components:

- **`component_generation_job`** — queued → generating → building → validating → complete/failed
- Uses extracted assets, behavior prompts, a11y settings, iteration limits
- Ties into existing component build jobs and reference materials

---

### 9. Patterns API & playground persistence

- CRUD-style pattern APIs (`/api/handoff/patterns`, clone route)
- Patterns can be saved from Playground with `user_id`, `source`, `thumbnail` metadata
- Server actions for patterns/components

---

## Platform & architecture changes

### App Router migration

Removed the old **Pages Router** tree (`src/app/pages/**`). The app now lives under **`src/app/app/`** with:

- Catch-all docs: `[...slug]`
- Layout-driven navigation via `getDataProvider().getMenu()`
- Server components + client islands for interactive tools

### End of “static vs dynamic” dual mode

- Removed `HANDOFF_MODE` / static export as the primary deployment story
- **Always** a full Next.js server (`handoff-app start`)
- Local: embedded **SQLite** at `.handoff/local.db` (zero config)
- Team: **Postgres** via `DATABASE_URL` + Drizzle migrations

### Deployment model (Vercel & hosts)

New **path contract** and materialization layouts ([DEPLOYMENT.md](./DEPLOYMENT.md)):

| Command | Role |
|---------|------|
| `handoff-app prepare-runtime` | Materialize app to `.handoff/runtime` (or configured layout) |
| `handoff-app vercel-build` | prepare + `next build` in runtime dir |
| `build:app --mode vercel` | CI-friendly ephemeral app tree (gitignored) |

Layouts: `legacy` (`.handoff/app`), `runtime`, `root`. Overlay strategy for faster rebuilds when bundle version matches.

### Data layer

- **Drizzle ORM** + `drizzle-kit` (`db:migrate`, `db:seed`, `db:bootstrap`)
- Postgres migrations squashed to single **`0000_init.sql`** baseline (18 tables)
- SQLite: bootstrap DDL on first open + minimal Drizzle migration history

### Build & module system

- Package is **`"type": "module"`**
- Build: `tsc` + `tsc-alias` + `scripts/fix-dist-esm-imports.mjs`
- **`PathContract`** centralizes working root / module root / app root
- Unit tests added: path contract, ephemeral runtime, Next config resolve, static provider, Figma linking

### Middleware & extensibility

- Default auth gate in `middleware.ts`
- **`userMiddleware`** hook from `middleware-hook.mjs` for customization without forking the app

---

## Dependency & toolchain upgrades

| Package | Before | After |
|---------|--------|-------|
| **handoff-app** | 1.2.2-6 | **2.0.0** |
| **Node** | ≥16 | **≥20.9** |
| **Next.js** | 15.3.x | **16.2.x** |
| **React** | 19.1 | 19.1 |
| **Vite** | 6.3 | **8.0** |
| **esbuild** | 0.25 | **0.28** |
| **ESLint** | 8 | **9** |
| **@vitejs/plugin-react** | 4.5 | **6.0** |

**New major dependencies:**

- `next-auth`, `@auth/drizzle-adapter`, `drizzle-orm`, `postgres`, `better-sqlite3`
- `playwright-core`, `@resvg/resvg-js`, `satori` (screenshots / OG-style rendering)
- `resend` (email), `react-zoom-pan-pinch`, `@dnd-kit/*`
- `handoff-figma-plugin` (local monorepo sibling)

---

## Documentation & API surface

- **README** rewritten: quick start, migration from 1.x, team/Postgres setup, cloud sync, AI proxy
- **[api.md](./api.md)** expanded with HTTP API reference
- **[api_spec.yaml](./api_spec.yaml)** — OpenAPI 3 for Handoff routes
- **[DEPLOYMENT.md](./DEPLOYMENT.md)**, **[COMPONENT_SYNC_CURRENT_STATE.md](./COMPONENT_SYNC_CURRENT_STATE.md)**, **[SECURITY-COMPONENT-BUILDS.md](./SECURITY-COMPONENT-BUILDS.md)**
- New doc pages: `design.md`, `playground.md`, `system/figma-sync.md`
- **`.env.example`** with full team-mode variables

---

## CLI commands added

| Command | Purpose |
|---------|---------|
| `handoff-app login` / `logout` | Device OAuth for sync |
| `handoff-app push` / `pull` | Sync to/from hosted instance |
| `handoff-app sync-status` | Remote sync cursor check |
| `handoff-app audit:figma-components` | Figma vs local component audit |
| `handoff-app prepare-runtime` | Materialize deployable Next app |
| `handoff-app vercel-build` | Vercel build pipeline |
| `build:app --mode dynamic` | Explicit dynamic materialization |

Existing commands (`fetch`, `start`, `scaffold`, `make:component`, etc.) remain; behavior evolved for DB overlay and ESM.

---

## Commit themes (chronological clusters)

1. **Playground & design prototyping** — playground builder, design page, pattern experiments
2. **Auth & security** — NextAuth, component build hardening, AI route permissions
3. **Design artifacts** — save designs, extraction, library, share URLs
4. **Deployment cleanup** — Vercel mode, legacy dual-deployment removal, path contract
5. **Figma & sync** — OAuth, component sync rework, CLI login, local-setup UX

---

## Migration notes (from `6a6cd5f` / 1.2.x)

1. **`npm install handoff-app@2`** (Node 20.9+)
2. Remove deprecated **`HANDOFF_MODE`** env vars
3. **`npm run start`** — SQLite DB auto-created
4. For team features: set **`DATABASE_URL`**, **`AUTH_SECRET`**, run **`npm run db:migrate`** + **`npm run db:seed`**
5. If you deployed static `out/`: switch to **`next build` + `next start`** or Vercel **`vercel-build`** (see [DEPLOYMENT.md](./DEPLOYMENT.md))
6. Existing **filesystem components/pages are preserved**; DB is an overlay, not a replacement

---

## What did not fundamentally change

- Core value prop: **Figma → JSON tokens → SASS/CSS → documentation site**
- Component model: `*.handoff.js` declarations, Handlebars/React previews, Vite build pipeline
- `handoff.config.js` hooks and transformer architecture (updated for ESM paths)
- Bootstrap-oriented token mapping (still the default integration story)
