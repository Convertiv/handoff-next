# ADR-001: Registry as Service, Not Per-Project Materialization

**Status:** Proposed
**Date:** 2026-06-06
**Deciders:** Brad Mering
**Supersedes:** prior `materialization_layout` / `prepare-runtime` architecture

---

## Context

handoff-app v2 inherited a per-project materialization model from v1. Each client project (SSC, Cynosure, Resolvet, etc.) materializes the entire Next.js app into a runtime directory (`.handoff/runtime/`), customizes it via `handoff.config.js` hooks, symlinks `node_modules` from a parent location, and deploys the resulting customized Next.js app to Vercel.

This worked when v1 produced static HTML output. v2's dynamic Postgres-backed app surfaced structural problems with this model:

- **Symlink hostility.** Vercel's serverless function packager rejects deployments containing symlinked directories. Our `.handoff/runtime/node_modules` symlink is unavoidable in the current model — installing dependencies fresh creates duplicate `next`/`react` installs that break TypeScript. Next.js itself adds its own external-package symlinks in `.next/node_modules/` for `serverExternalPackages`. We spent significant effort attempting to work around this with `outputFileTracingRoot`, standalone output, and dereferenced copies — none cleanly resolved it.

- **Architectural mismatch.** The Next.js app is *infrastructure* (auth, MCP, push/pull APIs, component preview iframes, design library, admin UI). Per-project content (components, pages, tokens, theme, navigation) is *data*. Treating data like infrastructure forces every client to redeploy infrastructure to ship content.

- **Deployment complexity.** New clients onboard via "configure Vercel root directory, install command, build command, output directory, env vars, Postgres, deploy, hope packaging works." Iterating on a client's design system requires Vercel rebuild every time.

- **Custom code as friction.** The only legitimate reason to per-project materialize is to inject custom Next.js routes. In practice this has been rare; the dominant use cases (theme CSS, custom pages, navigation) are all data-shaped.

---

## Decision

**handoff-app is a service, deployed once. Per-project content reaches the service via API.**

Concretely:

1. **One deployment of handoff-app per registry.** The Next.js code is generic. It is `npm install && next build`'d from the handoff-app repo root with no customization. Deploys to Vercel as a normal Next.js app.

2. **All per-project content is pushed via API.** Components, pages, tokens, theme CSS, navigation config, project metadata — everything that today is "baked into the build" — becomes data the registry serves from Postgres.

3. **Workspace remains a local-first dev environment.** A git repo with `components/`, `pages/`, `theme.css`, `handoff.config.js`, and a workspace-mode Next.js app for working on components locally. The workspace never deploys; it pushes to a registry.

4. **Single-tenant initially.** One registry deployment serves one project. Multi-tenancy (project_id scoping) is a future addition when client count justifies it.

5. **Custom Next.js routes deferred.** MDX + a component embed syntax covers documentation, guidelines, and examples. True custom routes are out of scope for v1 of this architecture — revisited if/when a client needs them, likely via a plugin/extension model rather than restoring materialization.

---

## Architecture

```
┌─────────────────────────────────┐         ┌──────────────────────────────────┐
│       Workspace (laptop)        │         │      Registry (Vercel)           │
│                                 │         │                                  │
│  git repo with:                 │         │  handoff-app deployed as-is:     │
│    components/                  │  push   │    npm install && next build     │
│    pages/                       │ ──────► │    standard Next.js → Postgres   │
│    theme.css                    │         │                                  │
│    handoff.config.js            │  pull   │  Serves:                         │
│    tokens/                      │ ◄────── │    /api/sync/*                   │
│                                 │         │    /api/registry/theme           │
│  handoff-app start              │   MCP   │    /api/mcp                      │
│    (workspace mode, filesystem) │ ──────► │    /system, /foundations, etc.   │
│                                 │         │                                  │
└─────────────────────────────────┘         └──────────────────────────────────┘
```

### What gets pushed (API surface)

| Content | Endpoint | Storage |
|---------|----------|---------|
| Component declarations + built artifacts | `POST /api/sync/upload` (entityType: component) | `handoff_component`, `component_artifact`, `handoff_component_source` |
| Markdown pages | `POST /api/sync/upload` (entityType: page) | `handoff_page` |
| Design tokens (Figma snapshot) | `POST /api/registry/tokens` *(new)* | `handoff_tokens_snapshot` |
| Theme CSS | `POST /api/registry/theme` *(new)* | new `handoff_registry_theme` row |
| Navigation tree | `POST /api/registry/navigation` *(new)* | new `handoff_registry_navigation` row |
| Project metadata (title, client, breakpoints, color/component sorts) | `POST /api/registry/config` *(new)* | new `handoff_registry_config` row (singleton) |

### What the registry serves

