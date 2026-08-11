# SS&C content-length survey and applied rationalization

_Generated 2026-08-11 by `scripts/apply-content-length-plan.ts`
(plan: `src/app/lib/content-length-plan.ts`). Proposal only — nothing written.
Re-run:_

```
npm run contracts:lengths -- --workspace <handoff dir> --report <path>
```

**83 components · 614 fields · 420 declare a length rule.**

> Computed from the `ssc-handoff-next` contracts **as they stood before the change**, so it records the redline rather than the current state — every action reads as a proposal. It was applied on 2026-08-11 and pushed to the beta registry, 83/83 components; see `F.-1b`–`F.-1e` in `docs/WORKBENCH-PLAYGROUND-ROADMAP.md` for the outcome.

## Summary

| action | fields | meaning |
|---|---:|---|
| `remove-rule` | 50 | a length rule on a reference — URL, icon, composite type, or config |
| `not-a-length` | 78 | a row count or a numeric range, not a length — left exactly as authored |
| `raise-max` | 198 | cap sits below the role floor, or below what the component already ships |
| `drop-min` | 81 | cap is fine; the minimum is not |
| `lower-max` | 7 | cap is several times its role floor — nominal rather than real |
| `keep` | 6 | already sensible |
| `no-basis` | 0 | no role matched and no sample exists — left for a human |

- **389 of 420 fields carry a `min`.** It is never proposed on a length rule; the
  survivors are row counts and numeric ranges, where a minimum is a real constraint.
- **36 caps reject the component's own preview value.** Not judgement calls — the
  contract and the data disagree and the data is what renders.
- **26 caps sit on richtext**, where the character count includes markup rather than copy.

## Role floors

Derived from `ROLE_LIMITS` in `content-length-plan.ts` — edit there and re-run to revise.

| cap | roles | inside a repeater row |
|---:|---|---:|
| 32 | `button_label` · `buttonlabel` · `cta_label` · `link` · `link_text` · `see_less_label` · `see_more_label` | 32 |
| 40 | `badge` · `category` · `date` · `eyebrow` · `kicker` · `label` · `publication_date` · `read_time` · `search` · `super` · `title_prefix` · `title_suffix` · `type` | 40 |
| 60 | `author` · `company` · `name` · `role` | 60 |
| 64 | `anchor` · `identifier` · `slug` | 64 |
| 80 | `header` · `heading` · `headline` · `title` | 60 |
| 120 | `callout` · `copyright` · `question` | 120 |
| 160 | `subtitle` · `subtitle_muted` | 120 |
| 240 | `quote` | 240 |
| 320 | `answer` · `body` · `copy` · `description` · `excerpt` · `paragraph` · `summary` | 320 |

A proposal is never below `observed × 1.2` where the component already ships longer content, so applying it
cannot reject copy that renders today.

## Caps the component's own content already exceeds

| field | cap | its own value |
|---|---:|---:|
| `footer.paragraph` | 300 | **361** |
| `footer_stripped.paragraph` | 300 | **361** |
| `image_text_card.paragraph` | 150 | **203** |
| `parallax_cards.left_items.*.paragraph` | 300 | **353** |
| `parallax_cards.right_items.*.paragraph` | 300 | **353** |
| `image_text_card_features.paragraph` | 150 | **197** |
| `filters.items.*.paragraph` | 150 | **194** |
| `testimonial_carousel.items.*.quote` | 100 | **136** |
| `features.items.*.paragraph` | 100 | **128** |
| `tabs_vertical.items.*.paragraph` | 100 | **123** |
| `text_cta_stats.items.*.paragraph` | 100 | **123** |
| `carousel_large_auto.items.*.stats.*.paragraph` | 25 | **47** |
| `carousel_card_feature.items.*.title` | 20 | **41** |
| `icon_text_cards.title` | 30 | **49** |
| `menu.primary.*.mega.card.callout` | 25 | **43** |
| `form.form.title` | 25 | **42** |
| `pageable_image_text_cards.items.*.title` | 20 | **36** |
| `icon_text_cards.title_prefix` | 25 | **39** |
| `icon_text_cards.items.*.title` | 25 | **39** |
| `hero_split.title` | 15 | **28** |
| `carousel_large_auto.items.*.paragraph` | 120 | **132** |
| `tabs_horizontal_auto.items.*.title` | 25 | **37** |
| `hero_split.title_prefix` | 15 | **26** |
| `content_cta.title` | 25 | **35** |
| `blog_body.title_prefix` | 25 | **28** |
| `featured_posts.title_prefix` | 25 | **28** |
| `parallax_cards.title` | 25 | **28** |
| `related_posts.related_posts.*.title` | 25 | **27** |
| `features_image_split.title` | 25 | **26** |
| `form.title` | 25 | **26** |
| `heading_cta_centered.title` | 25 | **26** |
| `hero_split.linksItems.*.title` | 20 | **21** |
| `image_text_card_features.title` | 25 | **26** |
| `image_text_card_highlighted.title` | 25 | **26** |
| `tabs_horizontal_auto.title` | 25 | **26** |
| `text_cta_stats.title` | 25 | **26** |

## Every field, by component

`—` in **proposed** means the rule is removed entirely. `min` is never proposed on a length rule.

### `404` — 4 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `code` | text | min 1, max 10 | max 10 | `drop-min` | the cap of 10 is fine; the minimum of 1 is not |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `paragraph` | text | min 5, max 300 | max 320 | `raise-max` | 300 is below the floor of 320 for a paragraph |
| `button` | button | min 5, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `accordion` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 30 | max 40 | `raise-max` | 30 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 30 | max 80 | `raise-max` | 30 is below the floor of 80 for a title |
| `identifier` | text | min 5, max 35 | max 64 | `raise-max` | 35 is below the floor of 64 for a identifier |
| `items` | array | min 1, max 20 | max 20 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 45 | max 60 | `raise-max` | 45 is below the floor of 60 for a title |
| `items.*.paragraph` | richtext | min 5, max 5000 | max 5000 | `drop-min` | richtext body — the cap of 5000 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |
| `items.*.link` | link | min 5, max 100 | — | `remove-rule` | type `link` is a reference or a composite — a character count measures the wrong thing |

