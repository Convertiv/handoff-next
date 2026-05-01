/** @type {import('handoff-app').Component} */
module.exports = {
  "title": "Hero Split",
  "description": "This is a hero block that can be used to highlight important content. You can use it on landing pages, or at the top of content pages to give context. This hero contains a title, subtitle, and a call to action button.",
  "image": "/images/components/hero_split.png",
  "figma": "https://www.figma.com/design/0gKWw8gYChpItKWzh8o23N/SS%26C-Design-System?node-id=2482-2019&t=VCpakU0L55d1VpPw-4",
  "type": "block",
  "group": "Combos",
  "categories": [
    "design"
  ],
  "tags": [
    "hero"
  ],
  "should_do": [
    "Keep the subititle copy short.",
    "Try to stagger the length of the Title, if possible, with the 2nd line being a bit longer.",
    "If displaying two CTA buttons, use the secondary style for the 2nd button."
  ],
  "should_not_do": [
    "Ensure you have a high quality image or video in the background.",
    "Make sure you use at least the primary CTA button."
  ],
  "id": "hero_split",
  "entries": {
    "scss": "./style.scss",
    "template": "./template.hbs"
  },
  "previews": {
    "generic": {
      "title": "Generic",
      "values": {
        "title_prefix": "Main heading",
        "title": "longer example.",
        "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut scelerisque scelerisque mattis. Phasellus blandit dignissim imperdiet. Cras nec tincidunt urna. Duis nec pretium diam, ac rhoncus turpis.",
        "backgroundImage": false,
        "backgroundVideo": "",
        "image": {
          "src": "/images/content/demo-wide.jpg",
          "alt": "Image Alt"
        },
        "image_stretch": true,
        "primary": {
          "label": "Primary CTA",
          "url": "https://ssctech.com"
        },
        "secondary": {
          "label": "Secondary CTA",
          "url": "https://ssctech.com"
        },
        "section": "Section Header",
        "badge": "Badge Sample"
      }
    },
    "ssc": {
      "title": "SSC Homepage",
      "values": {
        "title_prefix": "Invest in Your",
        "title": "Operations",
        "paragraph": "Partner with SS&C – the leader in investment operations. Unmatched technology, service and expertise. Every business. Every portfolio. Every strategy. Every asset class. ",
        "backgroundImage": {
          "src": "https://1689245.fs1.hubspotusercontent-na1.net/hubfs/1689245/website/uds/hero/hero-homepage-v2-3000x1080.jpg",
          "alt": "Image Alt"
        },
        "backgroundVideo": "",
        "image": false,
        "image_stretch": true,
        "primary": {
          "label": "Primary CTA",
          "url": "https://ssctech.com"
        },
        "secondary": false,
        "section": false
      }
    },
    "intralinks": {
      "title": "Intralinks C002a",
      "values": {
        "title_prefix": "The power of",
        "title": "one.",
        "paragraph": "Give investors a seamless experience where they can see across fund managers using the most widely adopted fund reporting platform.",
        "backgroundImage": {
          "src": "https://www.intralinks.com/sites/default/files/styles/original/public/2024-04/fund-center-banner-bg.png.webp?itok=_zkfJy4K",
          "alt": "A ribbon"
        },
        "backgroundVideo": false,
        "image": {
          "src": "https://www.intralinks.com/sites/default/files/styles/original/public/2024-04/Frame%201073714271_0.png.webp?itok=TZolZZVG",
          "alt": "Image Alt"
        },
        "primary": {
          "label": "Get Started",
          "url": "/"
        },
        "secondary": {
          "label": "Download Fact Sheet",
          "url": "/"
        },
        "breadcrumb": false
      }
    },
    "intralinks_c002b": {
      "title": "Intralinks C002b",
      "values": {
        "title_prefix": "InvestorVision™ transforms",
        "title": "the way you share fund data.",
        "paragraph": "In a competitive landscape, LPs expect the highest level of transparency from GPs. SS&C Intralinks is revolutionizing the way fund managers deliver reports and manage investor relationships with InvestorVision, our fast, intuitive fund reporting solution.",
        "backgroundImage": false,
        "backgroundVideo": "https://www.intralinks.com/sites/default/files/videos/Inner_1_nobg.mp4",
        "image": {
          "src": "https://www.intralinks.com/sites/default/files/styles/original/public/images/05-Sprint_4-VDRPro-Hero_0.png.webp?itok=LbSVPc3r",
          "alt": "Image Alt"
        },
        "primary": {
          "label": "Schedule a Demo",
          "url": "/"
        },
        "secondary": {
          "label": "Download Fact Sheet",
          "url": "/"
        },
        "breadcrumb": [
          {
            "link": {
              "text": "Fundcenter",
              "href": "/"
            },
            "active": true
          },
          {
            "link": {
              "text": "InvestorVision",
              "href": "/"
            },
            "active": false
          }
        ]
      }
    },
    "dark": {
      "title": "Generic Dark",
      "values": {
        "dark": true,
        "title_prefix": "Main heading",
        "title": "longer example.",
        "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut scelerisque scelerisque mattis. Phasellus blandit dignissim imperdiet. Cras nec tincidunt urna. Duis nec pretium diam, ac rhoncus turpis.",
        "backgroundImage": {
          "src": "https://picsum.photos/id/33/1000/1000?grayscale&blur=2",
          "alt": "Image Alt"
        },
        "backgroundVideo": "",
        "image": {
          "src": "https://placehold.co/1340x860",
          "alt": "Image Alt"
        },
        "primary": {
          "label": "Primary CTA",
          "url": "https://ssctech.com"
        },
        "secondary": {
          "label": "Secondary CTA",
          "url": "https://ssctech.com"
        },
        "breadcrumb": [
          {
            "link": {
              "text": "Previous",
              "href": "https://ssctech.com"
            },
            "active": true
          },
          {
            "link": {
              "text": "Current",
              "href": "https://ssctech.com"
            },
            "active": false
          }
        ]
      }
    },
    "links": {
      "title": "Links",
      "values": {
        "dark": true,
        "title_prefix": "Main heading",
        "title": "longer example.",
        "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent pharetra, ex eu fringilla scelerisque, massa justo dapibus quam, in ultricies mi tellus non augue.",
        "backgroundImage": false,
        "backgroundVideo": "",
        "links": true,
        "primary": {
          "label": "Primary CTA",
          "url": "https://ssctech.com"
        },
        "secondary": {
          "label": "Secondary CTA",
          "url": "https://ssctech.com"
        },
        "breadcrumb": false,
        "linksItems": [
          {
            "title": "Solution Name Example",
            "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. dignissim imperdiet. Cras nec tincidunt urna ac rhoncus turpis.",
            "cardLink": {
              "text": "View Solution",
              "href": "#"
            }
          },
          {
            "title": "Solution Name Example",
            "paragraph": "Cras nec tincidunt urna. Duis nec pretium diam, ac rhoncus turpis.",
            "cardLink": {
              "text": "View Solution",
              "href": "#"
            }
          },
          {
            "title": "Solution Name Example",
            "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut scelerisque scelerisque mattis.",
            "cardLink": {
              "text": "View Solution",
              "href": "#"
            }
          }
        ]
      }
    },
    "simple": {
      "title": "Simple Block",
      "values": {
        "section": "Section Header",
        "title_prefix": "Main heading",
        "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut scelerisque scelerisque mattis. Phasellus blandit dignissim imperdiet. Cras nec tincidunt urna. Duis nec pretium diam, ac rhoncus turpis."
      }
    },
    "simple_background": {
      "title": "Simple Block with Background (dark)",
      "values": {
        "dark": true,
        "section": "Section Header",
        "title_prefix": "Main heading",
        "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut scelerisque scelerisque mattis. Phasellus blandit dignissim imperdiet. Cras nec tincidunt urna. Duis nec pretium diam, ac rhoncus turpis.",
        "backgroundImage": {
          "src": "https://picsum.photos/id/33/1000/1000?grayscale&blur=2",
          "alt": "Image Alt"
        }
      }
    },
    "generic_breadcrumb": {
      "title": "Generic with Breadcrumb",
      "values": {
        "title_prefix": "Main heading",
        "title": "longer example.",
        "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut scelerisque scelerisque mattis. Phasellus blandit dignissim imperdiet. Cras nec tincidunt urna. Duis nec pretium diam, ac rhoncus turpis.",
        "backgroundImage": false,
        "backgroundVideo": "",
        "image": {
          "src": "https://placehold.co/1340x860",
          "alt": "Image Alt"
        },
        "primary": {
          "label": "Primary CTA",
          "url": "https://ssctech.com"
        },
        "secondary": {
          "label": "Secondary CTA",
          "url": "https://ssctech.com"
        },
        "breadcrumb": [
          {
            "link": {
              "text": "Previous",
              "href": "https://ssctech.com"
            },
            "active": true
          },
          {
            "link": {
              "text": "Current"
            },
            "active": false
          }
        ]
      }
    },
    "video": {
      "title": "Generic with Video",
      "values": {
        "title_prefix": "Main heading",
        "title": "longer example.",
        "paragraph": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut scelerisque scelerisque mattis. Phasellus blandit dignissim imperdiet. Cras nec tincidunt urna. Duis nec pretium diam, ac rhoncus turpis.",
        "backgroundImage": false,
        "backgroundVideo": "",
        "video": {
          "url": "https://www.youtube.com/embed/6v2L2UGZJAM?si=eekxcRXcJhuCyits",
          "title": "Video Title"
        },
        "image_stretch": true,
        "primary": {
          "label": "Primary CTA",
          "url": "https://ssctech.com"
        },
        "secondary": {
          "label": "Secondary CTA",
          "url": "https://ssctech.com"
        },
        "section": "Section Header"
      }
    }
  },
  "properties": {
    "dark": {
      "name": "Dark Theme",
      "description": "This will make the text white and the background dark.",
      "type": "boolean",
      "default": false,
      "rules": {
        "required": false
      }
    },
    "breadcrumb": {
      "name": "Breadcrumb",
      "type": "array",
      "description": "This is the breadcrumb that will appear at the top of the page above the title. Its an array of breadcrumb items (label, url, active).",
      "items": {
        "type": "object",
        "properties": {
          "link": {
            "name": "Link",
            "description": "This is the link that will appear in the breadcrumb.",
            "type": "link",
            "default": {
              "text": "Previous",
              "href": "https://ssctech.com"
            },
            "rules": {
              "required": false,
              "content": {
                "min": 1,
                "max": 1000
              }
            }
          },
          "active": {
            "name": "Active Class",
            "description": "This field should be active/null",
            "type": "boolean",
            "default": false,
            "rules": {
              "required": false
            }
          }
        }
      },
      "rules": {
        "required": false,
        "content": {
          "min": 0,
          "max": 4
        }
      }
    },
    "title_prefix": {
      "name": "Title Prefix",
      "description": "This is the first part of the top level heading.  You should insert a short phrase or single word here. If you leave this out, the title will start with the bolded words.",
      "type": "text",
      "default": "Main heading",
      "rules": {
        "required": false,
        "content": {
          "min": 5,
          "max": 15
        },
        "pattern": "^[a-zA-Z0-9 ]+$"
      }
    },
    "title": {
      "name": "Title",
      "description": "The second part of the title string, a set of bolded words.",
      "type": "text",
      "default": "longer example.",
      "rules": {
        "required": false,
        "content": {
          "min": 10,
          "max": 15
        },
        "pattern": "^[a-zA-Z0-9 ]+$"
      }
    },
    "section": {
      "name": "Section",
      "description": "This can be used in place of the breadcrumb, for a simple section header",
      "type": "text",
      "default": "Section",
      "rules": {
        "required": false,
        "content": {
          "min": 10,
          "max": 15
        },
        "pattern": "^[a-zA-Z0-9 ]+$"
      }
    },
    "badge": {
      "name": "Badge",
      "description": "This is the badge that will appear in the top right of the hero split.",
      "type": "text",
      "default": "",
      "rules": {
        "required": false,
        "content": {
          "min": 5,
          "max": 25
        }
      }
    },
    "paragraph": {
      "name": "Lead Text",
      "type": "text",
      "description": "This is the callout, several lines long. Use this to provide context.",
      "default": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Praesent pharetra, ex eu fringilla scelerisque, massa justo dapibus quam, in ultricies mi tellus non augue.",
      "rules": {
        "required": true,
        "content": {
          "min": 50,
          "max": 1000
        },
        "pattern": "^[a-zA-Z0-9 ]+$"
      }
    },
    "primary": {
      "name": "Primary CTA",
      "type": "button",
      "description": "This is the text that will appear on the primary Call to Action button. It should be a short phrase or single word.",
      "default": {
        "label": "Primary CTA",
        "url": "https://ssctech.com",
        "target": "_self",
        "rel": "noopener"
      },
      "rules": {
        "required": false,
        "content": {
          "min": 5,
          "max": 25
        },
        "pattern": "^[a-zA-Z0-9 ]+$"
      }
    },
    "secondary": {
      "name": "Secondary CTA",
      "type": "button",
      "description": "This is the text that will appear on the secondary Call to Action button. It should be a short phrase or single word.",
      "default": {
        "label": "Secondary CTA",
        "url": "https://ssctech.com"
      },
      "rules": {
        "required": false,
        "content": {
          "min": 5,
          "max": 25
        },
        "pattern": "^[a-zA-Z0-9 ]+$"
      }
    },
    "backgroundVideo": {
      "name": "Background Video",
      "description": "This is the background video that will appear behind the text. It should be a high quality image or video that is relevant to the content.",
      "type": "video_file",
      "default": "",
      "rules": {
        "required": false,
        "dimensions": {
          "min": {
            "width": 600,
            "height": 600
          },
          "max": {
            "width": 1920,
            "height": 1080
          },
          "recommend": {
            "width": 1340,
            "height": 860
          }
        },
        "filesize": 1000000
      }
    },
    "backgroundImage": {
      "name": "Background Image",
      "description": "This is the background image that will appear behind the text. It should be a high quality image or video that is relevant to the content.",
      "type": "image",
      "default": {
        "src": "https://placehold.co/800",
        "alt": "Placeholder image"
      },
      "rules": {
        "required": false,
        "dimensions": {
          "min": {
              "width": 1200,
              "height": 600
            },
            "max": {
              "width": 4200,
              "height": 2100
            },
            "recommend": {
              "width": 3600,
              "height": 1800
            }
        },
        "filesize": 1000000
      }
    },
    "image": {
      "name": "Image",
      "description": "A large image on the right of the block",
      "type": "image",
      "rules": {
        "required": false,
        "dimensions": {
          "min": {
            "width": 1350,
            "height": 860
          },
          "max": {
            "width": 2700,
            "height": 1920
          }
        }
      },
      "default": {
        "src": "https://placehold.co/1340x860",
        "alt": "Image Alt"
      }
    },
    "video": {
      "name": "Video",
      "description": "This is the video that will appear in the hero split. It should be a high quality video that is relevant to the content.",
      "type": "video_embed",
      "default": {
        "url": "",
        "title": ""
      },
      "rules": {
        "required": false
      }
    },
    "image_stretch": {
      "name": "Stretch Image",
      "description": "This will stretch the image all the way to the right hand of the page. Ensure your image is sized properly.",
      "type": "boolean",
      "default": false,
      "rules": {
        "required": false
      }
    },
    "links": {
      "name": "Links",
      "description": "This will display a list of links in the right column. Each link has a title and a link.",
      "type": "boolean",
      "default": false,
      "rules": {
        "required": false
      }
    },
    "linksItems": {
      "name": "Link Cards",
      "description": "Array of link cards to display in the right column. Each card has a title and a link.",
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "title": {
            "name": "Card Title",
            "description": "The title of the solution card",
            "type": "text",
            "default": "Solution Name Example",
            "rules": {
              "required": true,
              "content": {
                "min": 1,
                "max": 20
              }
            }
          },
          "paragraph": {
            "name": "Card Paragraph",
            "description": "The paragraph of the card",
            "type": "text",
            "default": "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Ut scelerisque scelerisque mattis. Phasellus blandit dignissim imperdiet. Cras nec tincidunt urna. Duis nec pretium diam, ac rhoncus turpis.",
            "rules": {
              "required": false,
              "content": {
                "min": 10,
                "max": 150
              }
            }
          },
          "cardLink": {
            "name": "Card Link",
            "description": "The link for the card",
            "type": "link",
            "default": {
              "text": "View Solution",
              "href": "#",
              "target": "_self"
            },
            "rules": {
              "required": true
            }
          }
        }
      },
      "rules": {
        "required": false,
        "content": {
          "min": 0,
          "max": 3
        }
      }
    }
  }
};