The Next.js code reads everything from Postgres at request time. No build-time customization. Theme CSS is served via `<link rel="stylesheet" href="/api/registry/theme.css">` and cached. Navigation comes from the data provider. Project title/branding comes from a config endpoint loaded into `ClientConfig`.

### Workspace mode unchanged

For local development:
- `handoff-app start` boots a workspace-mode Next.js (no DB)
- Reads everything from filesystem (`components/`, `pages/`, `tokens/`, `theme.css`, `handoff.config.js`)
- MCP works locally
- No push/pull needed for local-only work

When you want to share work or run designers/stakeholders against it, push to the registry.

---

## Consequences

### Positive

- **Deployment becomes trivial.** Clone handoff-app, connect Vercel, hit deploy. No materialization, no symlinks, no client-specific config.
- **Massive code simplification.** Removing `prepare-runtime`, `vercel-build`, materialization strategies, `.handoff/runtime/`, the symlink dance, `outputFileTracingRoot` plumbing, `next.config.mjs` placeholder substitution — easily 30–40% of handoff-app's complexity goes away.
- **Iteration speed.** Updating SSC's component library doesn't require a Vercel rebuild — `handoff-app push` and the registry serves the new content immediately.
- **One MCP per registry.** Designers, devs, AI clients all hit one stable URL. No "the MCP is wherever the latest deploy is."
- **Clear separation.** Workspace = source, Registry = display/distribution. Each does one thing well.
- **Multi-tenant is a feature flip later.** Add an `org_id` column and we can serve multiple clients from one deployment.

### Negative / Trade-offs

- **Loss of arbitrary Next.js page customization** in the short term. Markdown + component embeds covers most cases, but if a client needed a fully custom interactive page today, this architecture says "not yet." Acceptable given how rare this has been.
- **CSS theming via API is constrained.** No SCSS hooks, no compile-time Tailwind config per project. Theme becomes "upload your compiled CSS." For SSC this is fine (they already have a built theme). For projects that want dynamic SCSS variables, we'd need to either ship a Tailwind config endpoint or compile theme CSS in the workspace before pushing.
- **Larger initial DB write on first push.** Pushing all of SSC's content (83 components, 60 pages, tokens, theme, nav) is more API traffic on initial onboarding. Mitigated by the batching work already on the roadmap (#28).
- **All-or-nothing dependency on the registry being up.** With per-project deployments, each client owns their availability. With a shared registry, registry downtime affects all consumers. Acceptable for v1 (each client deploys their own registry anyway), worth thinking about for multi-tenant v2.

### Risks

- **Custom routes pressure.** A client with strong Next.js page needs may push back. Mitigation: be clear in onboarding that the registry is for designed content (markdown + components); custom apps deploy separately and link in.
- **Theme expressiveness.** Static CSS per project may not cover use cases that today rely on `handoff.config.js` Vite hooks (e.g. computed Tailwind theme tokens). Mitigation: offer a build-step in the workspace that produces deployable CSS, then push.
- **Migration of existing client deployments.** SSC, Cynosure, etc. that have Vercel projects today need to migrate. Mitigation: existing flow keeps working (we don't delete materialization code immediately, just stop adding to it). New clients use the new model.

---

## Alternatives Considered

**A) Continue fighting symlinks on Vercel.** Tried `outputFileTracingRoot`, `output: 'standalone'`, copying `node_modules` with `dereference: true`. Each surfaced new failure modes. The materialization model is fundamentally hostile to Vercel's serverless packager and we'd be playing whack-a-mole indefinitely.

**B) Materialization at repo root (`materialization_layout: 'root'`).** Avoids the symlink because the app lives where `node_modules` lives. But forces the client repo to look like a Next.js app at its root, which is messy when the design system is one piece of a larger codebase. Doesn't address the deeper "infrastructure as data" problem.

**C) Install deps fresh inside `.handoff/runtime/`.** Eliminates the symlink at the cost of duplicate `next`/`react` installs. Causes TypeScript / Next.js version conflicts. Cleanest if forced to keep materialization, but it keeps materialization — which is the actual root problem.

**D) This ADR — registry as service.** Eliminates materialization entirely. Most code to delete, simplest deployment, clearest mental model, future-proof for multi-tenancy.

---

## Confirmed Design Decisions

1. **Multi-tenancy is deferred.** Each client gets a Vercel deploy of handoff-app. Simple to ship, simple to reason about. Multi-tenant comes later when client count justifies the org/project scoping work.

2. **Theme CSS is compiled in the workspace and pushed.** The workspace runs Tailwind/SCSS locally (existing flow) and pushes the compiled CSS to the registry. The registry stores and serves the compiled output — it does not compile CSS. Keeps the registry simple and avoids shipping a SCSS/Tailwind compiler in the hosted runtime.

