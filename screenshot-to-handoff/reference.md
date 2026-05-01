# Screenshot-to-Handoff — reference

## Name normalization

| User says | `snake_case` (folder + `id`) | `PascalCase` (symbol) | `kebab-case` (UI file) |
|-----------|------------------------------|------------------------|-------------------------|
| Hero Banner | `hero_banner` | `HeroBanner` | `hero-banner.tsx` |
| Product Card | `product_card` | `ProductCard` | `product-card.tsx` |
| FAQ Section | `faq_section` | `FaqSection` | `faq-section.tsx` |

Rules:

- Strip spaces and punctuation; lowercase with underscores for snake.
- Handoff built URL: `/api/component/<snake>-default.html`.

## Catalog screenshot (`image`) + Next static asset

Handoff’s `defineReactComponent` / `defineHandlebarsComponent` config accepts **`image`**: the URL shown in the component library for that block’s card (this repo treats it as the **catalog screenshot**).

1. **`id`** in the `*.handoff.ts` file is the filename stem (e.g. `product_slider` → `product_slider.png`). Exception: legacy `two_colum_content_legacy` declares `id: "two_colum_content"` — the PNG name follows **`id`**, not the folder name.
2. Save the raster at **`handoff/public/images/components/{id}.png`** so the storefront / Next app serves it at **`/images/components/{id}.png`**.
3. In the declaration, set **`image: "/images/components/{id}.png"`** (web-root path, leading slash).
4. **Aspect ratio:** **3:2** (e.g. **1200×800**). The repo script `pnpm capture:component-catalog-images` loads each built Handoff preview in a 1200×800 viewport and writes the PNGs after `pnpm --filter handoff run build`.

## P0 — Extraction checklist

### Text

- List every distinct string visible in the screenshot.
- For each string, ask: **would a content author change this per instance?**
  - **Yes** → `string` prop (or field on a row type if part of a list).
  - **No** (brand tagline fixed for this product) → keep as literal in JSX or a `const`.
- Preserve line breaks in copy as `\n` in a single prop or split into multiple props if layout requires it.

### Images

- For each raster or SVG region: add `imageSrc` + `imageAlt` (or `logoSrc` / `heroImageSrc` naming that matches the domain).
- Default preview values: use a real URL from the screenshot if readable; otherwise `https://placehold.co/WxH` with dimensions approximating the crop.
- Add `data-cy` on key images if the design implies automated tests (optional but consistent with other UI components).

### Layout

- Note approximate column splits (e.g. 2/3 + 1/3), vertical rhythm, centered vs left-aligned blocks.
- Prefer **flex** and **grid** with Tailwind responsive prefixes (`sm:`, `md:`, `lg:`) matching the screenshot viewport (Handoff previews often use 1280×720).

### Centered “artboard” container (block screenshots)

Design PNGs are almost always **not** full-bleed to the viewport: they sit on a white or neutral canvas with **side gutters**.

1. Outer wrapper: `w-full bg-white` (or `bg-background`) so the preview shows gutters.
2. Inner: `mx-auto max-w-6xl px-4 sm:px-6 lg:px-8` (tune `max-w-*` to the design).
3. Place the **hero / card / tinted region** inside that inner column so **background images and rounded corners are clipped to the artboard**, not the viewport.

Reference: [hero.tsx](../../../packages/ui/src/components/marketing/hero.tsx) (`data-cy="hero-section"` wraps the container; `data-cy="hero-inner"` is the imaged card).

### Buttons (reuse `Button`, extend variants)

1. If the screenshot shows **primary + secondary** (or similar) CTAs that will repeat across blocks, add **`variant` (and `size` if needed) entries** to `buttonVariants` in [button.tsx](../../../packages/ui/src/components/primitives/button.tsx) — e.g. **`promoFilled`** (white fill, teal label, `rounded-xl`) and **`promoOutline`** (white border, white label, `rounded-xl`) plus **`size="promo"`** for padding/typography.
2. In the block component, render links with **`Button asChild`** and a child **`<a href={…}>`** so semantics stay correct.
3. **Radius:** prefer **`rounded-xl`** (or `rounded-lg`) when the design is **not** a full pill; reserve `rounded-full` only when the screenshot shows true pills.
4. Do **not** copy the same 6+ utility classes onto raw `<a>` tags in every new component — extend the design system once, then compose.

