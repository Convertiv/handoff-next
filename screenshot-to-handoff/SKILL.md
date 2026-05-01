---
name: screenshot-to-handoff
description: >-
  Builds a new Handoff React component from a user-provided screenshot image
  (PNG, JPG, WebP) plus a component name: typed Tailwind UI in packages/ui,
  thin Handoff wrapper with defineReactComponent, previews and properties from
  extracted text and images, and Playwright visual baselines. Use when creating
  a component from a design screenshot, Figma export, mockup, wireframe,
  pasted UI image, design-to-code, visual spec to code, greenfield Handoff
  block, or screenshot-driven Handoff component scaffolding without
  components_import.
---

# Screenshot → Handoff React + Tailwind

## Read first

- **Templates, naming, and color matching:** [reference.md](reference.md)
- **Handoff wiring in this repo:** [handoff/docs/handoff-legacy-component-migration.md](../../../handoff/docs/handoff-legacy-component-migration.md)
- **Visual tests (HTTP server, not `file://`):** [e2e/visual/README.md](../../../e2e/visual/README.md)

## Inputs (required)

1. **Screenshot** — a user-provided image file (PNG/JPG/WebP) or an image pasted in chat that the agent can read.
2. **Component name** — user-chosen identifier. Normalize to:
   - **`snake_case`** for Handoff folder + `id` + built HTML path (e.g. `hero_banner` → `/api/component/hero_banner-default.html`).
   - **`PascalCase`** for the React component symbol (e.g. `HeroBanner`).
   - **`kebab-case`** for `packages/ui/src/components/<group>/<name>.tsx` (under `primitives/`, `layout/`, `marketing/`, `product/`, or `commerce/`).

## Phased pipeline

| Phase | Goal |
|-------|------|
| **P0 — Analyze** | From the screenshot: layout (flex/grid, alignment), text layers → string props, images → `imageSrc`/`imageAlt` (or typed pairs), colors → `legacy-*` / `theme.css`, interactive bits → local `useState` if needed. Decide what is **props** vs **fixed JSX**. |
| **P1 — Implement** | Add `packages/ui/src/components/<group>/<kebab>.tsx` (e.g. `marketing/`, `product/`, `commerce/`, `layout/`, `primitives/`): `"use client"`, `import * as React from "react"`, `import { cn } from "@petvet/ui/lib/utils"`, export `XxxProps` + sub-types, named component export. Tailwind + tokens only. **Prefer** plain text props over `dangerouslySetInnerHTML`. **Block layout:** screenshot blocks are usually artboard-width, not edge-to-edge — wrap the colored / imaged surface in a **centered container** (`max-w-* mx-auto px-*` on a white or page-bg outer shell) so gutters match the design file. **Buttons:** reuse [Button](../../../packages/ui/src/components/primitives/button.tsx) with `asChild` + `<a>` when the control is a link; add **new `variant` / `size` entries** to `buttonVariants` (e.g. `promoFilled` / `promoOutline` + `size="promo"`) instead of duplicating long Tailwind strings on every block. Match **border radius** to the screenshot (`rounded-xl` vs `rounded-full`). |
| **P2 — Handoff** | Create `handoff/components/<snake>/`: `<Pascal>.tsx` re-exports default + types from `@petvet/ui`; `styles.scss` → `@import "@petvet/ui/globals.css";`; `<snake>.handoff.ts` uses `defineReactComponent(Imported, { … })` with `entries: { component, scss }`, **`image: "/images/components/<id>.png"`** (Handoff catalog thumbnail; same as the design screenshot when applicable), `previews.default` + `previews.generic` with `args` typed as `Partial<XxxProps>`, and a **`properties`** block mirroring props for Handoff docs (see [reference.md](reference.md)). After `pnpm --filter handoff run build`, capture the PNG into **`handoff/public/images/components/<id>.png`** at **3:2** (see [reference.md](reference.md) — `pnpm capture:component-catalog-images`). |
| **P3 — Verify** | `pnpm --filter @petvet/ui run lint`, `pnpm --filter handoff run build`. If Handoff fails with `ENOTEMPTY` on `.next`, remove `node_modules/.pnpm/handoff-app@*/node_modules/handoff-app/.handoff/*/.next` and rebuild. Run **`pnpm capture:component-catalog-images`** to refresh **`handoff/public/images/components/<id>.png`** (3:2). Add `e2e/visual/<kebab>.spec.cjs` targeting `/api/component/<snake>-default.html` with `baseURL` from [playwright.config.cjs](../../../e2e/visual/playwright.config.cjs). Run `pnpm test:visual:update` once for baselines. |
| **P4 — Iterate** | Read the original screenshot and the Playwright snapshot PNG side-by-side; tighten Tailwind until parity is acceptable; re-run `pnpm test:visual` after intentional changes. |

## Non-negotiables

1. **`defineReactComponent`**: first argument is the **imported** component; `entries.component` must point at the wrapper `.tsx` (not `tsx` as a typo for `component`).
2. **Previews use `args`**, not Handlebars `values`.
3. **Visual tests** must hit `http://localhost:4173/...` (or whatever `baseURL` the repo uses) after `pnpm --filter handoff run build` — never rely on `file://` for built previews (CSS paths break).
4. **Barrel**: export the new component and all types Handoff needs from [packages/ui/src/index.ts](../../../packages/ui/src/index.ts).

## Reference pilots (this repo)

- **Screenshot block + promo buttons:** [packages/ui/src/components/marketing/hero.tsx](../../../packages/ui/src/components/marketing/hero.tsx) (centered container + `Button` `promoFilled` / `promoOutline`) + [packages/ui/src/components/primitives/button.tsx](../../../packages/ui/src/components/primitives/button.tsx) (`buttonVariants`).
- **Simple layout:** [packages/ui/src/components/marketing/image-text-content-row.tsx](../../../packages/ui/src/components/marketing/image-text-content-row.tsx) + [handoff/components/image_text_content_row/image_text_content_row.handoff.ts](../../../handoff/components/image_text_content_row/image_text_content_row.handoff.ts)
- **State + nav:** [packages/ui/src/components/layout/site-header.tsx](../../../packages/ui/src/components/layout/site-header.tsx) + [handoff/components/header/header.handoff.ts](../../../handoff/components/header/header.handoff.ts)
- **Visual spec:** [e2e/visual/header.spec.cjs](../../../e2e/visual/header.spec.cjs)
- **Legacy color utilities:** [packages/ui/src/styles/theme-import-tokens.css](../../../packages/ui/src/styles/theme-import-tokens.css) (generated — prefer matching before adding new theme vars in [theme.css](../../../packages/ui/src/styles/theme.css))

## Relationship to handoff-legacy-to-react

- **Legacy skill:** migrates existing `components_import` metadata + `template.hbs`.
- **This skill:** **no** `components_import` source — contract comes **only** from the screenshot + user name. Output shape is the same (UI package + Handoff + optional visual test).
