# Handoff Registry Setup

A **registry** is a hosted instance of handoff-app backed by Postgres. It
stores components, pages, design tokens, theme CSS, and project metadata for
one design system project. Teams use the registry to browse the system, plug
AI clients into the MCP, and pull pushed artifacts into their workspaces.

A **workspace** is a local clone of your design-system repo. It runs
filesystem-only — no database. Workspace mode is for authoring components,
pages, and theme files. When you're ready to publish, push to the registry.

See [`ADR-001-registry-as-service.md`](./ADR-001-registry-as-service.md) for
the architectural model.

---

## Topology

```
convertiv/handoff-app         (you maintain — the platform)
  └── release branch  ──── auto-deploys to all client registries

clients/your-design-system    (one per client — pure content)
  ├── components/
  ├── pages/
  ├── theme.css
  ├── handoff.config.js
  └── .env  → HANDOFF_CLOUD_URL=https://your-registry.vercel.app
```

One Vercel project per client registry, each pointing at the same handoff-app
repo on a pinned branch (or tag). Clients can pin to a specific tag if they
need stability during a launch.

---

## Option A: Local registry with Docker (dev / test)

### 1. Start Postgres

```bash
docker run -d \
  --name handoff-registry \
  -e POSTGRES_DB=handoff_registry \
  -e POSTGRES_USER=handoff \
  -e POSTGRES_PASSWORD=changeme \
  -p 5433:5432 \
  postgres:16-alpine

until docker exec handoff-registry pg_isready -U handoff; do sleep 1; done
```

### 2. Start the registry from convertiv/handoff-app

```bash
cd /path/to/handoff-app
DATABASE_URL=postgresql://handoff:changeme@localhost:5433/handoff_registry \
HANDOFF_REGISTRY_MODE=true \
AUTH_SECRET=$(openssl rand -hex 32) \
HANDOFF_SYNC_SECRET=dev-registry-secret \
  npm run build:registry && \
  cd src/app && npx next start -p 4002

# Or for hot-reload development:
# npm run dev  (from handoff-app root)
```

The registry runs at `http://localhost:4002`. Visit `/setup` to create your
admin account. Migrations run automatically on first request via
`instrumentation.ts`.

### 3. Configure the workspace

In your design-system repo (the workspace):

```bash
cd my-design-system

# Authenticate via device OAuth — opens browser, signs in, saves to .handoff/cli-auth.json
handoff-app login --url http://localhost:4002

# Or set env vars directly for shared-secret auth
echo 'HANDOFF_CLOUD_URL=http://localhost:4002' >> .env
echo 'HANDOFF_CLOUD_TOKEN=dev-registry-secret' >> .env

# Verify the connection
handoff-app sync-status
```

### 4. Push your content

```bash
handoff-app push:all
# Pushes config + components + pages + theme + navigation + tokens
```

Visit `http://localhost:4002/` to see your design system.

---

## Option B: Deploy to Vercel (production)

### 1. Create the Vercel project

In the Vercel dashboard:

- **Add New → Project → Import Git Repository**
- Repository: `convertiv/handoff-next` (the handoff-app repo)
- Project Name: e.g. `my-design-system-registry`
- Branch: `release` (or a pinned tag like `v2.4.0`)

Vercel auto-detects `vercel.json` at the repo root and pre-configures:
- Install: `npm install`
- Build: `npm run build:registry`
- Output: `src/app/.next`
- Framework: Next.js

Leave **Root Directory** blank (repo root).

**Do NOT click Deploy yet — env vars first.**

### 2. Add Postgres

In the new project: **Storage → Connect Store → Create New → Postgres**

Vercel auto-injects `DATABASE_URL` and `POSTGRES_*` env vars. You can also
attach an existing Postgres instance from another project (Storage → Connect
Store → Existing).

### 3. Add the remaining env vars

Project → **Settings → Environment Variables** (all environments):

| Variable | Value |
|----------|-------|
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `HANDOFF_SYNC_SECRET` | `openssl rand -hex 32` |
| `HANDOFF_REGISTRY_MODE` | `true` |
| `AUTH_URL` | the production URL Vercel assigns to your project (e.g. `https://my-design-system-registry.vercel.app`) |

Optional:
| Variable | Value |
|----------|-------|
| `HANDOFF_DEFAULT_STACK_PROFILE` | `bootstrap-handlebars` \| `react-tailwind` \| `tailwind-handlebars` \| `react-scss` |
| `HANDOFF_PROJECT_NAME` | Display name for the registry |

### 4. Deploy

Click **Deploy**. The build:
1. Runs `handoff-app vercel-build --skip-components` (registry mode auto-skips component builds)
2. Outputs to `src/app/.next/`
3. On first request, `instrumentation.ts` applies database migrations
4. Layout redirects to `/setup` because no users exist yet

### 5. First-admin setup

Visit your deployment URL — you'll be redirected to `/setup`. Create your admin
account (email + password). On submit you're redirected to `/login?setup=1`.
Sign in.

### 6. Configure your workspace

```bash
cd my-design-system

# Device OAuth login — saves a scoped JWT to .handoff/cli-auth.json
handoff-app login --url https://my-design-system-registry.vercel.app

# Or env-var auth (use HANDOFF_SYNC_SECRET as the token)
echo 'HANDOFF_CLOUD_URL=https://my-design-system-registry.vercel.app' >> .env
echo 'HANDOFF_CLOUD_TOKEN=<paste HANDOFF_SYNC_SECRET value>' >> .env

handoff-app sync-status   # confirm: latestVersion 0, counts all zero
```

### 7. Push content

```bash
handoff-app push:all
```

Visit your registry — components, pages, foundations, and branding should all
reflect the workspace content.

