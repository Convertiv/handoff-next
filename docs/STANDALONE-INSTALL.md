# Standalone install (handoff-app only)

`handoff-app` is a **single npm package** with its own `package-lock.json`. Deploy it from this repository root (Vercel, Docker, client hosts). Do not treat it as part of a parent npm workspace.

## Install

```bash
git clone <handoff-app-repo>
cd handoff-app
npm ci
```

Use `npm ci` (not `npm install` from a parent folder) so `node_modules` matches the lockfile and matches production.

## Do not use a parent npm workspace

If this folder lives under a directory like `Handoff/handoff-app/` **do not** keep a parent `package.json` with:

```json
"workspaces": ["handoff-app", "handoff-figma-plugin"]
```

That hoists tools (e.g. `drizzle-kit`, `next`) into `Handoff/node_modules/` while `drizzle-orm` stays in `handoff-app/node_modules/`, which breaks `drizzle-kit` and confuses local dev vs Vercel.

`npm run preinstall` / `npm run doctor` will fail with instructions if a parent workspace is detected.

## Database

```bash
# .env must include DATABASE_URL
npm run db:migrate
npm run db:seed          # optional
npm run db:bootstrap     # optional admin user
```

`db:migrate` uses the Drizzle ORM migrator (`scripts/db-migrate.ts`), not `drizzle-kit migrate`, so it works with Neon pooler URLs and always exits cleanly.

If tables already exist but Drizzle has no journal entry:

```bash
npm run db:migrate:baseline -- 0000_init
npm run db:migrate
```

Schema changes: edit `src/app/lib/db/schema-pg.ts`, then `npm run db:generate` and commit new SQL under `src/app/lib/db/migrations/`.

## Vercel

| Setting | Value |
|---------|--------|
| Root Directory | Repository root (`handoff-app`) |
| Install Command | `npm ci` |
| Build Command | `npm run build:vercel` |
| Output Directory | `.handoff/runtime/.next` (after `vercel-build`) |

Set `DATABASE_URL`, `AUTH_SECRET`, and other env vars in the Vercel project. Run `npm run db:migrate` from your machine against the production database when schema changes ship.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for path contract and runtime details.

## Figma plugin (separate repo)

The Figma plugin is a **sibling project** (`handoff-figma-plugin`), not an npm dependency of `handoff-app`.

```bash
cd ../handoff-figma-plugin   # or your clone path
yarn install
yarn build
```

API types shared with the hosted app are copied into [`src/app/lib/figma-plugin-contract.ts`](../src/app/lib/figma-plugin-contract.ts). When you change the plugin contract (`handoff-figma-plugin/src/contract/index.ts`), update that file in the same PR (or follow-up) so Next.js and Vercel typecheck stay in sync.