3. **Custom Next.js pages are deferred to a future plugin model.** v1 of this architecture covers markdown pages with component embeds. Arbitrary custom routes are out of scope. When a client needs them, we revisit with a plugin/extension design — not by restoring materialization.

4. **Shared component bundles are first-class.** Push collects both per-component artifacts AND the shared `main.js` / `main.css` / `shared.css` bundles built from the workspace's global JS/SCSS entries. The registry serves these from the `component_artifact` table under a sentinel `__shared__` componentId (already implemented in `collectSharedComponentAssets`). Component preview iframes reference both their own files and the shared bundle.

5. **Local dev experience is preserved unchanged.** Workspace mode keeps:
   - File watchers (chokidar) for components, pages, tokens, theme, handoff.config
   - WebSocket server (port 4001) that pushes reload events to the browser
   - Hot reload of component changes during development
   - MCP server for local AI assistance
   This is critical and any change to the materialization path must NOT regress workspace dev.

6. **The `.handoff.ts` declaration format is unchanged.** Workspace authors components the same way. Push extracts metadata and serializes source files for the registry.

7. **Forward compatibility for richer page types is explicitly preserved.** Custom routes are deferred, but the schema, API, and rendering pipeline are designed so the following progression is purely additive:

   - **Stage 1 (now):** markdown pages only
   - **Stage 2:** MDX with embedded components from a fixed catalog (covers ~80% of "custom page" cases — docs with live examples, guidelines with patterns)
   - **Stage 3:** Workspace-rendered HTML pages — workspace renders to HTML locally, pushes HTML + asset bundle, registry serves verbatim (no code execution on registry side)
   - **Stage 4:** Plugin bundles — workspace pushes compiled React components, registry loads via React.lazy + slot system
   - **Stage 5:** Fork escape hatch — clients with extreme customization needs fork handoff-app and merge upstream

   To keep these stages open without paying for them now:
   - `handoff_page` gets a `type` column day one (`markdown` | `mdx` | `html` | `plugin` later)
   - Page rendering is a `<PageRenderer type={page.type} />` dispatch, not a single render path
   - Schema supports per-page asset bundles via a `page_artifact` table pattern (same shape as `component_artifact`)
   - Navigation tree carries a `type` field on each node so future page types appear naturally
   - Push API uses open-ended `entityType` strings — adding `'plugin'` or `'asset-bundle'` later is purely additive

8. **Deploy model: clients point Vercel at `convertiv/handoff-app`, not at their own repo.** Each client gets a Vercel project configured against the handoff-app repo on a pinned branch (e.g. `release`) or tag. Their workspace repo stays pure content — no Next.js, no package.json wrestling, no monorepo gymnastics. Updates ship by merging to `release`; clients can pin to a tag if they need stability during a launch.

---

## Implementation Plan

See task list `#33` onwards. Six sequenced phases:

**Phase 1 — Registry deploy path**
Stand up handoff-app on Vercel as itself. No materialization. Verify auth, setup, MCP, sync push/pull work against a real hosted Postgres. Document the deploy steps. This is the foundational change; nothing downstream is feasible without it.

**Phase 2 — Per-project content APIs**
Build `/api/registry/theme`, `/api/registry/tokens`, `/api/registry/navigation`, `/api/registry/config`. Tables + push endpoints. Workspace CLI commands to push them, plus a unified `handoff-app push:all`. The four endpoints are independent and can be built in parallel.

**Phase 3 — Registry reads from DB everywhere**
Wire the hosted registry to serve theme CSS from DB, navigation from DB, config from DB, tokens from DB. Today some of this is read from filesystem in `DynamicDataProvider`; complete the move so registry mode is fully DB-backed.

**Phase 4 — Workspace dev experience verification**
After materialization changes, explicitly verify workspace mode still works end-to-end: file watchers fire, WebSocket reload works, component edits hot-reload in the browser, MCP responds, theme.css changes propagate. This is a check phase, not a build phase, but it gates merging.

**Phase 5 — SSC end-to-end migration**
Use SSC as the proof-of-concept. Push all its content (components + pages + tokens + theme + nav + config + shared bundles) to the deployed registry. Verify the site renders correctly with SSC branding. Verify MCP serves SSC stack guide. Verify push/pull cycle.

**Phase 6 — Documentation + deprecation**
Update `REGISTRY-SETUP.md` for the new flow. Mark `prepare-runtime` / `vercel-build` / `materialization_layout` / `materialization_strategy` as deprecated with CLI warnings pointing at this ADR. Don't delete the code yet — existing clients on the old flow need a migration window.

**Phase 7 (later, when needed) — Multi-tenancy**
Add `org_id` to relevant tables. Org switcher in admin UI. Scoped push/pull tokens.
