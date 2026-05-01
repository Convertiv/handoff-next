# SS&C Property Pattern Library

Canonical reusable property shapes for Handoff components. Copy these patterns
when building new components to ensure consistency across the design system.

---

## Section Heading (title_prefix + title)

Used in 40+ components. The `title_prefix` renders as regular weight text,
followed by `title` in bold/primary colour.

```js
"title_prefix": {
  "name": "Title Prefix",
  "description": "First part of the section heading (regular weight).",
  "type": "text",
  "default": "Section Header",
  "rules": {
    "required": false,
    "content": { "min": 5, "max": 40 }
  }
},
"title": {
  "name": "Title",
  "description": "Bold/emphasized part of the section heading.",
  "type": "text",
  "default": "main title",
  "rules": {
    "required": false,
    "content": { "min": 5, "max": 40 }
  }
}
```

Template pattern:
```handlebars
<h2>
  {{#if properties.title_prefix}}
    <span class="fw-normal">{{properties.title_prefix}}</span>
  {{/if}}
  <span class="fw-semibold text-primary">{{properties.title}}</span>
</h2>
```

---

## CTA Button

Used for primary and secondary call-to-action buttons.

```js
"primary": {
  "name": "Primary CTA",
  "description": "Primary call-to-action button.",
  "type": "button",
  "default": {
    "label": "Primary CTA",
    "url": "https://ssctech.com",
    "target": "_self",
    "rel": "noopener"
  },
  "rules": {
    "required": false,
    "content": { "min": 5, "max": 25 }
  }
},
"secondary": {
  "name": "Secondary CTA",
  "description": "Secondary call-to-action button.",
  "type": "button",
  "default": {
    "label": "Secondary CTA",
    "url": "https://ssctech.com"
  },
  "rules": {
    "required": false,
    "content": { "min": 5, "max": 25 }
  }
}
```

Template pattern:
```handlebars
{{#if properties.primary}}
  <a href="{{properties.primary.url}}" class="btn btn-primary"
     target="{{properties.primary.target}}">
    {{properties.primary.label}}
  </a>
{{/if}}
{{#if properties.secondary}}
  <a href="{{properties.secondary.url}}" class="btn btn-outline-primary ms-3">
    {{properties.secondary.label}}
  </a>
{{/if}}
```

---

## Image Field

Standard image with dimension rules for quality enforcement.

```js
"image": {
  "name": "Image",
  "description": "Primary image for the component.",
  "type": "image",
  "default": {
    "src": "https://placehold.co/800x600",
    "alt": "Placeholder image"
  },
  "rules": {
    "required": false,
    "dimensions": {
      "min": { "width": 600, "height": 400 },
      "max": { "width": 2700, "height": 1920 },
      "recommend": { "width": 1340, "height": 860 }
    },
    "filesize": 1000000
  }
}
```

Template pattern:
```handlebars
{{#if properties.image}}
  <img src="{{properties.image.src}}" alt="{{properties.image.alt}}"
       class="img-fluid" loading="lazy">
{{/if}}
```

---

## Background Image

For hero/banner background images that need larger dimensions.

```js
"backgroundImage": {
  "name": "Background Image",
  "description": "Full-width background image.",
  "type": "image",
  "default": {
    "src": "https://placehold.co/1920x1080",
    "alt": "Background"
  },
  "rules": {
    "required": false,
    "dimensions": {
      "min": { "width": 1200, "height": 600 },
      "max": { "width": 4200, "height": 2100 },
      "recommend": { "width": 3600, "height": 1800 }
    },
    "filesize": 1000000
  }
}
```

---

## Link Field

For text links (not buttons).

```js
"link": {
  "name": "Link",
  "description": "Text link with label and URL.",
  "type": "link",
  "default": {
    "text": "Learn More",
    "href": "#",
    "target": "_self"
  },
  "rules": {
    "required": false
  }
}
```

Template pattern:
```handlebars
{{#if properties.link}}
  <a href="{{properties.link.href}}" target="{{properties.link.target}}"
     class="text-primary fw-semibold text-decoration-none">
    {{properties.link.text}}
  </a>
{{/if}}
```

