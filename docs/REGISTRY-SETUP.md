# Handoff Registry Setup

A **registry** is a hosted Handoff instance backed by Postgres. It stores built component artifacts, metadata, and sync events so teams can push from a local workspace and pull into other workspaces or consume via the MCP.

A **workspace** is a local clone of your design-system repo. It runs filesystem-only — no database required.

---

## Quick concepts

```
Workspace (your laptop)          Registry (Vercel / Docker)
────────────────────────         ───────────────────────────
handoff-app start                handoff-app start + DATABASE_URL
filesystem: components/[id]/     Postgres: handoff_component, component_artifact
HANDOFF_CLOUD_URL → push/pull    HANDOFF_SYNC_SECRET → auth
```

---

## Option A: Local registry with Docker (dev/test)

### 1. Start Postgres

```bash
docker run -d \
  --name handoff-registry \
  -e POSTGRES_DB=handoff_registry \
  -e POSTGRES_USER=handoff \
  -e POSTGRES_PASSWORD=changeme \
  -p 5433:5432 \
  postgres:16-alpine

# Wait for it to be ready
until docker exec handoff-registry pg_isready -U handoff; do sleep 1; done
```

### 2. Create a registry project directory

```bash
mkdir -p ~/handoff-local-registry
cd ~/handoff-local-registry

# Write the config
cat > handoff.config.js << 'EOF'
module.exports = {
  figma_project_id: "registry",
  app: {
    title: "Local Registry",
    client: "Dev",
    ports: { app: 4002, websocket: 4003 },
  },
  entries: { components: [] },
};
EOF

# Write the environment
cat > .env << 'EOF'
DATABASE_URL=postgresql://handoff:changeme@localhost:5433/handoff_registry
HANDOFF_SYNC_SECRET=dev-registry-secret
AUTH_SECRET=dev-auth-secret-not-for-production
EOF
```

### 3. Start the registry

```bash
cd ~/handoff-local-registry
handoff-app start
# → http://localhost:4002
# Migrations run automatically on first boot.
# Visit http://localhost:4002/setup to create your admin account.
```

### 4. Configure your workspace

In your design-system project's `.env` (e.g. `ssc-handoff-next/handoff/.env`):

```env
# No DATABASE_URL — stays in workspace (filesystem) mode
HANDOFF_CLOUD_URL=http://localhost:4002
HANDOFF_CLOUD_TOKEN=dev-registry-secret
```

### 5. Push / pull

```bash
# From your workspace directory:
handoff-app push --components button blog hero_split   # push a few components
handoff-app push                                       # push everything (batched internally)
handoff-app pull                                       # pull from registry → local dist/
handoff-app sync-status                                # check cursor + registry health
```

### Stopping and restarting

```bash
docker stop handoff-registry    # stop Postgres (data persists)
docker start handoff-registry   # resume
# Then restart the registry server: cd ~/handoff-local-registry && handoff-app start
```

---

## Option B: Deploy to Vercel

### 1. Generate Vercel config

In your workspace (design-system repo):

```bash
cd path/to/your/handoff-directory   # e.g. ssc-handoff-next/handoff
handoff-app init:vercel
```

This writes:
- `vercel.json` — build/output settings
- `.env.vercel.example` — env var template

Commit `vercel.json`. Do **not** commit `.env`.

### 2. Import to Vercel

1. Push to GitHub/GitLab/Bitbucket.
2. In Vercel: **Add New → Project → Import**.
3. Set **Root Directory** to the folder containing `vercel.json`
   (e.g. `handoff` if your design system lives in a `handoff/` subfolder).
4. Vercel reads `vercel.json` — build/output are pre-configured.

### 3. Add Vercel Postgres

In the Vercel dashboard for your project:  
**Storage → Connect Store → Create New → Postgres**

Vercel automatically adds `DATABASE_URL` and `POSTGRES_*` to your project's environment.

### 4. Add environment variables

In **Project → Settings → Environment Variables**:

| Variable | Value |
|----------|-------|
| `AUTH_SECRET` | `openssl rand -hex 32` |
| `HANDOFF_SYNC_SECRET` | any strong random string |

Optional:
| Variable | Value |
|----------|-------|
| `HANDOFF_DEFAULT_STACK_PROFILE` | `bootstrap-handlebars` \| `react-tailwind` \| etc. |
| `HANDOFF_PROJECT_NAME` | display name for the registry |

### 5. Deploy

Click **Deploy**. The first deploy:
1. Runs `handoff-app vercel-build` → materializes + `next build`
2. On first request: auto-applies any pending migrations
3. Redirects to `/setup` — create your admin account

### 6. Connect your workspace

In your workspace `.env`:

```env
HANDOFF_CLOUD_URL=https://your-registry.vercel.app
HANDOFF_CLOUD_TOKEN=<same value as HANDOFF_SYNC_SECRET>
```

---

## Environment variable reference

| Variable | Where | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | Registry only | Postgres connection string. Absence = workspace mode. |
| `AUTH_SECRET` | Registry only | NextAuth session signing key. Required when DATABASE_URL is set. |
| `HANDOFF_SYNC_SECRET` | Registry + Workspace | Bearer token for CLI push/pull and MCP. Must match on both sides. |
| `HANDOFF_CLOUD_URL` | Workspace only | URL of the registry to push/pull against. |
| `HANDOFF_CLOUD_TOKEN` | Workspace only | Token sent as `Authorization: Bearer` — matches registry HANDOFF_SYNC_SECRET. |
| `HANDOFF_DEFAULT_STACK_PROFILE` | Registry | Default stack guide profile (`bootstrap-handlebars`, `react-tailwind`, etc.). |
| `HANDOFF_STACK_GUIDE_PATH` | Registry | Path to a custom stack guide markdown file (relative to working path). |

---

## Push / pull reference

```bash
# Push all components (auto-builds any without dist/)
handoff-app push

# Push specific components (useful during development)
handoff-app push --components button hero_split stats

# Push only metadata (no artifact rebuild)
handoff-app push --metadata-only

# Pull all changes from registry since last sync
handoff-app pull

# Preview what would be pulled without writing files
handoff-app pull --dry-run

# Check registry health and sync cursor
handoff-app sync-status
```

---

## MCP connection

With the workspace running on port 4000, add a `.claude/settings.json` to your project:

```json
{
  "mcpServers": {
    "handoff": {
      "type": "http",
      "url": "http://localhost:4000/api/mcp"
    }
  }
}
```

No auth token needed — workspace mode allows unauthenticated local access.  
For a hosted registry, add `"headers": { "Authorization": "Bearer <HANDOFF_SYNC_SECRET>" }`.

Run `handoff-app init:vercel` to also add a `docs/stack-guide.md` prompt for the MCP's `handoff_get_stack_guide` tool.

---

## Known limitations

- **Push body size**: pushing >~10 components at once may hit Next.js's default body limit. Use `--components` to batch until auto-batching is shipped.
- **Source storage**: source files (`template.hbs`, SCSS, etc.) are only stored in the registry for projects using the v2 component layout (`components/[id]/`). Legacy layout projects (`integration/components/`) push artifacts only.