### `bar_chart` — 4 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 1, max 100 | max 100 | `drop-min` | the cap of 100 is fine; the minimum of 1 is not |
| `data` | array | min 1, max 100 | max 100 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `data.*.date` | text | min 1, max 100 | max 100 | `drop-min` | the cap of 100 is fine; the minimum of 1 is not |
| `data.*.value` | number | min 1, max 100 | max 100 | `not-a-length` | on a number, `content` is a value range — not this exercise's business |

### `blockquote_card` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `author` | text | min 5, max 80 | max 80 | `drop-min` | the cap of 80 is fine; the minimum of 5 is not |
| `role` | text | min 5, max 80 | max 80 | `drop-min` | the cap of 80 is fine; the minimum of 5 is not |
| `paragraph` | richtext | min 5, max 800 | max 800 | `drop-min` | richtext body — the cap of 800 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `blockquote_simple` — 2 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `callout` | text | min 5, max 80 | max 120 | `raise-max` | 80 is below the floor of 120 for a callout |
| `paragraph` | richtext | min 5, max 800 | max 800 | `drop-min` | richtext body — the cap of 800 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `blockquote_split` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `author` | text | min 5, max 80 | max 80 | `drop-min` | the cap of 80 is fine; the minimum of 5 is not |
| `role` | text | min 5, max 80 | max 80 | `drop-min` | the cap of 80 is fine; the minimum of 5 is not |
| `paragraph` | richtext | min 5, max 800 | max 800 | `drop-min` | richtext body — the cap of 800 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `blog` — 8 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `tags` | array | min 1, max 10 | max 10 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `authors` | array | min 1, max 2 | max 2 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `authors.*.author` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a author |
| `authors.*.role` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a role |
| `publication_date` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a publication_date |
| `read_time` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a read_time |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `content` | richtext | min 5, max 10000 | max 10000 | `drop-min` | richtext body — the cap of 10000 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `blog_body` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | the component's own value is 28 characters against a cap of 25 — the contract rejects what it ships |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `content` | richtext | min 5, max 10000 | max 10000 | `drop-min` | richtext body — the cap of 10000 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `blog_header` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `tags` | array | min 1, max 10 | max 10 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `authors` | array | min 1, max 2 | max 2 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `authors.*.author` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a author |
| `authors.*.role` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a role |
| `publication_date` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a publication_date |
| `read_time` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a read_time |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |

### `button` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `type` | text | min 5, max 15 | max 40 | `raise-max` | 15 is below the floor of 40 for a type |
| `label` | text | min 5, max 60 | max 60 | `drop-min` | the cap of 60 is fine; the minimum of 5 is not |
| `url` | text | min 1, max 1000 | — | `remove-rule` | url holds a URL or asset reference — a character count is not a constraint on it |

### `cards_carousel_auto` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 300 | max 300 | `drop-min` | the cap of 300 is fine; the minimum of 5 is not |
| `items` | array | min 1, max 10 | max 10 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.super` | text | min 5, max 20 | max 40 | `raise-max` | 20 is below the floor of 40 for a super |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.title_suffix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_suffix |
| `items.*.paragraph` | text | min 5, max 1000 | max 1000 | `drop-min` | the cap of 1000 is fine; the minimum of 5 is not |

### `carousel_card_feature` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `items` | array | min 3, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.super` | text | min 5, max 20 | max 40 | `raise-max` | 20 is below the floor of 40 for a super |
| `items.*.title` | text | min 5, max 20 | max 60 | `raise-max` | the component's own value is 41 characters against a cap of 20 — the contract rejects what it ships |

### `carousel_card_tabs` — 4 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 30 | max 40 | `raise-max` | 30 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 30 | max 80 | `raise-max` | 30 is below the floor of 80 for a title |
| `items` | array | min 3, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.paragraph` | richtext | min 5, max 250 | max 320 | `raise-max` | 250 is below the floor of 320 for a paragraph |

### `carousel_large_auto` — 10 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 30 | max 40 | `raise-max` | 30 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 30 | max 80 | `raise-max` | 30 is below the floor of 80 for a title |
| `items` | array | min 3, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 60 | max 60 | `drop-min` | the cap of 60 is fine; the minimum of 5 is not |
| `items.*.paragraph` | text | min 5, max 120 | max 320 | `raise-max` | the component's own value is 132 characters against a cap of 120 — the contract rejects what it ships |
| `items.*.author` | text | min 5, max 35 | max 60 | `raise-max` | 35 is below the floor of 60 for a author |
| `items.*.role` | text | min 5, max 45 | max 60 | `raise-max` | 45 is below the floor of 60 for a role |
| `items.*.stats` | array | min 3, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.stats.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.stats.*.paragraph` | text | min 5, max 25 | max 320 | `raise-max` | the component's own value is 47 characters against a cap of 25 — the contract rejects what it ships |

### `category_breakdown_chart` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 1, max 255 | max 255 | `drop-min` | the cap of 255 is fine; the minimum of 1 is not |
| `data.categories` | array | min 1, max 100 | max 100 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `data.series` | array | min 1, max 100 | max 100 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `data.series.*.label` | text | min 1, max 100 | max 100 | `drop-min` | the cap of 100 is fine; the minimum of 1 is not |
| `data.series.*.data` | array | min 1, max 100 | max 100 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `data.series.*.colorKey` | text | min 1, max 255 | max 255 | `drop-min` | the cap of 255 is fine; the minimum of 1 is not |

