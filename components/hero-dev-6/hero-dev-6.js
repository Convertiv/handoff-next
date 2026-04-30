/** @type {import('handoff-app').Component} */
module.exports = {
  "id": "hero-dev-6",
  "title": "Hero with Image and CTA",
  "description": "A hero section featuring a main heading, subheading, paragraph text, and call-to-action buttons, accompanied by an image.",
  "group": "Combos",
  "image": "",
  "type": "block",
  "renderer": "handlebars",
  "categories": [],
  "tags": [],
  "should_do": [],
  "should_not_do": [],
  "previews": {
    "generic": {
      "title": "Generic Hero Section",
      "values": {
        "background_image": "https://example.com/image.jpg",
        "subheading": "Previous / Current",
        "main_heading": "Main heading longer example.",
        "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut scelerisque scelerisque mattis. Phasellus blandit dignissim imperdiet. Cras nec tincidunt urna. Duis nec pretium diam, ac rhoncus turpis.",
        "primary_cta": "Primary CTA",
        "secondary_cta": "Secondary CTA"
      },
      "url": ""
    },
    "design": {
      "title": "Design Hero Section",
      "values": {
        "background_image": "https://example.com/image.jpg",
        "subheading": "PREVIOUS / CURRENT",
        "main_heading": "Main heading longer example.",
        "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut scelerisque scelerisque mattis. Phasellus blandit dignissim imperdiet. Cras nec tincidunt urna. Duis nec pretium diam, ac rhoncus turpis.",
        "primary_cta": "Primary CTA",
        "secondary_cta": "Secondary CTA"
      },
      "url": ""
    }
  },
  "properties": {
    "background_image": {
      "name": "background_image",
      "description": "Background image URL.",
      "type": "image",
      "default": "",
      "rules": {}
    },
    "subheading": {
      "name": "subheading",
      "description": "Text displayed above the main heading.",
      "type": "text",
      "default": "",
      "rules": {}
    },
    "main_heading": {
      "name": "main_heading",
      "description": "Main heading of the hero section.",
      "type": "text",
      "default": "",
      "rules": {}
    },
    "paragraph": {
      "name": "paragraph",
      "description": "Paragraph text in the hero section.",
      "type": "richtext",
      "default": "",
      "rules": {}
    },
    "primary_cta": {
      "name": "primary_cta",
      "description": "Label for the primary call-to-action button.",
      "type": "text",
      "default": "",
      "rules": {}
    },
    "secondary_cta": {
      "name": "secondary_cta",
      "description": "Label for the secondary call-to-action button.",
      "type": "text",
      "default": "",
      "rules": {}
    }
  },
  "entries": {
    "template": "./template.hbs",
    "scss": "./style.scss",
    "js": "./script.js"
  }
};