---

## Dark Mode Toggle

Boolean toggle that switches a component to dark/light theme.

```js
"dark": {
  "name": "Dark Theme",
  "description": "Switches the component to dark background with light text.",
  "type": "boolean",
  "default": false,
  "rules": {
    "required": false
  }
}
```

Template pattern:
```handlebars
<section class="py-5 {{#if properties.dark}}bg-dark text-white{{else}}bg-white{{/if}}">
```

---

## Paragraph / Lead Text

```js
"paragraph": {
  "name": "Paragraph",
  "description": "Supporting body text.",
  "type": "text",
  "default": "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "rules": {
    "required": false,
    "content": { "min": 25, "max": 1000 }
  }
}
```

---

## Breadcrumb Array

Reusable breadcrumb navigation pattern.

```js
"breadcrumb": {
  "name": "Breadcrumb",
  "description": "Breadcrumb navigation links.",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "link": {
        "name": "Link",
        "description": "Breadcrumb link.",
        "type": "link",
        "default": { "text": "Page", "href": "/" },
        "rules": { "required": true }
      },
      "active": {
        "name": "Active",
        "description": "Whether this is the current page.",
        "type": "boolean",
        "default": false,
        "rules": { "required": false }
      }
    }
  },
  "rules": {
    "required": false,
    "content": { "min": 0, "max": 4 }
  }
}
```

---

## Items Array (generic repeating content)

Pattern for any repeating set of cards, features, or list items.

```js
"items": {
  "name": "Items",
  "description": "Array of content items.",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "title": {
        "name": "Title",
        "description": "Item heading.",
        "type": "text",
        "default": "Item Title",
        "rules": { "required": true, "content": { "min": 1, "max": 100 } }
      },
      "paragraph": {
        "name": "Paragraph",
        "description": "Item description.",
        "type": "text",
        "default": "Lorem ipsum dolor sit amet.",
        "rules": { "required": false, "content": { "min": 10, "max": 500 } }
      },
      "image": {
        "name": "Image",
        "description": "Item image.",
        "type": "image",
        "default": { "src": "https://placehold.co/400x300", "alt": "Item" },
        "rules": { "required": false }
      },
      "link": {
        "name": "Link",
        "description": "Item link.",
        "type": "link",
        "default": { "text": "Learn More", "href": "#" },
        "rules": { "required": false }
      }
    }
  },
  "rules": {
    "required": true,
    "content": { "min": 1, "max": 6 }
  }
}
```

---

## Icon Item (for icon-driven grids)

```js
"items": {
  "name": "Icon Items",
  "description": "Array of items with icons.",
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "icon": {
        "name": "Icon",
        "description": "Font Awesome icon HTML.",
        "type": "icon",
        "default": "<i class=\"fa-regular fa-file\"></i>",
        "rules": { "required": false, "content": { "min": 0, "max": 500 } }
      },
      "title": {
        "name": "Title",
        "description": "Item heading.",
        "type": "text",
        "default": "Feature",
        "rules": { "required": true, "content": { "min": 1, "max": 100 } }
      },
      "paragraph": {
        "name": "Description",
        "description": "Item body text.",
        "type": "text",
        "default": "Lorem ipsum dolor sit amet.",
        "rules": { "required": false, "content": { "min": 10, "max": 500 } }
      }
    }
  },
  "rules": {
    "required": true,
    "content": { "min": 1, "max": 6 }
  }
}
```

---

## Video Embed

```js
"video": {
  "name": "Video",
  "description": "Embedded video (YouTube or Vimeo URL).",
  "type": "video_embed",
  "default": {
    "url": "",
    "title": ""
  },
  "rules": {
    "required": false
  }
}
```

---

## Show/Hide Toggle

For toggling optional sections of a component.

```js
"show_header": {
  "name": "Show Header",
  "description": "Toggle the section header visibility.",
  "type": "boolean",
  "default": true,
  "rules": {
    "required": false
  }
}
```
