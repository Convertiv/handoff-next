# Stack guide: bootstrap-handlebars

## Templates and config

- **Templates:** Handlebars (`.hbs`), `class` not `className`
- **Config:** `module.exports` in `{id}.js` with `entries.template`, `entries.scss`, optional `entries.js`
- **Properties:** Every field needs `"name"`, `"description"`, `"type"`, `"default"`, `"rules"`
- **Array items:** `type: "object"` must define `items.properties` for each inner field
- **Previews:** At least `generic` and one variant preview; use `values` in `previews`, not `properties`
- **JS:** Optional `script.js` with multi-instance `querySelectorAll('[data-component="..."]')`, scope queries to `block`

## SCSS (required)

The **first non-comment line** of `style.scss` must be:

```scss
@import '~/integration/sass/main.scss';
```

Without this import, Bootstrap SCSS variables are undefined. Scope rules under `.{component-id}` or BEM prefix. Use `var(--color-*)` tokens — never hardcode hex.

## Bootstrap 5 (not Tailwind)

| Tailwind / Figma MCP output | Bootstrap 5 |
|---|---|
| `flex` | `d-flex` |
| `items-center` | `align-items-center` |
| `justify-between` | `justify-content-between` |
| `text-sm` | `small` or `fs-6` |
| `font-semibold` | `fw-semibold` |
| `text-gray-500` | `text-muted` |
| `rounded-lg` | `rounded-3` |
| `w-full` | `w-100` |
| `hidden` | `d-none` |
| `grid grid-cols-3` | `row` + `col-lg-4` |

Render icons with triple-stache: `{{{this.icon}}}`. Add `data-component="{kebab-id}"` on the outer `<section>` when the component has JS.

## Property patterns

Call `handoff_get_reference` with `property-patterns` before inventing shapes. Common patterns: `title_prefix` + `title`, `button` CTAs, `image` with dimension rules, `link`, `boolean` dark mode, `array` of `object` items.

## Validation

After creating or editing components:

```bash
npm run validate:schema
npm run validate:scss
```

## MCP workflow order

1. `handoff_get_project_context`
2. `handoff_get_stack_guide`
3. `handoff_get_reference` (catalog → property-patterns → tokens → icons)
4. `handoff_get_design_guidelines` + `handoff_get_brand_voice`
5. Figma MCP for design context when implementing from Figma
6. `handoff_sync_push` after writing files locally

Do not use React, Tailwind, or inline hex colors in this profile.