### Interactivity

- Menus, tabs, accordions, carousels → minimal `useState` in the UI component; keep ARIA attributes (`aria-expanded`, `aria-controls`, `aria-label`) aligned with visible behavior.

## Color matching

1. From the screenshot, estimate key colors (background, text, borders, accents).
2. Open `packages/ui/src/styles/theme-import-tokens.css` (auto-generated) and search for the closest hex. Utilities look like `bg-legacy-cyan-06a7e0`, `text-legacy-near-black-222222`.
3. If no token is within ~1–2% of the intended color, add semantic variables to `packages/ui/src/styles/theme.css`:

   ```css
   :root {
     --my-block-accent: #1a2b3c;
   }
   @theme inline {
     --color-my-block-accent: var(--my-block-accent);
   }
   ```

   Then use `bg-my-block-accent` / `text-my-block-accent` in the component.

4. Regenerate import tokens only when mining legacy bundles: `pnpm generate:import-theme` — not required for greenfield screenshot components.

## `packages/ui` component template

File: `packages/ui/src/components/<group>/<kebab-name>.tsx` (pick `primitives`, `layout`, `marketing`, `product`, or `commerce`)

```tsx
"use client";

import * as React from "react";

import { cn } from "@petvet/ui/lib/utils";

/**
 * Screenshot-derived component (Handoff: <snake_name>).
 * Props contract inferred from design image + user name.
 */

export type ExampleProps = {
  title: string;
  className?: string;
};

function Example({ title, className }: ExampleProps) {
  return (
    <section className={cn("w-full bg-white", className)}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="…">{/* imaged / tinted card */}</div>
      </div>
    </section>
  );
}

export { Example };
```

Barrel addition in `packages/ui/src/index.ts`:

```ts
export { Example, type ExampleProps } from "./components/marketing/example";
```

## Handoff wrapper template

### `handoff/components/<snake>/<Pascal>.tsx`

```tsx
export {
  Example as default,
  type ExampleProps,
} from "@petvet/ui";
```

### `handoff/components/<snake>/styles.scss`

```scss
@import "@petvet/ui/globals.css";
```

### Minimum two previews (required)

Every Handoff component **must** ship with at least two previews:

1. **`default`** — **Generic / lorem-ipsum**: placeholder images via `https://placehold.co/WxH` (matching the aspect ratio of the real imagery, e.g. `800x1000` for portrait cards) and lorem-ipsum copy. This preview proves the component works independent of real content and is the one captured by `pnpm capture:component-catalog-images` and `pnpm test:visual:update`.
2. **`example`** — **Real content**: actual copy from the screenshot plus Unsplash or brand imagery. This preview shows what the block looks like with production-quality assets.

The `default` preview key is what Handoff builds as `<id>-default.html`, so catalog screenshots and visual regression tests always run against the generic version. The `example` preview builds as `<id>-example.html` for editorial review.

### `handoff/components/<snake>/<snake>.handoff.ts`

```ts
import { defineReactComponent } from "handoff-app";
import type { ExampleProps } from "@petvet/ui";
import Example from "./Example";

export default defineReactComponent(Example, {
  id: "example",
  name: "Example",
  image: "/images/components/example.png",
  description: "One short sentence from the screenshot / product context.",
  group: "Content",
  type: "block",
  shouldDo: ["…"],
  shouldNotDo: ["…"],
  entries: {
    component: "./Example.tsx",
    scss: "./styles.scss",
  },
  previews: {
    default: {
      title: "Default",
      args: {
        title: "Text copied from screenshot",
      } as Partial<ExampleProps>,
    },
    generic: {
      title: "Generic",
      args: {
        title: "Lorem ipsum heading",
      } as Partial<ExampleProps>,
    },
  },
});
```

**`properties` (recommended for Handoff property panels)**

Mirror each prop Handoff should document. Use `type` values Handoff accepts (e.g. `"text"`, `"image"`, `"boolean"`, `"array"`). For arrays, include `items` / nested `properties` following the shape used in [handoff/components/header/header.handoff.ts](../../../handoff/components/header/header.handoff.ts) — or keep `properties` minimal if the block is mostly static.

## Playwright visual spec template

File: `e2e/visual/<kebab>.spec.cjs`

