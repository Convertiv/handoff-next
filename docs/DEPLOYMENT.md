# Deploying Handoff (Vercel and other hosts)

Handoff materializes a Next.js app from its templates and your design tokens. The generated app is **not source code** — extend it via `handoff.config` hooks, `pages/`, `public/`, and documented overrides.

**Standalone package:** Deploy from the **`handoff-app` repository root** only (`npm ci`, then `npm run build:vercel`). Do not point Vercel at a parent folder that uses npm `workspaces` to hoist dependencies — that layout breaks local tooling and does not match production. See [STANDALONE-INSTALL.md](./STANDALONE-INSTALL.md).

Do not set Next.js `output: 'export'` on this app: NextAuth and App Route APIs require a Node (or compatible) server runtime.

## CLI commands (quick reference)

| Command | What it does |
|---------|-------------|
| `handoff-app start` | Materializes the app, starts the dev server, and watches for changes. **Use for local development.** |
| `handoff-app dev` | Bare `next dev` inside an already-materialized app directory. |
| `handoff-app build:app` | Materializes the app and runs `next build` (writes `.next` for `next start` / Node hosting, not a static `out/` export). |
| `handoff-app build:app --mode vercel` | Materializes to `.handoff/runtime` for CI/Vercel (does **not** run `next build`). |
| `handoff-app prepare-runtime` | Alias for `build:app --mode vercel`. |
| `handoff-app vercel-build` | Same pipeline as `build:app --mode vercel`, then runs `next build` in `.handoff/runtime` (recommended Vercel **Build Command**). |

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

**Repository root:** Connect Vercel to the `handoff-app` git repository and set **Root Directory** to the repo root (`.`). Do not deploy from a parent folder that uses npm `workspaces` to include `handoff-app` — that hoists dependencies outside the package and breaks local tooling vs production. See [STANDALONE-INSTALL.md](./STANDALONE-INSTALL.md).

### Option A: Ephemeral runtime (recommended — nothing committed)

Materialize at build time into `.handoff/runtime` (gitignored). The `prepare-runtime` command writes the Next.js app there and **symlinks** `.handoff/runtime/node_modules` to your repository root’s `node_modules` so there is only one copy of `next` (required for TypeScript and Vercel). Do **not** run `npm install` inside `.handoff/runtime` — that would install a second `next` and break type-checking.

1. Install `handoff-app` as a dependency.
2. Add `next`, `react`, and `react-dom` as **direct** `dependencies` in your root `package.json` (Vercel installs them at the repo root).
3. Add build scripts:

```json
{
  "scripts": {
    "start": "handoff-app start",
    "dev": "handoff-app dev",
    "build:vercel": "handoff-app vercel-build"
  }
}
```

Equivalent manual chain (same behavior as `vercel-build`): `handoff-app build:app --mode vercel && cd .handoff/runtime && next build`. Prefer `vercel-build` so the full Handoff pipeline always runs before Next.

4. Vercel settings:
   - **Root Directory**: repository root (`handoff-app` clone root, not a parent monorepo)
   - **Install Command**: `npm ci`
   - **Build Command**: `npm run build:vercel`
   - **Output Directory**: `.handoff/runtime/.next`
   - **Framework**: Next.js

**What the runtime includes:** `prepare-runtime` copies the default Handoff markdown (`system`, `foundations`, `design`, …) into `.handoff/runtime/config/docs` and mirrors `public/api` (component/pattern JSON) into `.handoff/runtime/public/api`. The running Next app reads those paths under `HANDOFF_APP_ROOT`, so navigation and disk-backed APIs work on Vercel without relying on `node_modules/handoff-app` being fully present in every serverless trace.

**Components on disk:** Run `handoff-app build:components` (or use `prepare-runtime` without `--skip-components`) before `next build` so `public/api/components.json` and per-component files exist and get synced into the runtime.

**`/admin/*` and login:** When `DATABASE_URL` is set, middleware requires a signed-in admin JWT for `/admin` routes. That is expected; use `/login` with an admin account, or use local SQLite-only mode without `DATABASE_URL` for open `/admin` during development.

**Troubleshooting — Vercel reports missing `.handoff/runtime/.next`:** That path exists only after a successful `next build` inside `.handoff/runtime`. If the build command stops after `prepare-runtime` / `build:app --mode vercel` only, add `vercel-build` (or the manual `cd .handoff/runtime && next build` step). If `next build` fails earlier in the log, fix those compile errors first; the output-directory message is usually a follow-on symptom.

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