### `content_cta` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 25 | max 80 | `raise-max` | the component's own value is 35 characters against a cap of 25 — the contract rejects what it ships |
| `paragraph` | richtext | min 5, max 300 | max 320 | `raise-max` | 300 is below the floor of 320 for a paragraph |
| `button` | button | min 5, max 50 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `cta_list_split` — 2 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 10 | max 80 | `raise-max` | 10 is below the floor of 80 for a title |
| `paragraph` | richtext | min 5, max 250 | max 320 | `raise-max` | 250 is below the floor of 320 for a paragraph |

### `dark_hero` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 2, max 40 | max 40 | `drop-min` | the cap of 40 is fine; the minimum of 2 is not |
| `title` | text | min 2, max 40 | max 80 | `raise-max` | 40 is below the floor of 80 for a title |
| `title_suffix` | text | min 4, max 80 | max 80 | `drop-min` | the cap of 80 is fine; the minimum of 4 is not |
| `paragraph` | text | min 20, max 500 | max 500 | `drop-min` | the cap of 500 is fine; the minimum of 20 is not |
| `primary` | button | min 4, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `expanding_product_table` — 9 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `col1_label` | text | min 1, max 60 | max 60 | `drop-min` | the cap of 60 is fine; the minimum of 1 is not |
| `col2_label` | text | min 1, max 60 | max 60 | `drop-min` | the cap of 60 is fine; the minimum of 1 is not |
| `visible_rows` | number | min 1, max 20 | max 20 | `not-a-length` | on a number, `content` is a value range — not this exercise's business |
| `see_more_label` | text | min 2, max 30 | max 32 | `raise-max` | 30 is below the floor of 32 for a see_more_label |
| `see_less_label` | text | min 2, max 30 | max 32 | `raise-max` | 30 is below the floor of 32 for a see_less_label |
| `categories` | array | min 1, max 20 | max 20 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `categories.*.category` | text | min 1, max 60 | max 60 | `drop-min` | the cap of 60 is fine; the minimum of 1 is not |
| `categories.*.features` | array | min 1, max 10 | max 10 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `categories.*.features.*.description` | text | min 5, max 300 | max 320 | `raise-max` | 300 is below the floor of 320 for a description |

### `featured_posts` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | the component's own value is 28 characters against a cap of 25 — the contract rejects what it ships |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `content` | richtext | min 5, max 10000 | max 10000 | `drop-min` | richtext body — the cap of 10000 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `featured_resources` — 10 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | max 45 | max 80 | `raise-max` | 45 is below the floor of 80 for a title |
| `paragraph` | text | max 1000 | max 1000 | `keep` | 1000 already fits the paragraph and the content |
| `button` | button | max 20 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |
| `featured.title` | text | max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `featured.subtitle` | text | max 25 | max 160 | `raise-max` | 25 is below the floor of 160 for a subtitle |
| `featured.featured_link` | link | min 5, max 20 | — | `remove-rule` | type `link` is a reference or a composite — a character count measures the wrong thing |
| `items` | array | min 1, max 3 | max 3 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.subtitle` | text | max 25 | max 120 | `raise-max` | 25 is below the floor of 120 for a subtitle |
| `items.*.link` | link | min 5, max 20 | — | `remove-rule` | type `link` is a reference or a composite — a character count measures the wrong thing |

### `features` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `items` | array | min 4, max 8 | max 8 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.paragraph` | text | min 5, max 100 | max 320 | `raise-max` | the component's own value is 128 characters against a cap of 100 — the contract rejects what it ships |

### `features_image_split` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | the component's own value is 26 characters against a cap of 25 — the contract rejects what it ships |
| `paragraph` | text | min 5, max 1500 | max 320 | `lower-max` | 1500 is 5× the paragraph floor — a nominal cap rather than a real one |
| `items` | array | min 1, max 3 | max 3 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 24 | max 60 | `raise-max` | 24 is below the floor of 60 for a title |
| `items.*.paragraph` | text | min 5, max 175 | max 320 | `raise-max` | 175 is below the floor of 320 for a paragraph |

### `filters` — 13 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | max 45 | max 80 | `raise-max` | 45 is below the floor of 80 for a title |
| `paragraph` | text | max 150 | max 320 | `raise-max` | 150 is below the floor of 320 for a paragraph |
| `search` | text | max 45 | max 45 | `keep` | 45 already fits the search and the content |
| `industries` | array | min 1, max 45 | max 45 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `solutions` | array | min 1, max 45 | max 45 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `total` | number | max 999 | max 999 | `not-a-length` | on a number, `content` is a value range — not this exercise's business |
| `sort` | array | min 1, max 4 | max 4 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `sort.*.sort` | text | max 45 | max 45 | `keep` | 45 already fits the field and the content |
| `sort.*.label` | text | max 45 | max 45 | `keep` | 45 already fits the label and the content |
| `items` | array | max 8 | max 8 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | max 150 | max 150 | `keep` | 150 already fits the title and the content |
| `items.*.paragraph` | text | max 150 | max 320 | `raise-max` | the component's own value is 194 characters against a cap of 150 — the contract rejects what it ships |
| `pagination.current` | number | max 999 | max 999 | `not-a-length` | on a number, `content` is a value range — not this exercise's business |

### `flip-card-1` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 2, max 40 | max 40 | `drop-min` | the cap of 40 is fine; the minimum of 2 is not |
| `title` | text | min 2, max 40 | max 80 | `raise-max` | 40 is below the floor of 80 for a title |
| `cards` | array | min 1, max 9 | max 9 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `cards.*.question` | text | min 5, max 120 | max 120 | `drop-min` | the cap of 120 is fine; the minimum of 5 is not |
| `cards.*.answer` | text | min 10, max 500 | max 500 | `drop-min` | the cap of 500 is fine; the minimum of 10 is not |
| `cards.*.cta_label` | text | min 2, max 40 | max 40 | `drop-min` | the cap of 40 is fine; the minimum of 2 is not |

