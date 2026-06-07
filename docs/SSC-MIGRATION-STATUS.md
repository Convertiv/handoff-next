# SSC Migration Status (Reference)

Reference document for the SSC → hosted registry migration under ADR-001.
SSC serves as the proof-of-concept for the registry-as-service architecture.

## What's deployed

| Component | Status | URL / Location |
|-----------|--------|----------------|
| Registry app | ✓ Live | `https://ssc-handoff.vercel.app` |
| Registry repo source | ✓ | `convertiv/handoff-next` on `feature/mcp-prototype` |
| Registry Postgres | ✓ Configured | Vercel Postgres attached to the SSC Vercel project |
| Auto-migration | ✓ Verified | `instrumentation.ts` runs on cold start, applies pending migrations |
| First-admin setup | ✓ Verified | `/setup` form created admin account, redirected to `/login` |
| MCP endpoint | ✓ Verified | `/api/mcp/` reachable, JWT or bearer auth working |
| Push pipeline | ✓ Verified | Components push successfully with batching + shared-asset dedup |
| Screenshot pipeline | ✓ Verified | 83 PNG screenshots generated on first build |

## What's been pushed (or pushable via `push:all`)

| Content | Source | Status |
|---------|--------|--------|
| Components | `handoff/components/*/dist/` | ✓ Test push of 3 succeeded; full push pending |
| Component sources | `handoff/integration/components/` | Pushed empty (SSC uses legacy layout, not v2 — expected) |
| Component shared bundles | `handoff/public/api/component/main.{css,js},shared.css` | ✓ Attached to first component in batch |
| Component screenshots | `handoff/components/*/dist/screenshot.png` | ✓ Generated, ready to push |
| Pages | `handoff/pages/*.md` | Pushed via `push:all` (runPush) |
| Theme CSS | `handoff/theme.css` (or workspace-compiled output) | Pushed via `pushRegistryTheme` |
| Navigation | derived from `handoff/pages/` filesystem | Pushed via `pushRegistryNavigation` |
| Tokens | `handoff/public/api/tokens.json` | Pushed via `pushRegistryTokens` |
| Project config | `handoff/handoff.config.js` `app` block | Pushed via `pushRegistryConfig` |

## Final verification checklist

To call SSC migration complete:

- [x] Registry deploys cleanly from `convertiv/handoff-app` on a stable branch
- [x] `npm run start` in `ssc-handoff-next/handoff/` boots workspace mode
- [x] `handoff-app login --url https://ssc-handoff.vercel.app` succeeds
- [x] `handoff-app push --components button blog hero_split` lands at registry
- [x] Registry's `/system/component/button` renders the pushed preview
- [x] Component screenshots visible in `/system/component` catalog
- [x] `/system` page shows full left sidebar (component catalog populated)
- [ ] `handoff-app push:all` succeeds end-to-end (config + components + pages + theme + nav + tokens)
- [ ] Registry's `/foundations` shows tokens after `push:all`
- [ ] Registry's home page reflects SSC's `title`, `client` from pushed config
- [ ] Registry's theme CSS makes the site look like SSC's brand
- [ ] MCP from a separate machine (e.g. Claude Code with `.claude/settings.json` pointing at the Vercel URL + bearer token) can read SSC's components, tokens, stack guide

The first 7 are verified. The last 5 require a `push:all` run after the latest
handoff-app deploy lands on Vercel (commit 9938d035 with screenshots).

## How to verify the remaining 5

```bash
# From SSC workspace
cd ssc-handoff-next/handoff

# Ensure the workspace has the latest handoff-app CLI
cd ..
npm update handoff-app
cd handoff

# Make sure HANDOFF_CLOUD_URL is set in .env (or already from login)
# Push everything in one shot
handoff-app push:all

# Expected output (something like):
# [handoff] Pushing registry config…
# [handoff] Registry config pushed.
# [handoff] Splitting 83 changes into 5 batches (server body-size limit).
# [handoff] Pushing batch 1/5: 18 change(s), 3287KB
# ...
# [handoff] Pushing registry theme (124KB from theme.css)…
# [handoff] Registry theme pushed.
# [handoff] Pushing registry navigation (4 top-level nodes)…
# [handoff] Registry navigation pushed.
# [handoff] Pushing registry tokens snapshot…
# [handoff] Registry tokens pushed.
# [handoff] push:all completed successfully.
```

Then visit each URL and confirm:

| URL | What you should see |
|-----|---------------------|
| `https://ssc-handoff.vercel.app/` | Home page with SSC branding (title 'SS&C Design System') |
| `/system/component` | All 83 components with screenshots |
| `/system/component/button` | Button previews, properties, source |
| `/foundations/colors` | SS&C color tokens |
| `/foundations/typography` | Barlow font samples |
| `/api/registry/theme.css` | Returns the pushed CSS bytes |
| `/api/registry/config` | Returns the SSC `app` config as JSON |

## Known gaps (deferred to follow-up tasks)

- Source files (`*.handoff.ts`, `template.hbs`, etc.) aren't pushed for SSC
  because SSC uses the legacy `integration/components/` layout, not the v2
  `components/[id]/` layout. `collectComponentSourceFiles` only walks the v2
  layout. Workaround: components still display fine — only the "view source"
  panel is empty. Fixing this is a project-specific migration, not a
  handoff-app gap.
- Component validation results aren't surfaced on the registry yet (task #48).
- The old SSC Vercel project (that used to deploy SSC's content as a Next.js
  app) is still running alongside the new registry. Safe to delete once the
  new registry is fully verified.
