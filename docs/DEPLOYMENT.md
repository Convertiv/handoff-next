# Deploying Handoff (Vercel and other hosts)

Handoff materializes a Next.js app from its templates and your design tokens. The generated app is **not source code** — extend it via `handoff.config` hooks, `pages/`, `public/`, and documented overrides.

## CLI commands (quick reference)

| Command | What it does |
|---------|-------------|
| `handoff-app start` | Materializes the app, starts the dev server, and watches for changes. **Use for local development.** |
| `handoff-app dev` | Bare `next dev` inside an already-materialized app directory. |
| `handoff-app build:app` | Materializes the app and runs `next build` (static export). |
| `handoff-app build:app --mode vercel` | Materializes to `.handoff/runtime` for CI/Vercel (does **not** run `next build`). |
| `handoff-app prepare-runtime` | Alias for `build:app --mode vercel`. |

## Path contract

| Concept | Meaning |
|--------|---------|
| **working root** | Your design repo root (`handoff-app` cwd / `Handoff.workingPath`) |
| **module root** | The installed `handoff-app` package (`Handoff.modulePath`) |
| **app root** | Where `next dev` / `next build` run (`PathContract.appRoot`) |

Configure where the app is materialized via **`app.materialization_layout`** in `handoff.config` (or **`HANDOFF_APP_MATERIALIZATION_LAYOUT`** env):

- `legacy` (default): `<working>/.handoff/app`
- `runtime`: `<working>/handoff-runtime` (stable sibling for host deploys)
- `root`: `<working>` — use only when the repo root **is** the Next app (dedicated deploy repo)

Optional **`app.materialization_strategy`** / **`HANDOFF_APP_MATERIALIZATION_STRATEGY`**:

- `full` (default): always copy the template app from `handoff-app`.
- `overlay`: skip the full copy when `.handoff-app-bundle-version.json` matches the installed `handoff-app` version and layout (faster; delete that file to force a full refresh). Ignored when layout is `root`.

Programmatic access: `new Handoff().getPathContract()` (see `src/app-builder/path-contract.ts`).

**Gitignore (recommended for all projects):**

```gitignore
.handoff/
```

Never treat generated trees as source — extend via `handoff.config` hooks, `pages/`, `public/`, and documented overrides.

## Vercel deployment

### Option A: Ephemeral runtime (recommended — nothing committed)

Materialize at build time into `.handoff/runtime` (gitignored). The `prepare-runtime` command writes the Next.js app there; the Vercel build step then runs `next build` from that directory.

1. Install `handoff-app` as a dependency.
2. Add `next`, `react`, and `react-dom` as **direct** `dependencies` in your root `package.json`.
3. Add build scripts:

```json
{
  "scripts": {
    "start": "handoff-app start",
    "dev": "handoff-app dev",
    "build:vercel": "handoff-app prepare-runtime && cd .handoff/runtime && npm install && next build"
  }
}
```

4. Vercel settings:
   - **Root Directory**: repository root
   - **Build Command**: `npm run build:vercel`
   - **Output Directory**: `.handoff/runtime/.next`
   - **Framework**: Next.js

### Option B: Deploy from repo root (layout `root`)

1. Set `app.materialization_layout` to `root` in `handoff.config` (or set the env var in Vercel).
2. Run `handoff-app build:app` — the Next tree materializes at the repo root.
3. Vercel **Root Directory**: repository root. **Framework**: Next.js.
4. Ensure `next`, `react`, and `react-dom` are **direct** `dependencies`.

### Option C: Committed sibling `handoff-runtime`

If you use `materialization_layout: runtime` and commit `<working>/handoff-runtime`, point Vercel's root directory at that folder. Prefer Option A for a clean repo.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `HANDOFF_APP_MATERIALIZATION_LAYOUT` | `legacy` \| `runtime` \| `root` |
| `HANDOFF_APP_MATERIALIZATION_STRATEGY` | `full` \| `overlay` |

`HANDOFF_APP_ROOT` is set automatically in the generated `next.config.mjs`.
