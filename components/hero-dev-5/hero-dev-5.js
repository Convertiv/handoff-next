/** @type {import('handoff-app').Component} */
module.exports = {
  "id": "hero-dev-5",
  "title": "Hero Development Component",
  "description": "A hero section with a headline, subheadline, CTAs, and an image.",
  "group": "hero",
  "image": "",
  "type": "block",
  "renderer": "handlebars",
  "categories": [],
  "tags": [],
  "should_do": [],
  "should_not_do": [],
  "previews": {
    "generic": {
      "title": "Generic Preview",
      "values": {
        "headline": "Your Headline Here",
        "subheadline": "Your subheadline goes here.",
        "primaryCTA": "Get Started",
        "secondaryCTA": "Learn More"
      },
      "url": ""
    },
    "design": {
      "title": "Design Preview",
      "values": {
        "headline": "Leading the way with AI solutions",
        "subheadline": "SS&C is innovating on back of house financial technology.",
        "primaryCTA": "Primary CTA",
        "secondaryCTA": "Secondary CTA"
      },
      "url": ""
    }
  },
  "properties": {
    "headline": {
      "name": "Headline",
      "description": "Main headline text",
      "type": "string",
      "default": "Leading the way with AI solutions",
      "rules": "required"
    },
    "subheadline": {
      "name": "Subheadline",
      "description": "Secondary headline text",
      "type": "string",
      "default": "SS&C is innovating on back of house financial technology.",
      "rules": "required"
    },
    "primaryCTA": {
      "name": "Primary CTA",
      "description": "Text for the primary call-to-action button",
      "type": "string",
      "default": "Primary CTA",
      "rules": "required"
    },
    "secondaryCTA": {
      "name": "Secondary CTA",
      "description": "Text for the secondary call-to-action button",
      "type": "string",
      "default": "Secondary CTA",
      "rules": "required"
    }
  },
  "entries": {
    "template": "./template.hbs",
    "scss": "./style.scss",
    "js": "./script.js"
  }
};
