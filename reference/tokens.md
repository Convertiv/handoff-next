# SS&C Design Tokens

Machine-readable registry of all CSS custom properties exported from Figma.
Source files: `handoff/integration/sass/exported/tokens/css/`

---

## Brand Colours (`colors.css`)

### Primary

| Token | Value |
|---|---|
| `--color-primary-ssc-blue` | `#0077c8` |
| `--color-primary-cobalt` | `#0b4d99` |
| `--color-primary-navy` | `#131e58` |

### Secondary

| Token | Value |
|---|---|
| `--color-secondary-teal` | `#1099ac` |
| `--color-secondary-dark-teal` | `#076775` |
| `--color-secondary-dark-gray` | `#344157` |

### Accent

| Token | Value |
|---|---|
| `--color-accent-yellow` | `#f5ab0a` |
| `--color-accent-gray` | `#858ea0` |

### Text

| Token | Value | Usage |
|---|---|---|
| `--color-text-hard` | `#0d1116` | Headings, high-emphasis text |
| `--color-text-base` | `#1b212d` | Body copy |
| `--color-text-soft` | `#344157` | Secondary text |
| `--color-text-muted` | `#5d6779` | Captions, labels |

### Primitive Scales

Each scale runs from 100 (lightest) to 900 (darkest).

**SSC Blue** (`--color-primitive-ssc-blue-{n}`)
| 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|
| `#e5f1f9` | `#cce4f4` | `#99c9e9` | `#66adde` | `#3392d3` | `#0077c8` | `#005f9e` | `#00497a` | `#003152` |

**Cobalt** (`--color-primitive-cobalt-{n}`)
| 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|
| `#e7edf5` | `#cedbeb` | `#9db8d6` | `#6d94c2` | `#3c71ad` | `#0b4d99` | `#093e7c` | `#07305f` | `#052243` |

**Teal** (`--color-primitive-teal-{n}`)
| 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|
| `#e7f5f7` | `#cfebee` | `#9fd6de` | `#70c2cd` | `#40adbd` | `#1099ac` | `#0d7d8c` | `#0a5c67` | `#073f46` |

**Dark Teal** (`--color-primitive-dark-teal-{n}`)
| 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|
| `#e6f0f1` | `#cde1e3` | `#9cc2c8` | `#6aa4ac` | `#398691` | `#076775` | `#065460` | `#05434d` | `#03333a` |

**Navy** (`--color-primitive-navy-{n}`)
| 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|
| `#e7e8ee` | `#d0d2de` | `#a1a5bc` | `#71789b` | `#424b79` | `#131e58` | `#101a4c` | `#0e163f` | `#0a102e` |

**Gray** (`--color-primitive-gray-{n}`)
| 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|
| `#f3f4f5` | `#e7e8ec` | `#ced2d9` | `#b6bbc6` | `#9da5b3` | `#858ea0` | `#60697b` | `#414753` | `#1f2228` |

**Dark Gray** (`--color-primitive-dark-gray-{n}`)
| 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|
| `#ebecee` | `#d6d9dd` | `#aeb3bc` | `#858d9a` | `#5d6779` | `#344157` | `#263040` | `#1b212d` | `#0d1116` |

**Yellow** (`--color-primitive-yellow-{n}`)
| 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 |
|---|---|---|---|---|---|---|---|---|
| `#fef7e6` | `#fdeece` | `#fbdd9d` | `#f9cd6c` | `#f7bc3b` | `#f5ab0a` | `#ba8208` | `#7b5505` | `#402c03` |

### Gradients

| Token | Value |
|---|---|
| `--color--light-gradient` | `linear-gradient(90deg, rgba(255,255,255) 32%, rgba(178,214,238) 100%)` |
| `--color--gradient-2` | `linear-gradient(180deg, rgba(38,66,132) 0%, rgba(0,119,200) 100%)` |

---

## Typography (`typography.css`)

### Font Family

| Token | Value |
|---|---|
| `--font-family-barlow` | `'Barlow'` |

### Headings

| Token | Size | Weight | Line Height | Letter Spacing |
|---|---|---|---|---|
| `--typography-heading-1-*` | 76px | 400 | 1.1 | -3.8px |
| `--typography-heading-2-*` | 60px | 500 | 1.1 | -1.8px |
| `--typography-heading-3-*` | 50px | 400 | 1.1 | -1.5px |
| `--typography-heading-4-*` | 42px | 400 | 1.1 | -1.26px |
| `--typography-heading-5-*` | 36px | 400 | 1.1 | -1.08px |
| `--typography-heading-6-*` | 28px | 400 | 1.2 | -0.56px |
| `--typography-heading-7-*` | 20px | 500 | 1.2 | -0.4px |

### Paragraphs

| Token | Size | Weight | Line Height |
|---|---|---|---|
| `--typography-paragraph-xs-*` | 14px | 400 | 1.6 |
| `--typography-paragraph-sm-*` | 16px | 400 | 1.6 |
| `--typography-paragraph-base-*` | 18px | 400 | 1.6 |
| `--typography-paragraph-lg-*` | 20px | 400 | 1.6 |
| `--typography-paragraph-xl-*` | 24px | 400 | 1.6 |

### Subheading

| Token | Size | Weight | Line Height | Letter Spacing |
|---|---|---|---|---|
| `--typography-subheading-*` | 16px | 400 | 1.2 | 0.16px |

---

## Effects (`effects.css`)

| Token | Value | Usage |
|---|---|---|
| `--effect--shadow-100` | `0px 12px 25px rgba(0, 0, 0, .1)` | Card shadows |

---

## Mapping guide

When you encounter a hex value in Figma or reference code, use this lookup:

| Hex | Token |
|---|---|
| `#0077c8` | `--color-primary-ssc-blue` |
| `#0b4d99` | `--color-primary-cobalt` |
| `#131e58` | `--color-primary-navy` |
| `#1099ac` | `--color-secondary-teal` |
| `#076775` | `--color-secondary-dark-teal` |
| `#344157` | `--color-secondary-dark-gray` |
| `#f5ab0a` | `--color-accent-yellow` |
| `#858ea0` | `--color-accent-gray` |
| `#0d1116` | `--color-text-hard` |
| `#1b212d` | `--color-text-base` |
| `#344157` | `--color-text-soft` |
| `#5d6779` | `--color-text-muted` |
| `#f3f4f5` | `--color-primitive-gray-100` |
| `#e7e8ec` | `--color-primitive-gray-200` |
| `#e5f1f9` | `--color-primitive-ssc-blue-100` |