### `flip_card` — 4 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `question` | text | min 5, max 120 | max 120 | `drop-min` | the cap of 120 is fine; the minimum of 5 is not |
| `answer` | text | min 10, max 500 | max 500 | `drop-min` | the cap of 500 is fine; the minimum of 10 is not |
| `cta_label` | text | min 2, max 40 | max 40 | `drop-min` | the cap of 40 is fine; the minimum of 2 is not |
| `cta_url` | text | min 1, max 1000 | — | `remove-rule` | cta_url holds a URL or asset reference — a character count is not a constraint on it |

### `flip_card_grid` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_muted` | text | min 5, max 120 | max 120 | `drop-min` | the cap of 120 is fine; the minimum of 5 is not |
| `title_bold` | text | min 5, max 120 | max 120 | `drop-min` | the cap of 120 is fine; the minimum of 5 is not |
| `cards` | array | min 3, max 12 | max 12 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `cards.*.question` | text | min 5, max 120 | max 120 | `drop-min` | the cap of 120 is fine; the minimum of 5 is not |
| `cards.*.answer` | text | min 10, max 500 | max 500 | `drop-min` | the cap of 500 is fine; the minimum of 10 is not |
| `cards.*.cta_label` | text | min 2, max 40 | max 40 | `drop-min` | the cap of 40 is fine; the minimum of 2 is not |
| `cards.*.cta_url` | text | min 1, max 1000 | — | `remove-rule` | cards.*.cta_url holds a URL or asset reference — a character count is not a constraint on it |

### `footer` — 4 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `paragraph` | text | min 5, max 300 | max 440 | `raise-max` | the component's own value is 361 characters against a cap of 300 — the contract rejects what it ships |
| `social` | array | min 1, max 4 | max 4 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `social.*.icon` | icon | min 5, max 500 | — | `remove-rule` | type `icon` is a reference or a composite — a character count measures the wrong thing |
| `copyright` | text | min 5, max 300 | max 300 | `drop-min` | the cap of 300 is fine; the minimum of 5 is not |

### `footer_stripped` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `paragraph` | text | min 5, max 300 | max 440 | `raise-max` | the component's own value is 361 characters against a cap of 300 — the contract rejects what it ships |
| `links` | menu | min 1, max 10 | max 10 | `not-a-length` | on `menu`, `content` counts rows rather than characters — left as authored |
| `copyright` | text | min 5, max 100 | max 120 | `raise-max` | 100 is below the floor of 120 for a copyright |

### `form` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | the component's own value is 26 characters against a cap of 25 — the contract rejects what it ships |
| `paragraph` | richtext | min 5, max 3000 | max 3000 | `drop-min` | richtext body — the cap of 3000 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |
| `form.title` | text | min 5, max 25 | max 80 | `raise-max` | the component's own value is 42 characters against a cap of 25 — the contract rejects what it ships |
| `form.paragraph` | richtext | min 5, max 2000 | max 2000 | `drop-min` | richtext body — the cap of 2000 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `heading_cta_centered` — 2 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 25 | max 80 | `raise-max` | the component's own value is 26 characters against a cap of 25 — the contract rejects what it ships |
| `button` | button | min 5, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `heading_cta_split` — 2 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 50 | max 80 | `raise-max` | 50 is below the floor of 80 for a title |
| `button` | button | min 5, max 50 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `hero_cards` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 10, max 200 | max 200 | `drop-min` | the cap of 200 is fine; the minimum of 10 is not |
| `highlight` | text | min 1, max 50 | max 50 | `drop-min` | the cap of 50 is fine; the minimum of 1 is not |
| `button` | button | min 5, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |
| `secondary` | button | min 5, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |
| `cards` | array | min 1, max 12 | max 12 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `cards.*.title` | text | min 1, max 50 | max 60 | `raise-max` | 50 is below the floor of 60 for a title |
| `cards.*.description` | text | min 10, max 200 | max 320 | `raise-max` | 200 is below the floor of 320 for a description |

### `hero_centered` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 20 | max 40 | `raise-max` | 20 is below the floor of 40 for a title_prefix |
| `title` | array | min 3, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `title_suffix` | text | min 5, max 30 | max 40 | `raise-max` | 30 is below the floor of 40 for a title_suffix |
| `subTitle` | text | min 50, max 500 | max 500 | `drop-min` | the cap of 500 is fine; the minimum of 50 is not |
| `button` | button | min 5, max 50 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `hero_chart` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 200 | max 200 | `drop-min` | the cap of 200 is fine; the minimum of 5 is not |
| `subtitle` | text | min 10, max 1000 | max 1000 | `drop-min` | the cap of 1000 is fine; the minimum of 10 is not |
| `cards` | array | min 1, max 3 | max 3 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `cards.*.title` | text | min 5, max 100 | max 100 | `drop-min` | the cap of 100 is fine; the minimum of 5 is not |
| `cards.*.date` | text | min 3, max 50 | max 50 | `drop-min` | the cap of 50 is fine; the minimum of 3 is not |
| `cards.*.stats` | array | max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `cards.*.buttonLabel` | text | min 3, max 30 | max 32 | `raise-max` | 30 is below the floor of 32 for a buttonlabel |

