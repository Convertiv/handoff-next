# SS&C Icon Registry

Approved icon patterns used across SS&C Handoff components. When building new
components, use icons from this registry to maintain consistency.

---

## Font Awesome Icons

The project uses Font Awesome 6 via a kit loaded in `fontawesome.js`.
Icons are rendered as raw HTML strings in `type: "icon"` property fields using
triple-stache in templates: `{{{this.icon}}}`.

### Currently used icons

| Icon | Class | Used in |
|---|---|---|
| Search | `fa-solid fa-magnifying-glass` | icon_features |
| Search (regular) | `fa-regular fa-magnifying-glass` | menu |
| File | `fa-regular fa-file` | icon_features |
| Chart | `fa-regular fa-chart-bar` | icon_features_card |
| Paste | `fa-regular fa-paste` | icon_features_card |
| Close | `fa-regular fa-times` | menu |
| Facebook | `fa-brands fa-facebook` | footer |
| Instagram | `fa-brands fa-instagram` | footer |
| LinkedIn | `fa-brands fa-linkedin` | footer |
| Twitter/X | `fa-brands fa-twitter` | footer |

### Legacy format

Some older components use the v5 shorthand format (e.g., `fas fa-chart-line`).
New components should use the v6 format: `fa-{style} fa-{name}`.

### Icon property pattern

When adding an icon field to a component:

```js
"icon": {
  "name": "Icon",
  "type": "icon",
  "description": "Font Awesome icon HTML.",
  "default": "<i class=\"fa-regular fa-file\"></i>",
  "rules": {
    "required": false,
    "content": { "min": 0, "max": 500 }
  }
}
```

In the template, render with triple-stache (unescaped HTML):

```handlebars
<div class="icon-wrapper text-primary">
  {{{this.icon}}}
</div>
```

---

## Inline SVG

Some components use inline SVGs for brand-specific graphics that are not
available in Font Awesome. These are typically arrows, chevrons, decorative
elements, and brand logos.

### Components using inline SVG

| Component | SVG Purpose |
|---|---|
| `accordion` | Expand/collapse chevron |
| `hero_cards` | Decorative arrow |
| `hero_split` | CTA arrow, decorative elements |
| `icon_text_cards` | Card link arrow |
| `image_text_card` | Link arrow |
| `image_text_card_highlighted` | Link arrow |
| `key_resource` | Download/link arrow |
| `menu` | Navigation chevrons, hamburger |
| `stackable_image_text` | Link arrow |
| `vertical_accordion` | Expand/collapse chevron |
| `video_split` | Play button, decorative elements |

### When to use which

| Use case | Pattern |
|---|---|
| Standard UI icons (search, close, social) | Font Awesome `<i>` tag |
| Directional arrows, chevrons | Inline `<svg>` (copy from existing components) |
| Brand-specific graphics | Inline `<svg>` |
| User-uploaded icons | `type: "image"` with `src`/`alt` |

### Common SVG patterns to reuse

**Right arrow (used in CTAs):**
```html
<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 8H15M15 8L8 1M15 8L8 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

**Chevron down (used in accordions):**
```html
<svg width="12" height="8" viewBox="0 0 12 8" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 1L6 6L11 1" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

Use `stroke="currentColor"` so SVGs inherit the text colour from their parent.
