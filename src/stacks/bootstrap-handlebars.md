# Bootstrap + Handlebars Stack Guide

## Component Structure

Each component lives in its own directory under `components/` or the configured entries path:

```
components/
  button/
    button.handoff.ts     — declaration (metadata, properties, previews, entries)
    template.hbs          — Handlebars template
    style.scss            — component styles (imports shared SCSS)
    script.js             — optional client-side JS (multi-instance pattern)
    dist/                 — built artifacts (committed to git)
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
    js: './script.js',
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

- Access properties via `{{properties.propName}}` or destructured `{{propName}}` depending on config
- Use Bootstrap 5 utility classes directly on elements
- Include partials with `{{> partial-name}}` — partials are registered via `registerHandlebarsHelpers` hook
- Use `{{#if condition}}...{{/if}}` for conditional rendering
- Use `{{#each items as |item|}}...{{/each}}` for loops
- Raw HTML (icons, SVG) uses triple-stache `{{{icon}}}`

```hbs
<button
  class="btn btn-{{properties.variant}} btn-{{properties.size}}{{#if properties.disabled}} disabled{{/if}}"
  {{#if properties.disabled}}disabled aria-disabled="true"{{/if}}
  type="button"
>
  {{#if properties.icon}}{{{properties.icon}}}{{/if}}
  {{properties.label}}
</button>
```

## SCSS Conventions

- Import the shared entry at the top: `@use '~/integration/sass/main' as *;`
- Use Bootstrap variables and mixins where possible
- Component class name matches component id: `.button { ... }`
- BEM sub-elements: `.button__icon { ... }`, `.button--disabled { ... }`
- Override Bootstrap tokens via CSS custom properties, not variable reassignment

```scss
@use '~/integration/sass/main' as *;

.button {
  // component-specific overrides only — Bootstrap handles the base
  &__icon {
    margin-right: var(--bs-btn-padding-x);
  }
}
```

## JavaScript Conventions

- Multi-instance pattern — never use `getElementById`, always `querySelectorAll`
- Wrap in `DOMContentLoaded`
- Use `data-component="[id]"` attribute as the selector hook

```js
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-component="button"]').forEach((el) => {
    // per-instance logic here
  });
});
```

## Design Tokens

Tokens from Figma are exported to `integration/sass/exported/tokens/`:
- `colors.css` — CSS custom properties for brand colors
- `typography.css` — font families, sizes, weights
- `effects.css` — shadows, border radii

Reference tokens as CSS custom properties: `var(--color-primary-500)`, `var(--font-heading)`.

## Vite Hook Expectations

The `handoff.config.cjs` hooks control the Vite build. This stack expects:
- `cssBuildConfig` — handles SCSS with Bootstrap import resolution
- `clientBuildConfig` — standard ES module output
- `registerHandlebarsHelpers` — registers element partials for `{{> partial-name}}`

## Bootstrap Version

Bootstrap 5.x — use utility classes, grid, components. Avoid Bootstrap 4 patterns (no jQuery dependency, flexbox-first, CSS custom properties for theming).