### `hero_split` — 12 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `breadcrumb` | array | max 4 | max 4 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `breadcrumb.*.link` | link | min 1, max 1000 | — | `remove-rule` | type `link` is a reference or a composite — a character count measures the wrong thing |
| `title_prefix` | text | min 5, max 15 | max 40 | `raise-max` | the component's own value is 26 characters against a cap of 15 — the contract rejects what it ships |
| `title` | text | min 10, max 15 | max 80 | `raise-max` | the component's own value is 28 characters against a cap of 15 — the contract rejects what it ships |
| `section` | text | min 10, max 15 | max 15 | `drop-min` | the cap of 15 is fine; the minimum of 10 is not |
| `badge` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a badge |
| `paragraph` | text | min 50, max 1000 | max 1000 | `drop-min` | the cap of 1000 is fine; the minimum of 50 is not |
| `primary` | button | min 5, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |
| `secondary` | button | min 5, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |
| `linksItems` | array | max 3 | max 3 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `linksItems.*.title` | text | min 1, max 20 | max 60 | `raise-max` | the component's own value is 21 characters against a cap of 20 — the contract rejects what it ships |
| `linksItems.*.paragraph` | text | min 10, max 150 | max 320 | `raise-max` | 150 is below the floor of 320 for a paragraph |

### `hero_video` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `breadcrumb` | array | max 5 | max 5 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `title_prefix` | text | min 3, max 60 | max 60 | `drop-min` | the cap of 60 is fine; the minimum of 3 is not |
| `title` | text | min 5, max 80 | max 80 | `drop-min` | the cap of 80 is fine; the minimum of 5 is not |
| `paragraph` | text | min 25, max 1000 | max 1000 | `drop-min` | the cap of 1000 is fine; the minimum of 25 is not |
| `primary` | button | min 3, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `icon_features` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 40 | max 40 | `drop-min` | the cap of 40 is fine; the minimum of 5 is not |
| `title` | text | min 5, max 40 | max 80 | `raise-max` | 40 is below the floor of 80 for a title |
| `paragraph` | text | min 25, max 1000 | max 1000 | `drop-min` | the cap of 1000 is fine; the minimum of 25 is not |
| `items` | array | min 2, max 2 | max 2 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.icon` | icon | max 500 | — | `remove-rule` | type `icon` is a reference or a composite — a character count measures the wrong thing |
| `items.*.paragraph` | text | min 25, max 1000 | max 1000 | `drop-min` | the cap of 1000 is fine; the minimum of 25 is not |

### `icon_features_card` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 40 | max 40 | `drop-min` | the cap of 40 is fine; the minimum of 5 is not |
| `title` | text | min 5, max 40 | max 80 | `raise-max` | 40 is below the floor of 80 for a title |
| `items` | array | min 1, max 3 | max 3 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 40 | max 60 | `raise-max` | 40 is below the floor of 60 for a title |
| `items.*.icon` | icon | min 20, max 60 | — | `remove-rule` | type `icon` is a reference or a composite — a character count measures the wrong thing |
| `items.*.paragraph` | text | min 50, max 500 | max 500 | `drop-min` | the cap of 500 is fine; the minimum of 50 is not |

### `icon_text_cards` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 50 | `raise-max` | the component's own value is 39 characters against a cap of 25 — the contract rejects what it ships |
| `title` | text | min 5, max 30 | max 80 | `raise-max` | the component's own value is 49 characters against a cap of 30 — the contract rejects what it ships |
| `paragraph` | text | min 5, max 250 | max 320 | `raise-max` | 250 is below the floor of 320 for a paragraph |
| `items` | array | min 1, max 18 | max 18 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | the component's own value is 39 characters against a cap of 25 — the contract rejects what it ships |
| `items.*.paragraph` | text | min 5, max 250 | max 320 | `raise-max` | 250 is below the floor of 320 for a paragraph |
| `items.*.icon` | icon | min 20, max 200 | — | `remove-rule` | type `icon` is a reference or a composite — a character count measures the wrong thing |

### `iframe` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 30 | max 40 | `raise-max` | 30 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 30 | max 80 | `raise-max` | 30 is below the floor of 80 for a title |
| `paragraph` | text | min 5, max 1000 | max 1000 | `drop-min` | the cap of 1000 is fine; the minimum of 5 is not |
| `button` | button | min 5, max 30 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |
| `map_title` | text | min 10, max 1000 | max 80 | `lower-max` | 1000 is 13× the title floor — a nominal cap rather than a real one |
| `map_url` | text | min 10, max 1000 | — | `remove-rule` | map_url holds a URL or asset reference — a character count is not a constraint on it |

### `image_accordion_split` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `identifier` | text | min 5, max 25 | max 64 | `raise-max` | 25 is below the floor of 64 for a identifier |
| `title_prefix` | text | min 5, max 45 | max 45 | `drop-min` | the cap of 45 is fine; the minimum of 5 is not |
| `title` | text | min 5, max 45 | max 80 | `raise-max` | 45 is below the floor of 80 for a title |
| `paragraph` | richtext | min 5, max 5000 | max 5000 | `drop-min` | richtext body — the cap of 5000 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |
| `items` | array | min 1, max 10 | max 10 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.paragraph` | richtext | min 5, max 5000 | max 5000 | `drop-min` | richtext body — the cap of 5000 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `image_icon_card` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 30 | max 80 | `raise-max` | 30 is below the floor of 80 for a title |
| `paragraph` | text | min 5, max 5000 | max 320 | `lower-max` | 5000 is 16× the paragraph floor — a nominal cap rather than a real one |
| `items` | array | min 2, max 10 | max 10 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 40 | max 60 | `raise-max` | 40 is below the floor of 60 for a title |
| `items.*.url` | text | min 5, max 1000 | — | `remove-rule` | items.*.url holds a URL or asset reference — a character count is not a constraint on it |
| `items.*.icon` | icon | min 50, max 250 | — | `remove-rule` | type `icon` is a reference or a composite — a character count measures the wrong thing |

