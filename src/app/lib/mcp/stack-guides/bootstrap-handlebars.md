# Stack guide: bootstrap-handlebars

- **Templates:** Handlebars (`.hbs`), `class` not `className`
- **CSS:** Bootstrap 5 grid/utilities + component SCSS; colors via `var(--color-*)` from tokens
- **JS:** Optional `script.js` with `querySelectorAll` multi-instance pattern
- **Config:** `module.exports` in `{id}.js` with `entries.template`, `entries.scss`, optional `entries.js`
- **Properties:** Every field needs `"name"`; array items of type `object` must define `items.properties`
- **Previews:** At least `generic` preview with `values` in `previews`

Do not use React, Tailwind, or inline hex colors.
