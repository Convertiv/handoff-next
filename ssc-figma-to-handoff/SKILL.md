---
name: ssc-figma-to-handoff
description: "Translates Figma designs into SS&C Handoff components with pixel-perfect fidelity. Use when implementing a new component from Figma, redesigning an existing component, or when the user mentions 'implement from Figma', 'create component', 'build from design', or provides a Figma URL for this project."
---

# SS&C Figma-to-Handoff Component Skill

This skill guides the creation of Handoff components from Figma designs in the
SS&C Design System project. It enforces project-specific conventions that differ
from the generic `figma-implement-design` skill.

## Prerequisites

Before using this skill, read the project's `AGENTS.md` for full conventions.

## Workflow

### Step 1: Gather design context

1. Locate the `figma` URL in the component's `.js` config, or accept one from the user
2. Extract `fileKey` (`0gKWw8gYChpItKWzh8o23N`) and `nodeId` (convert `-` to `:`)
3. Call `get_design_context` with `fileKey` and `nodeId`
4. Call `get_screenshot` — keep this open as the visual reference throughout

### Step 1b: Save the component screenshot

The `"image"` field in the component config points to
`/images/components/{id}.png`. This file **MUST** exist in the project at
`handoff/public/images/components/{id}.png`.

1. Ensure the directory exists:
   ```bash
   mkdir -p handoff/public/images/components
   ```
2. Call `get_screenshot` with the extracted `fileKey` and `nodeId`.
3. The MCP response returns a screenshot image. Download it to the project:
   ```bash
   curl -L -o handoff/public/images/components/{id}.png "{screenshot_url}"
   ```
   Replace `{screenshot_url}` with the image URL from the MCP response and
   `{id}` with the component ID.
4. If the MCP response returns inline image data without a downloadable URL,
   note this in your output and flag the screenshot as needing manual capture.
5. Verify the file was saved:
   ```bash
   ls -la handoff/public/images/components/{id}.png
   ```

### Step 2: Search for reusable patterns

Before creating anything new:

1. Read `handoff/reference/catalog.md` — check if a similar component already exists
2. Read `handoff/reference/property-patterns.md` — reuse canonical property shapes for:
   - Section headings (`title_prefix` + `title`)
   - CTA buttons (`type: "button"`)
   - Images with dimension rules
   - Link fields
   - Dark mode toggles
   - Breadcrumb arrays
3. Read `handoff/reference/icons.md` — use approved Font Awesome icons
4. Read `handoff/reference/tokens.md` — map all colours to CSS custom properties

### Step 3: Build the component config (`{name}.js`)

```js
/** @type {import('handoff-app').Component} */
module.exports = {
  "id": "{name}",
  "title": "Component Title",
  "description": "One or two sentences.",
  "image": "/images/components/{name}.png",
  "figma": "https://www.figma.com/design/0gKWw8gYChpItKWzh8o23N/...",
  "type": "block",
  "group": "...",
  "categories": [...],
  "tags": [...],
  "should_do": ["At least one usage guideline"],
  "should_not_do": ["At least one anti-pattern"],
  "entries": {
    "scss": "./style.scss",
    "js": "./script.js",        // only if interactive
    "template": "./template.hbs"
  },
  "properties": { /* ... */ },
  "previews": {
    "generic": { "title": "...", "values": { /* placeholder content */ } },
    "live":    { "title": "...", "values": { /* real SS&C content */ } }
  }
};
```

Rules:
- Every property needs `name`, `description`, `type`, `default`, `rules`
- Array items must have typed inner `properties`
- At least 2 previews with `values` (not `properties`)
- All preview `values` keys must exist in `properties`

### Step 4: Build the template (`template.hbs`)

- Use Bootstrap 5 utility classes, not Tailwind
- Render icons with triple-stache: `{{{this.icon}}}`
- Add `data-component="{name}"` to the outer `<section>` if the component has JS
- Use `{{properties.fieldName}}` bindings for all dynamic content
- Use `{{#field 'fieldName'}}...{{/field}}` for CMS-editable regions

### Step 5: Build the stylesheet (`style.scss`)

- **CRITICAL: The FIRST non-comment line MUST be `@import '~/integration/sass/main.scss';`**
  Without this import, Bootstrap SCSS variables (`$white`, `$gray-100`, etc.)
  are undefined and the component will fail to compile.
- Use `var(--color-*)` tokens — never hardcode hex
- Bootstrap SCSS variables (`$white`, `$black`, `$gray-*`, `$primary`, etc.)
  are available through the import for colour values
- Scope all rules under `.{component-name}` prefix
- Prefer Bootstrap utilities in the template over writing SCSS

### Step 6: Build the script (`script.js`) — only if needed

- Use the multi-instance pattern: `querySelectorAll('[data-component="..."]').forEach(block => ...)`
- Scope all queries to `block`
- Include JSDoc header with `@requires`, `@instance`, `@see`
- If delegating to a shared utility, use `@shared` annotation + import

### Step 7: Validate

1. Run `npm run validate:schema` — check structural correctness
2. Run `npm run validate:scss` — check for hardcoded hex values
3. Run `npm run validate` — accessibility check
4. Visually compare rendered preview against Figma screenshot
5. Check that all preview variants render correctly

## Common Tailwind-to-Bootstrap mappings

| Tailwind | Bootstrap 5 |
|---|---|
| `flex` | `d-flex` |
| `items-center` | `align-items-center` |
| `justify-between` | `justify-content-between` |
| `gap-4` | `gap-4` (same) |
| `text-sm` | `small` or `fs-6` |
| `text-lg` | `fs-5` |
| `font-semibold` | `fw-semibold` |
| `font-bold` | `fw-bold` |
| `font-medium` | `fw-medium` |
| `text-gray-500` | `text-muted` |
| `rounded-lg` | `rounded-3` |
| `shadow-md` | `shadow` |
| `p-4` | `p-4` (same) |
| `mx-auto` | `mx-auto` (same) |
| `w-full` | `w-100` |
| `hidden` | `d-none` |
| `grid grid-cols-3` | `row` + `col-lg-4` |

## Token quick reference

### Colours
- Primary: `--color-primary-ssc-blue`, `--color-primary-cobalt`, `--color-primary-navy`
- Secondary: `--color-secondary-teal`, `--color-secondary-dark-teal`, `--color-secondary-dark-gray`
- Accent: `--color-accent-yellow`, `--color-accent-gray`
- Text: `--color-text-hard`, `--color-text-base`, `--color-text-soft`, `--color-text-muted`

### Effects
- Card shadow: `--effect--shadow-100`

### Typography
- Font: `--font-family-barlow`
- Headings: `--typography-heading-{1..7}-font-size`
- Paragraphs: `--typography-paragraph-{xs,sm,base,lg,xl}-font-size`