### `image_stats_split` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 3, max 80 | max 80 | `drop-min` | the cap of 80 is fine; the minimum of 3 is not |
| `title` | text | min 5, max 20 | max 80 | `raise-max` | 20 is below the floor of 80 for a title |
| `paragraph` | text | max 500 | max 500 | `keep` | 500 already fits the paragraph and the content |
| `items` | array | min 1, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.paragraph` | text | min 5, max 200 | max 320 | `raise-max` | 200 is below the floor of 320 for a paragraph |

### `image_text_card` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 40 | max 80 | `raise-max` | 40 is below the floor of 80 for a title |
| `paragraph` | richtext | min 5, max 150 | max 320 | `raise-max` | the component's own value is 203 characters against a cap of 150 — the contract rejects what it ships |
| `button` | button | min 5, max 20 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `image_text_card_features` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | the component's own value is 26 characters against a cap of 25 — the contract rejects what it ships |
| `paragraph` | richtext | min 5, max 150 | max 320 | `raise-max` | the component's own value is 197 characters against a cap of 150 — the contract rejects what it ships |
| `button` | button | min 5, max 20 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |
| `items` | array | min 1, max 3 | max 3 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.paragraph` | text | min 5, max 100 | max 320 | `raise-max` | 100 is below the floor of 320 for a paragraph |

### `image_text_card_highlighted` — 4 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 25 | max 80 | `raise-max` | the component's own value is 26 characters against a cap of 25 — the contract rejects what it ships |
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `paragraph` | richtext | min 50, max 250 | max 320 | `raise-max` | 250 is below the floor of 320 for a paragraph |
| `button` | button | min 5, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `images_carousel_auto` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 30 | max 80 | `raise-max` | 30 is below the floor of 80 for a title |
| `title_suffix` | text | min 5, max 30 | max 40 | `raise-max` | 30 is below the floor of 40 for a title_suffix |
| `items` | array | min 1, max 10 | max 10 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |

### `key_resource` — 4 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 20 | max 80 | `raise-max` | 20 is below the floor of 80 for a title |
| `title_suffix` | text | min 5, max 20 | max 40 | `raise-max` | 20 is below the floor of 40 for a title_suffix |
| `paragraph` | text | min 50, max 200 | max 320 | `raise-max` | 200 is below the floor of 320 for a paragraph |
| `button` | button | min 5, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `list_check` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `type` | text | min 5, max 15 | max 40 | `raise-max` | 15 is below the floor of 40 for a type |
| `label` | text | min 5, max 60 | max 60 | `drop-min` | the cap of 60 is fine; the minimum of 5 is not |
| `url` | text | min 1, max 1000 | — | `remove-rule` | url holds a URL or asset reference — a character count is not a constraint on it |

### `logo_slider_cta` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 20 | max 40 | `raise-max` | 20 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 20 | max 80 | `raise-max` | 20 is below the floor of 80 for a title |
| `paragraph` | text | min 5, max 250 | max 320 | `raise-max` | 250 is below the floor of 320 for a paragraph |
| `button` | button | min 5, max 20 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |
| `left_items` | array | min 1, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `right_items` | array | min 1, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |

### `menu` — 27 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `url` | url | min 1, max 2500 | — | `remove-rule` | type `url` is a reference or a composite — a character count measures the wrong thing |
| `mobile` | menu | min 1, max 5 | max 5 | `not-a-length` | on `menu`, `content` counts rows rather than characters — left as authored |
| `primary` | array | min 1, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `primary.*.title` | text | min 1, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `primary.*.url` | url | min 1, max 2500 | — | `remove-rule` | type `url` is a reference or a composite — a character count measures the wrong thing |
| `primary.*.mega.title` | text | min 1, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `primary.*.mega.href` | url | min 1, max 2500 | — | `remove-rule` | type `url` is a reference or a composite — a character count measures the wrong thing |
| `primary.*.mega.link` | text | min 1, max 25 | max 32 | `raise-max` | 25 is below the floor of 32 for a link |
| `primary.*.mega.menu` | array | min 1, max 12 | max 12 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `primary.*.mega.menu.*.title` | text | min 1, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `primary.*.mega.menu.*.url` | url | min 1, max 2500 | — | `remove-rule` | type `url` is a reference or a composite — a character count measures the wrong thing |
| `primary.*.mega.menu.*.paragraph` | text | min 1, max 2500 | max 320 | `lower-max` | 2500 is 8× the paragraph floor — a nominal cap rather than a real one |
| `primary.*.mega.menu.*.feature_title` | text | min 1, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `primary.*.mega.menu.*.href` | url | min 1, max 2500 | — | `remove-rule` | type `url` is a reference or a composite — a character count measures the wrong thing |
| `primary.*.mega.menu.*.link` | text | min 1, max 25 | max 32 | `raise-max` | 25 is below the floor of 32 for a link |
| `primary.*.mega.menu.*.children` | array | min 2, max 8 | max 8 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `primary.*.mega.menu.*.children.*.title` | text | min 1, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `primary.*.mega.menu.*.children.*.description` | text | min 1, max 2500 | max 320 | `lower-max` | 2500 is 8× the description floor — a nominal cap rather than a real one |
| `primary.*.mega.menu.*.children.*.url` | url | min 1, max 2500 | — | `remove-rule` | type `url` is a reference or a composite — a character count measures the wrong thing |
| `primary.*.mega.card.title` | text | min 1, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `primary.*.mega.card.paragraph` | text | min 1, max 2500 | max 320 | `lower-max` | 2500 is 8× the paragraph floor — a nominal cap rather than a real one |
| `primary.*.mega.card.button` | button | min 1, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |
| `primary.*.mega.card.header` | text | min 1, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a header |
| `primary.*.mega.card.callout` | text | min 1, max 25 | max 120 | `raise-max` | the component's own value is 43 characters against a cap of 25 — the contract rejects what it ships |
| `primary.*.mega.card.link` | link | min 1, max 2500 | — | `remove-rule` | type `link` is a reference or a composite — a character count measures the wrong thing |
| `utilities` | array | max 4 | max 4 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `utilities.*.url` | url | min 1, max 2500 | — | `remove-rule` | type `url` is a reference or a composite — a character count measures the wrong thing |

