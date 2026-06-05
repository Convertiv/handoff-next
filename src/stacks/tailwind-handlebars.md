# Tailwind + Handlebars Stack Guide

## Component Structure

```
components/
  button/
    button.handoff.ts     — declaration (metadata, properties, previews, entries)
    template.hbs          — Handlebars template
    style.scss            — optional component overrides (Tailwind handles most styling)
    script.js             — optional client-side JS
    dist/                 — built artifacts (committed to git)

elements/                 — shared primitives registered as Handlebars partials
  cta/
    partial.hbs
  icon/
    partial.hbs
```

## Declaration File

```ts
import { defineHandlebarsComponent } from 'handoff-app';

export default defineHandlebarsComponent({
  id: 'button',
  title: 'Button',
  description: 'Primary action button.',
  group: 'atoms',
  type: 'element',
  entries: {
    template: './template.hbs',
    scss: './style.scss',
  },
  properties: {
    label: { type: 'text', default: 'Click me' },
    variant: { type: 'select', options: ['primary', 'secondary', 'ghost'], default: 'primary' },
    size: { type: 'select', options: ['sm', 'md', 'lg'], default: 'md' },
    disabled: { type: 'boolean', default: false },
  },
  previews: {
    default: { title: 'Default', values: { label: 'Button', variant: 'primary' } },
    secondary: { title: 'Secondary', values: { label: 'Button', variant: 'secondary' } },
  },
});
```

## Handlebars Template Conventions

- Access properties via `{{properties.propName}}`
- Apply Tailwind utility classes directly — mobile-first, variant-specific classes via `{{#if}}`
- Include elements via `{{> element-name}}` (registered as partials via `registerHandlebarsHelpers` hook)
- Use triple-stache `{{{rawHtml}}}` for SVG/icon injection

```hbs
<button
  class="inline-flex items-center justify-center rounded-md font-medium transition-colors
    {{#if (eq properties.variant 'primary')}}bg-primary text-primary-foreground hover:bg-primary/90{{/if}}
    {{#if (eq properties.variant 'secondary')}}bg-secondary text-secondary-foreground{{/if}}
    {{#if (eq properties.variant 'ghost')}}hover:bg-accent hover:text-accent-foreground{{/if}}
    {{#if (eq properties.size 'sm')}}h-9 px-3 text-sm{{/if}}
    {{#if (eq properties.size 'lg')}}h-11 px-8 text-lg{{/if}}
    {{#unless (eq properties.size 'sm')}}{{#unless (eq properties.size 'lg')}}h-10 px-4{{/unless}}{{/unless}}
    {{#if properties.disabled}}opacity-50 pointer-events-none{{/if}}"
  {{#if properties.disabled}}disabled aria-disabled="true"{{/if}}
  type="button"
>
  {{properties.label}}
</button>
```

## Tailwind CSS v4 Conventions

Define all design tokens in the project token file using `@theme {}`:

```css
@import "tailwindcss";

@theme {
  --breakpoint-tablet: 810px;
  --breakpoint-desktop: 1280px;

  --color-primary: oklch(55% 0.2 30);
  --color-primary-foreground: white;
  --color-secondary: oklch(95% 0.01 0);

  --font-heading: "Juana", serif;
  --font-body: "Inter", sans-serif;

  --text-h1: 3.5rem;
  --text-body: 1rem;
}
```

- Custom breakpoints via `--breakpoint-*` (use as `tablet:`, `desktop:` prefixes)
- Custom colors via `--color-*` (use as `bg-primary`, `text-primary`, etc.)
- Custom fonts via `--font-*` (use as `font-heading`, `font-body`)
- Source scanning: `@source "../components/**/*.hbs"` to include component template classes

## Element Partials

Elements in `elements/` are shared Handlebars partials registered in `handoff.config.cjs`:

```js
hooks: {
  registerHandlebarsHelpers(handlebars) {
    const elementsDir = './elements';
    // Register each element's partial.hbs as {{> element-name}}
    registerElementPartials(handlebars, elementsDir);
  }
}
```

Include in templates: `{{> cta}}`, `{{> icon}}`, `{{> button-group}}`.

## SCSS Conventions (when used)

- Component SCSS is for overrides and animations only — Tailwind handles layout/color/spacing
- Import Tailwind at the top of the main entry, not per-component
- Use CSS custom properties (defined in `@theme`) rather than hardcoded values

## JavaScript Conventions

- Multi-instance pattern: `document.querySelectorAll('[data-component="button"]').forEach(...)`
- Avoid framework dependencies — vanilla JS only
- Wrap in `DOMContentLoaded`

## Responsive Breakpoints

This stack uses custom breakpoints defined in `@theme`. Standard breakpoints:
- `tablet:` — ≥ 810px
- `desktop:` — ≥ 1280px  
- `desktop-lg:` — ≥ 1440px (if defined)

Always design mobile-first; add `tablet:` and `desktop:` overrides as needed.

## Vite Hook Expectations

- `cssBuildConfig` — Tailwind v4 via `@tailwindcss/postcss`, with `@source` directives for component templates
- `clientBuildConfig` — standard ES module, no framework-specific transforms needed
- `registerHandlebarsHelpers` — element partial registration, any custom Handlebars helpers (`eq`, `json`, etc.)
