# Deploying Handoff (Vercel and other hosts)

Handoff materializes a Next.js app into a directory on disk. Paths are resolved at **runtime** in `next.config.mjs` (no machine-specific absolute paths in committed config).

## Path contract

| Concept | Meaning |
|--------|---------|
| **working root** | Your design repo root (`handoff-app` cwd / `Handoff.workingPath`) |
| **module root** | The installed `handoff-app` package (`Handoff.modulePath`) |
| **app root** | Where `next dev` / `next build` run (`PathContract.appRoot`) |

Configure where the app is materialized:

- **`app.materialization_layout`** in `handoff.config` (or **`HANDOFF_APP_MATERIALIZATION_LAYOUT`** env):
  - `legacy` (default): `<working>/.handoff/app`
  - `runtime`: `<working>/handoff-runtime` (optional stable sibling **only** if you intentionally commit that tree)
  - `ephemeral`: `<working>/.handoff/runtime` (CI/Vercel — **do not commit**; regenerate each build)
  - `root`: `<working>` — use only when the repo root **is** the Next app (dedicated deploy repo)

Optional **`app.materialization_strategy`** / **`HANDOFF_APP_MATERIALIZATION_STRATEGY`**:

- `full` (default): always copy the template app from `handoff-app`.
- `overlay`: skip the full copy when `.handoff-app-bundle-version.json` matches the installed `handoff-app` version and layout (faster; delete that file to force a full refresh). Ignored when layout is `root`.

Programmatic access: `new Handoff().getPathContract()` (see `src/app-builder/path-contract.ts`).

**Gitignore (recommended for all projects using Handoff):**

```gitignore
.handoff/runtime
```

Also ignore `.handoff/app` if you use the default layout and do not want the materialized app in git. Never treat generated trees as source — extend via `handoff.config` hooks, `pages/`, `public/`, and documented overrides.

## Vercel (recommended flows)

### A. Deploy from repo root (layout `root`)

1. Set `app.materialization_layout` to `root` in `handoff.config` (or set env in Vercel).
2. Run `handoff-app build:app` in CI or locally so the Next tree and config exist at the repo root (or commit a one-time bootstrap).
3. Vercel **Root Directory**: repository root. **Output Directory**: leave empty. **Framework**: Next.js.
4. Ensure `next`, `react`, and `react-dom` are **direct** `dependencies` of the deployed project so Vercel detects the framework.

### B. Ephemeral runtime (recommended — **no** committed Next tree)

Materialize during the Vercel build step under **`.handoff/runtime`** (gitignored). The host project runs `next build` with cwd set to that directory after `handoff-app` writes a minimal `package.json` there.

1. **Install** `handoff-app` in the repo (dependency or devDependency).
2. Add **`next`**, **`react`**, and **`react-dom`** as **direct** `dependencies` of the **repository root** `package.json` (Handoff copies compatible versions into the ephemeral `package.json`, but Vercel’s framework detection and installs are simplest when Next is a root dependency).
3. **Build command** at repo root should prepare the runtime, install inside it, then build, for example:

```json
{
  "scripts": {
    "prepare:runtime": "handoff-app prepare-runtime",
    "build": "npm run prepare:runtime && cd .handoff/runtime && npm install && next build",
    "start": "cd .handoff/runtime && next start"
  }
}
```

4. Vercel **Root Directory**: repository root. **Output Directory**: empty (Next emits `.next` under `.handoff/runtime`).

**CLI equivalents:**

- `handoff-app prepare-runtime` — materialize only (same output tree as `build:app --mode vercel`; neither runs `next build`).
- `handoff-app build:app --mode vercel` — same materialization; kept for backwards compatibility.

You can set `app.materialization_layout` to `ephemeral` for local `build:app` / `start` so the dev server uses `.handoff/runtime` with symlinks to your host `node_modules` (Handoff still manages template copy and config).

### C. Legacy sibling `handoff-runtime` (optional)

If you use `materialization_layout: runtime` and **choose** to commit `<working>/handoff-runtime`, you may point Vercel’s root directory at that folder. Prefer **ephemeral** (section B) for a clean repo.

## Environment variables

| Variable | Purpose |
|----------|---------|
| `HANDOFF_APP_MATERIALIZATION_LAYOUT` | `legacy` \| `runtime` \| `ephemeral` \| `root` |
| `HANDOFF_APP_MATERIALIZATION_STRATEGY` | `full` \| `overlay` |

`HANDOFF_APP_ROOT` is set automatically in generated `next.config.mjs` for server/client code that needs the materialized app directory (see `src/app/lib/server/handoff-app-paths.ts`).