### `pageable_image_text_cards` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `items` | array | min 1, max 9 | max 9 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 20 | max 60 | `raise-max` | the component's own value is 36 characters against a cap of 20 — the contract rejects what it ships |
| `items.*.subtitle` | text | max 25 | max 120 | `raise-max` | 25 is below the floor of 120 for a subtitle |
| `items.*.link` | link | min 5, max 20 | — | `remove-rule` | type `link` is a reference or a composite — a character count measures the wrong thing |
| `pagination.current` | number | max 999 | max 999 | `not-a-length` | on a number, `content` is a value range — not this exercise's business |

### `parallax_cards` — 8 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | the component's own value is 28 characters against a cap of 25 — the contract rejects what it ships |
| `left_items` | array | min 1, max 10 | max 10 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `left_items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `left_items.*.paragraph` | richtext | min 5, max 300 | max 430 | `raise-max` | the component's own value is 353 characters against a cap of 300 — the contract rejects what it ships |
| `right_items` | array | min 1, max 10 | max 10 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `right_items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `right_items.*.paragraph` | richtext | min 5, max 300 | max 430 | `raise-max` | the component's own value is 353 characters against a cap of 300 — the contract rejects what it ships |

### `performance_chart` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 1, max 255 | max 255 | `drop-min` | the cap of 255 is fine; the minimum of 1 is not |
| `show_stats` | boolean | min 1, max 255 | max 255 | `not-a-length` | on `boolean`, `content` counts rows rather than characters — left as authored |
| `data` | array | max 255 | max 255 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `data.*.date` | text | min 1, max 255 | max 40 | `lower-max` | 255 is 6× the date floor — a nominal cap rather than a real one |
| `data.*.value` | number | min 1, max 255 | max 255 | `not-a-length` | on a number, `content` is a value range — not this exercise's business |

### `photo_gallery` — 4 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `rows` | select | min 1, max 4 | max 4 | `not-a-length` | on `select`, `content` counts rows rather than characters — left as authored |
| `items` | array | min 4, max 50 | max 50 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |

### `related_posts` — 4 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 35 | max 80 | `raise-max` | 35 is below the floor of 80 for a title |
| `paragraph` | text | min 5, max 200 | max 320 | `raise-max` | 200 is below the floor of 320 for a paragraph |
| `related_posts` | array | min 1, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `related_posts.*.title` | text | min 5, max 25 | max 60 | `raise-max` | the component's own value is 27 characters against a cap of 25 — the contract rejects what it ships |

### `stackable_image_text` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `items` | array | min 1, max 10 | max 10 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.paragraph` | text | min 5, max 150 | max 320 | `raise-max` | 150 is below the floor of 320 for a paragraph |
| `items.*.button` | button | min 5, max 20 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `stats` — 9 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 30 | max 40 | `raise-max` | 30 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 30 | max 80 | `raise-max` | 30 is below the floor of 80 for a title |
| `items` | array | min 1, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.prefix` | text | min 1, max 5 | max 5 | `drop-min` | the cap of 5 is fine; the minimum of 1 is not |
| `items.*.duration` | number | max 10000000 | max 10000000 | `not-a-length` | on a number, `content` is a value range — not this exercise's business |
| `items.*.start` | number | max 10000000000 | max 10000000000 | `not-a-length` | on a number, `content` is a value range — not this exercise's business |
| `items.*.number` | number | max 10000000000 | max 10000000000 | `not-a-length` | on a number, `content` is a value range — not this exercise's business |
| `items.*.suffix` | text | min 1, max 5 | max 5 | `drop-min` | the cap of 5 is fine; the minimum of 1 is not |
| `items.*.paragraph` | text | min 5, max 100 | max 320 | `raise-max` | 100 is below the floor of 320 for a paragraph |

### `tab_video` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 30 | max 40 | `raise-max` | 30 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 30 | max 80 | `raise-max` | 30 is below the floor of 80 for a title |
| `items` | array | min 3, max 4 | max 4 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 30 | max 60 | `raise-max` | 30 is below the floor of 60 for a title |
| `items.*.url` | text | min 15, max 3000 | — | `remove-rule` | items.*.url holds a URL or asset reference — a character count is not a constraint on it |
| `items.*.description` | richtext | min 15, max 3000 | max 3000 | `drop-min` | richtext body — the cap of 3000 stays, the minimum of 15 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `tabs_horizontal_auto` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | the component's own value is 26 characters against a cap of 25 — the contract rejects what it ships |
| `items` | array | min 1, max 5 | max 5 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.tab` | text | min 5, max 25 | max 25 | `drop-min` | the cap of 25 is fine; the minimum of 5 is not |
| `items.*.top` | text | min 5, max 25 | max 25 | `drop-min` | the cap of 25 is fine; the minimum of 5 is not |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | the component's own value is 37 characters against a cap of 25 — the contract rejects what it ships |

### `tabs_vertical` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `items` | array | min 2, max 2 | max 2 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.paragraph` | text | min 5, max 100 | max 320 | `raise-max` | the component's own value is 123 characters against a cap of 100 — the contract rejects what it ships |

### `testimonial_carousel` — 6 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `items` | array | min 1, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.quote` | text | min 5, max 100 | max 240 | `raise-max` | the component's own value is 136 characters against a cap of 100 — the contract rejects what it ships |
| `items.*.author` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a author |
| `items.*.role` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a role |

### `testimonial_image_card` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `author` | text | min 5, max 50 | max 60 | `raise-max` | 50 is below the floor of 60 for a author |
| `role` | text | min 5, max 60 | max 60 | `drop-min` | the cap of 60 is fine; the minimum of 5 is not |
| `quote` | text | min 5, max 175 | max 240 | `raise-max` | 175 is below the floor of 240 for a quote |

