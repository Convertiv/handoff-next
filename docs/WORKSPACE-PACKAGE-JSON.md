# Workspace `package.json` Reference

After ADR-001 (registry as service), the workspace repo no longer needs to be a
Next.js project. The deployed registry is `convertiv/handoff-app` on Vercel —
it brings its own `next`, `react`, `react-dom`. Workspace repos only need
`handoff-app` itself and any runtime dependencies referenced by their
component templates, scripts, or styles.

## Recommended minimum workspace package.json

```jsonc
{
  "name": "my-design-system",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "handoff-app start",
    "fetch": "handoff-app fetch",
    "build": "handoff-app build:components",
    "push": "handoff-app push:all",
    "validate": "handoff-app validate:components"
  },
  "dependencies": {
    "handoff-app": "git+https://github.com/Convertiv/handoff-next.git#release"

    // Any component-runtime deps your templates reference at runtime.
    // Examples — keep only what you actually import in component scripts/SCSS:
    // "bootstrap": "^5.3.8",
    // "@fortawesome/fontawesome-svg-core": "^6.6.0",
    // "highcharts": "^12.4.0",
    // "jquery": "^3.7.1"
  },
  "devDependencies": {
    // Workspace tooling — formatting, validation, scaffolding
    "prettier": "^3.5.0",
    "typescript": "^5.7.2"

    // Optional helpers for custom scripts you author
    // "yargs": "^17.7.2"
  }
}
```

## What you can REMOVE from a legacy workspace

These were required when the workspace deployed itself as a Next.js app. Under
ADR-001 they're no longer needed — handoff-app's own install brings them:

| Dep | Why it was needed | Status |
|-----|-------------------|--------|
| `next` | Workspace was a Next.js project | Remove — handoff-app bundles next |
| `react` | Next.js peer dep | Remove |
| `react-dom` | Next.js peer dep | Remove |
| `@sparticuz/chromium` | Vercel serverless screenshots | Remove — workspace now uses local `playwright-core` (bundled with handoff-app) |
| `eslint-config-next` | If present | Remove |
| `@types/react`, `@types/react-dom` | Types for the deploy | Remove unless you write TSX in workspace utility scripts |

## What you should KEEP

| Category | Examples | Why |
|----------|----------|-----|
| `handoff-app` | itself | CLI tool — required |
| Component runtime libraries | `bootstrap`, `highcharts`, `@fancyapps/fancybox`, `jquery`, etc. | Referenced in component templates / SCSS / scripts — must be installable into the workspace `node_modules` so component builds can resolve them |
| Workspace tooling | `prettier`, `typescript`, formatters, linters | Authoring tools |
| Validation deps | `axe-core`, `puppeteer` | If you author custom validators in `hooks.validateComponent` |
| Custom-script deps | `axios`, `csv`, `yargs`, `prompts` | If you write custom scripts (data import, exporters) |

## Migration checklist

To migrate an existing workspace repo to the lean shape:

1. Confirm the registry is deployed and your workspace can push:
   ```bash
   handoff-app sync-status
   # → expect counts > 0 if you've pushed already
   ```
2. Remove the deploy-only deps:
   ```bash
   npm uninstall next react react-dom @sparticuz/chromium \
                 eslint-config-next @types/react @types/react-dom
   ```
3. Delete the workspace's `vercel.json` (the workspace no longer deploys —
   only the registry does).
4. Remove any `build:vercel` / `start:vercel` scripts from `package.json` —
   those targets are obsolete.
5. Boot in workspace mode to confirm nothing broke:
   ```bash
   npm run start
   # http://localhost:4000 should load with the full app
   ```
6. Try a push:
   ```bash
   handoff-app push:all
   ```

If anything breaks, restore from `package.json.backup` (run `cp package.json
package.json.backup` before step 2 to be safe).

## Why this works

`handoff-app start` materializes the Next.js app to `.handoff/app/`. That app
needs `next`, `react`, etc. at runtime. Before ADR-001 those came from the
workspace's own `node_modules` via a symlink. Now `resolveHostNodeModulesDir()`
walks up looking for `node_modules/next` — first it checks the workspace's
node_modules, then ascends; if the workspace has no `next` installed, it finds
`handoff-app/node_modules/next` (handoff-app ships them as direct deps) and
uses that instead.

The workspace becomes purely content + tooling. No deploy-time dependencies.

## Reference: what's in handoff-app's own dependencies

handoff-app brings these as direct deps so workspaces don't have to:

- `next` (^16.x)
- `react`, `react-dom` (^19.x)
- `playwright-core` (for screenshots, validation)
- `drizzle-orm`, `postgres` (for registry mode)
- `next-auth`, `@auth/drizzle-adapter` (for registry auth)
- `@modelcontextprotocol/sdk` (for the MCP server)
- All Radix UI components (registry UI)
- Tailwind / sass / esbuild / vite (build pipeline)

Workspaces don't import any of these directly; they're consumed via
`handoff-app start` / build / push commands.
