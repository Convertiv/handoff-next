/** @type {import('handoff-app').Component} */
module.exports = {
  "id": "hero-dev-6",
  "title": "Hero with AI Solutions",
  "description": "A hero section showcasing AI solutions with call-to-action buttons.",
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
        "title": "Innovate with AI",
        "subtitle": "Explore the future of technology.",
        "primaryCTA": "Get Started",
        "secondaryCTA": "Learn More",
        "backgroundImage": {
          "src": "path/to/generic/background.jpg"
        },
        "compositionImage": {
          "src": "path/to/generic/composition.jpg"
        }
      },
      "url": ""
    },
    "design": {
      "title": "Design Preview",
      "values": {
        "title": "Leading the way with AI solutions",
        "subtitle": "SS&C is innovating on back of house financial technology.",
        "primaryCTA": "Primary CTA",
        "secondaryCTA": "Secondary CTA",
        "backgroundImage": {
          "src": "/api/component/hero-dev-6-asset-0.png"
        },
        "compositionImage": {
          "src": "/api/component/hero-dev-6-asset-1.png"
        }
      },
      "url": ""
    }
  },
  "properties": {
    "title": {
      "name": "title",
      "description": "Main headline for the hero section.",
      "type": "text",
      "default": "Leading the way with AI solutions",
      "rules": {}
    },
    "subtitle": {
      "name": "subtitle",
      "description": "Subheading text for additional context.",
      "type": "text",
      "default": "SS&C is innovating on back of house financial technology.",
      "rules": {}
    },
    "primaryCTA": {
      "name": "primaryCTA",
      "description": "Label for the primary call-to-action button.",
      "type": "text",
      "default": "Primary CTA",
      "rules": {}
    },
    "secondaryCTA": {
      "name": "secondaryCTA",
      "description": "Label for the secondary call-to-action button.",
      "type": "text",
      "default": "Secondary CTA",
      "rules": {}
    },
    "backgroundImage": {
      "name": "backgroundImage",
      "description": "Background image for the hero section.",
      "type": "image",
      "default": null,
      "rules": {}
    },
    "compositionImage": {
      "name": "compositionImage",
      "description": "Image to illustrate the composition elements.",
      "type": "image",
      "default": null,
      "rules": {}
    }
  },
  "entries": {
    "template": "./template.hbs",
    "scss": "./style.scss",
    "js": "./script.js"
  }
};