### `text_card` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 35 | max 40 | `raise-max` | 35 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 35 | max 80 | `raise-max` | 35 is below the floor of 80 for a title |
| `paragraph` | richtext | min 50, max 1500 | max 1500 | `drop-min` | richtext body — the cap of 1500 stays, the minimum of 50 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `text_cards_grid` — 8 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 30 | max 40 | `raise-max` | 30 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 30 | max 80 | `raise-max` | 30 is below the floor of 80 for a title |
| `paragraph` | text | min 50, max 150 | max 320 | `raise-max` | 150 is below the floor of 320 for a paragraph |
| `button` | button | min 5, max 20 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |
| `items` | array | min 1, max 9 | max 9 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 20 | max 60 | `raise-max` | 20 is below the floor of 60 for a title |
| `items.*.paragraph` | text | min 5, max 200 | max 320 | `raise-max` | 200 is below the floor of 320 for a paragraph |
| `items.*.link` | link | min 5, max 20 | — | `remove-rule` | type `link` is a reference or a composite — a character count measures the wrong thing |

### `text_cta_stats` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | the component's own value is 26 characters against a cap of 25 — the contract rejects what it ships |
| `paragraph` | richtext | min 5, max 255 | max 320 | `raise-max` | 255 is below the floor of 320 for a paragraph |
| `items` | array | min 3, max 6 | max 6 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 25 | max 60 | `raise-max` | 25 is below the floor of 60 for a title |
| `items.*.paragraph` | richtext | min 5, max 100 | max 320 | `raise-max` | the component's own value is 123 characters against a cap of 100 — the contract rejects what it ships |
| `items.*.class` | text | max 10 | — | `remove-rule` | items.*.class is configuration, not copy — its length is incidental |

### `text_imagegrid_split` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 15 | max 80 | `raise-max` | 15 is below the floor of 80 for a title |
| `title_suffix` | text | min 5, max 15 | max 40 | `raise-max` | 15 is below the floor of 40 for a title_suffix |
| `paragraph` | text | min 5, max 90 | max 320 | `raise-max` | 90 is below the floor of 320 for a paragraph |
| `first_row` | array | min 1, max 3 | max 3 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `second_row` | array | min 1, max 3 | max 3 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |

### `thank_you` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `paragraph` | text | min 5, max 100 | max 320 | `raise-max` | 100 is below the floor of 320 for a paragraph |
| `button` | button | min 5, max 25 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `three_column_text` — 4 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 100 | max 100 | `drop-min` | the cap of 100 is fine; the minimum of 5 is not |
| `columns` | array | min 3, max 3 | max 3 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `columns.*.title` | text | min 2, max 50 | max 60 | `raise-max` | 50 is below the floor of 60 for a title |
| `columns.*.content` | text | min 20, max 500 | max 500 | `drop-min` | the cap of 500 is fine; the minimum of 20 is not |

### `title_simple` — 2 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |

### `vector_image` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 35 | max 80 | `raise-max` | 35 is below the floor of 80 for a title |
| `paragraph` | text | min 5, max 300 | max 320 | `raise-max` | 300 is below the floor of 320 for a paragraph |
| `button` | button | min 5, max 20 | — | `remove-rule` | type `button` is a reference or a composite — a character count measures the wrong thing |

### `vertical_accordion` — 7 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `identifier` | text | min 5, max 35 | max 64 | `raise-max` | 35 is below the floor of 64 for a identifier |
| `title_prefix` | text | min 5, max 45 | max 45 | `drop-min` | the cap of 45 is fine; the minimum of 5 is not |
| `title` | text | min 5, max 45 | max 80 | `raise-max` | 45 is below the floor of 80 for a title |
| `paragraph` | richtext | min 5, max 5000 | max 5000 | `drop-min` | richtext body — the cap of 5000 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |
| `items` | array | min 1, max 20 | max 20 | `not-a-length` | on `array`, `content` counts rows rather than characters — left as authored |
| `items.*.title` | text | min 5, max 45 | max 60 | `raise-max` | 45 is below the floor of 60 for a title |
| `items.*.paragraph` | richtext | min 5, max 5000 | max 5000 | `drop-min` | richtext body — the cap of 5000 stays, the minimum of 5 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `video` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 5, max 25 | max 40 | `raise-max` | 25 is below the floor of 40 for a title_prefix |
| `title` | text | min 5, max 25 | max 80 | `raise-max` | 25 is below the floor of 80 for a title |
| `paragraph` | text | min 5, max 100 | max 320 | `raise-max` | 100 is below the floor of 320 for a paragraph |

### `video_highlight` — 5 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title_prefix` | text | min 2, max 40 | max 40 | `drop-min` | the cap of 40 is fine; the minimum of 2 is not |
| `title` | text | min 2, max 60 | max 80 | `raise-max` | 60 is below the floor of 80 for a title |
| `paragraph` | text | min 20, max 300 | max 320 | `raise-max` | 300 is below the floor of 320 for a paragraph |
| `transcript_label` | text | min 5, max 40 | max 40 | `drop-min` | the cap of 40 is fine; the minimum of 5 is not |
| `transcript` | richtext | min 10, max 50000 | max 50000 | `drop-min` | richtext body — the cap of 50000 stays, the minimum of 10 goes; a cap on richtext counts markup, so `<b>Hi</b>` spends 15 characters on 2 of copy — enforce it against the text, not the HTML |

### `video_split` — 3 ruled fields

| field | type | now | proposed | action | why |
|---|---|---|---|---|---|
| `title` | text | min 5, max 30 | max 80 | `raise-max` | 30 is below the floor of 80 for a title |
| `title_suffix` | text | min 5, max 30 | max 40 | `raise-max` | 30 is below the floor of 40 for a title_suffix |
| `paragraph` | text | min 50, max 150 | max 320 | `raise-max` | 150 is below the floor of 320 for a paragraph |