---

## Env var reference

### Registry-side (on Vercel / Docker host)

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | Postgres connection string. Auto-set by Vercel Postgres. |
| `AUTH_SECRET` | yes | NextAuth session signing key. Generate with `openssl rand -hex 32`. |
| `HANDOFF_SYNC_SECRET` | yes | Bearer token for CLI push/pull and MCP. Generate with `openssl rand -hex 32`. |
| `AUTH_URL` | yes (Vercel) | Public production URL — needed by NextAuth for callback redirects. |
| `HANDOFF_REGISTRY_MODE` | recommended | Set to `true` so `vercel-build` skips the component build phase. |
| `HANDOFF_DEFAULT_STACK_PROFILE` | optional | Default MCP stack guide profile. |
| `HANDOFF_PROJECT_NAME` | optional | Display name when no project config has been pushed yet. |

### Workspace-side (in the design-system repo)

| Variable | Required | Purpose |
|----------|----------|---------|
| `HANDOFF_CLOUD_URL` | yes (for push/pull) | URL of the registry you push to. |
| `HANDOFF_CLOUD_TOKEN` | yes (if not using `login`) | Bearer token — must equal the registry's `HANDOFF_SYNC_SECRET`. |
| `DATABASE_URL` | **NEVER** | Workspaces are filesystem-only. Setting this would enable registry mode locally — usually not what you want. |

After `handoff-app login`, the JWT in `.handoff/cli-auth.json` takes precedence
over `HANDOFF_CLOUD_TOKEN` — you can omit the token env var if logged in.

---

## CLI quick reference

```bash
# Workspace dev
handoff-app start              # local dev server on :4000, watches files
handoff-app build:components   # rebuild all components (artifacts to dist/)
handoff-app fetch              # pull design tokens from Figma

# Auth
handoff-app login --url https://your-registry.vercel.app
handoff-app logout             # clears .handoff/cli-auth.json

# Push / pull
handoff-app push:all           # push everything (config, components, pages, theme, nav, tokens)
handoff-app push --components button blog   # selective component push
handoff-app pull               # fetch changes from registry → local files
handoff-app sync-status        # show cursor + registry health

# Diagnostics
handoff-app sync-status        # check registry connection + cursor
```

---

## Updating the registry

To roll out a handoff-app fix to all clients:

```bash
# In handoff-app
git push origin release        # → all client registries auto-deploy
```

To pin a client to a specific version:

In Vercel: Project → Settings → Git → change the Production branch / tag.

To migrate workspaces to a newer handoff-app CLI:

```bash
# In each workspace
npm update handoff-app
```

---

## MCP from external clients

Your registry exposes an MCP server at `/api/mcp/`. To connect Claude Code or
any MCP-compatible client to it:

```jsonc
// .claude/settings.json in your workspace
{
  "mcpServers": {
    "handoff-registry": {
      "type": "http",
      "url": "https://your-registry.vercel.app/api/mcp/",
      "headers": {
        "Authorization": "Bearer <HANDOFF_SYNC_SECRET or a CLI JWT>"
      }
    }
  }
}
```

The MCP exposes 20+ tools — project context, stack guide, component search,
design tokens, design library, sync push/pull, and AI generation. See
[`HANDOFF-MCP-RFC.md`](./HANDOFF-MCP-RFC.md) for the full tool list.

---

## What changed from the old deploy model

If you came from handoff-app v1 or early v2 with `prepare-runtime` /
`vercel-build` materialization on the client project:

- **You no longer deploy the client project.** The registry is deployed
  separately as `convertiv/handoff-app`. Your client repo is workspace-only.
- **No more `.handoff/runtime/` symlink dance.** Vercel deploys handoff-app's
  `src/app/` directly, no per-project customization.
- **Theme.css is pushed, not compiled in the deploy.** Compile in workspace,
  `push:all` ships the bytes.
- **Project metadata is pushed, not baked in.** `handoff.config.js` `app`
  block becomes a database row via `push:all`.

The old materialization commands (`prepare-runtime`, `vercel-build` on a
client project, `materialization_layout` config) still work for legacy
deployments but are deprecated. See task #43 / `ADR-001` for the deprecation
timeline.

See [`WORKSPACE-PACKAGE-JSON.md`](./WORKSPACE-PACKAGE-JSON.md) for guidance on
trimming legacy deps (`next`, `react`, etc.) out of a workspace repo.

---

## Troubleshooting

### Build fails on Vercel with "files in symlinked directories"

This was a pre-ADR-001 issue. If you see it now, you're probably deploying the
wrong repo. Confirm Vercel is pointed at `convertiv/handoff-app`, not at your
client project repo.

### `/setup` form crashes with "relation 'user' does not exist"

Migrations failed. Check function logs for `[handoff] auto-migrate:` lines.
If you see `migration failed:`, the actual SQL error follows.

Manual recovery — POST `/api/admin/migrate` with bearer auth:

```bash
curl -X POST https://your-registry.vercel.app/api/admin/migrate \
  -H "Authorization: Bearer $HANDOFF_SYNC_SECRET"
```

If migrations are corrupt mid-state, in your Postgres console:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
```

Then redeploy or hit `/api/admin/migrate` again.

### `handoff-app push` returns 413 "Request Entity Too Large"

The batching logic in push automatically splits large payloads. If you still
hit this, an individual component's artifacts may exceed the per-request
budget. Try `--metadata-only` to push the declaration without artifacts, then
follow up with smaller selective pushes.

### Registry shows the wrong project title / no theme

You haven't run `push:all` yet (or the registry config push step failed).
Re-run with `--skip-components` to push only the metadata pieces:

```bash
handoff-app push:all --skip-components --skip-pages
```