```js
const { expect, test } = require("@playwright/test");

test.describe("Example — screenshot baseline", () => {
  test("default preview", async ({ page }) => {
    await page.goto("/api/component/example-default.html");
    await page.waitForLoadState("networkidle");
    const root = page.locator("section").first();
    await expect(root).toBeVisible();
    await expect(root).toHaveScreenshot("example-default.png", {
      maxDiffPixels: 200,
    });
  });
});
```

Adjust `root` selector to the outermost element the component renders.

## Refinement patterns (CategoryCards-style blocks)

Use these when polishing marketing cards after an initial pass:

1. **Brand product names with superscripts** — When the “logo” is stylized text with a suffix (e.g. `reflex` + `K9`), expose **`productName`** + **`productSuperscript`** and render the suffix in **`<sup>`**. Do not use an `<img>` for plain wordmark text.
2. **Flush top tab** — If the product name tab is pinned to the card's top edge, omit top padding on the tab and use **`rounded-b-xl`** (bottom corners only) instead of `rounded-xl`. Center the tab horizontally with `mx-auto` (or offset with `ml-4` if the design is left-aligned). The tab sits directly as a child of the card — no extra centering wrapper needed.
3. **Highlight last N words** — If the colored phrase is always the **trailing** words of one sentence, pass a single **`headline`** string plus **`highlightWordCount`** (default `2`) and split in JS. Avoid three props like `headlineBefore` / `headlineHighlight` / `headlineAfter` unless layout truly needs them.
4. **Card-as-link** — When the **entire card** is clickable, wrap content in **`<a href={…}>`** and render the visual CTA as a **`<span>`** styled like a button (e.g. `buttonVariants({ variant: "cardCta", size: "card" })`). Nested **`<a>` inside `<a>`** is invalid HTML.
5. **Left-aligned card content** — When the screenshot shows headlines and CTAs left-aligned (not centered), use **`items-start`** on the flex column and drop `text-center`. Keep headline text large (`text-2xl md:text-3xl`) unless the design clearly uses smaller sizing.
6. **Staggered card heights (positive margin)** — Instead of a negative `margin-top` on the tall/middle card (which can overlap blocks above), apply a **positive `mt`** on the **short** (outer) cards. The tall card stays at natural position while short cards shift down, creating the same visual stagger without overflowing the section boundary.
8. **Mosaic grid with alternating image/content cards** — For two-row mosaics where a narrow image card (1/4) pairs with a wider content card (3/4), use a **4-column grid** (`md:grid-cols-4`) with `md:col-span-1` / `md:col-span-3`. Alternate which side the image sits on via an `imageRight` boolean per row.
9. **CTA card with mode discriminator** — When a colored content card has two layout patterns (e.g. title+body+CTA vs eyebrow+title+body), use a **`mode`** discriminated union rather than optional props. This keeps each mode’s required fields enforced at the type level.
10. **Block header: centered, normal weight** — If the block’s section heading is centered and not bold in the screenshot, use `font-normal text-center` on the `<h2>`. Avoid defaulting to `font-bold` for marketing block headers unless the design clearly shows heavy weight.
11. **Shared brand tokens** — Replace repeated hex teals/navies with **`theme.css`** semantic colors (e.g. `text-brand-teal`, `text-brand-navy`) so future blocks stay consistent.
12. **Shared draggable product slider row** — When multiple blocks need a horizontal product slider (e.g. `ProductSlider` and `ProductSliderCallout`), extract a **`ProductSliderRow`** component that owns the scroll container, drag-to-scroll, conditional left/right arrows, and fade-edge gradients. The row accepts `products`, optional `cardClassName` for width tuning, and an optional `fadeBg` class for matching the section background. Consuming blocks just wrap a title/callout around `<ProductSliderRow />`.
13. **Two-part heading (dual colour)** — When the heading has two colour runs (e.g. dark navy + teal accent), expose **`titleLine1`** + **`titleLine2`** and render them in two `<span>` elements with distinct Tailwind text colours.

## Discoverability

Handoff picks up any `handoff/components/**/<name>.handoff.ts` via `entries.components` in `handoff/handoff.config.ts`. No config edit is needed for a new folder under `handoff/components/`.

## Trigger phrases (for skill description QA)

The skill `description` includes: screenshot, image, Handoff, React, Tailwind, `defineReactComponent`, previews, properties, design, mockup, Figma export, visual spec to code — so conversational requests like “build this Handoff block from my screenshot” should load this skill.
