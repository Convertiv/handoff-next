# Component + Preview Canonical Schema — draft

**Status:** draft for review (the Phase-0 "spike the schema first" deliverable for the
[Previews as first-class semantic data](DESIGN_SYSTEM_ROADMAP.md) initiative).
**Companion:** [`schemas/component.schema.json`](schemas/component.schema.json) (validatable draft),
round-tripped against the SS&C `button` element at the end of this doc.

This is the canonical data standard for the **component layer** — the analogue of DTCG for the
token layer. It exists because no external standard covers "a component with a typed property
contract and a set of semantically-labelled, validated previews." DTCG has no component concept;
DSDS is documentation-shaped. So this is a schema we own.

---

## 1. Principles it has to satisfy

From the roadmap's data-lifecycle principle (Guiding Principle 6):

> **Structured data → easy to author → validated & tracked → projected to UI, MCP, REST.**

Concretely, this schema must:
1. **Generalize across stacks** — the same canonical record describes a Bootstrap+Handlebars
   element (SS&C) and a React+Tailwind component (8x8). Stack specifics live in two fields
   (`renderer`, `entries`), never in the shape of the contract or previews.
2. **Preserve spec-as-code DX** — authors keep writing a TS module (`defineComponent({...})`).
   That ergonomic, autocompleted, friendly-developer-platform authoring is a *feature we keep*.
   The TS module is the **authoring adapter**, not the canonical store.
3. **Make previews first-class** — a preview is validated structured data (a property value-set
   + semantic meaning + rationale + provenance), not a display artifact.
4. **Carry provenance everywhere** — every record and every preview says where it came from,
   its sync state, and who owns it (the universal envelope, inline under `$extensions.handoff`,
   same as DTCG).

It also has to **clean up two overloads** in today's `ComponentObject` that the cross-stack
audit exposed (see §7):
- `type` (on a property) is used as *both* a closed renderer type *and* a free-form editorial
  widget — and SS&C even pairs `type: "text"` with a separate `enum` array.
- `renderer` is inferred from a file extension rather than declared.

---

## 2. Two layers: authoring spec vs canonical record

Per Guiding Principle 2 (*specs are adapters, never the internal model*):

```
  author writes                  normalize + validate              consumers read
 ┌───────────────┐   adapter    ┌─────────────────────┐  project  ┌──────────────┐
 │ component.ts  │ ───────────► │  Canonical Record    │ ────────► │ UI / MCP /   │
 │ defineComponent│  (+ figma,  │  (validated JSON +   │           │ REST         │
 │   ({...})      │   schema.ts) │   provenance envelope)│           │              │
 └───────────────┘              └─────────────────────┘           └──────────────┘
   spec-as-code DX                 the standard                      thin read models
```

- **Authoring spec** (`component.ts`) — a TS module exporting `defineComponent({...})`. Friendly,
  typed, autocompleted. For React it may delegate the property contract to a generated
  `schema.ts` (derived from a `*Props` TS type); for Handlebars it inlines the contract. Either
  way the *output* of the adapter is the same canonical record.
- **Canonical record** — the validated JSON conforming to `component.schema.json`, with the
  provenance envelope. This is what's stored in the file-tree, pushed to the registry, and read
  by every consumer. **No consumer has its own source of truth** (the corollary to Principle 6:
  if the MCP can't see something, enrich the record, don't special-case the MCP — exactly what
  bit us with spacing tokens).

The `defineComponent` helper is the DX surface. It is a thin typed identity/validator at author
time; the build step is what evaluates the module, merges generated `schema.ts` + Figma link
data, and emits the canonical record.

---

## 3. The canonical component record

Field groups (full shape in `component.schema.json`):

| Group | Fields | Notes |
|---|---|---|
| **Identity** | `id`, `title`, `description`, `kind` | `kind`: `element` \| `block` \| `pattern` \| `page` (renames today's overloaded `type`). |
| **Taxonomy** | `group`, `categories[]`, `tags[]` | |
| **Render binding** | `renderer`, `entries` | `renderer` is **explicit**: `react` \| `handlebars` \| `csf`. `entries` is the stack seam: `{ template?, schema?, styles?, script?, component?, story? }`. |
| **Contract** | `properties{}` | map of `PropertySpec` (§4). The functional shape. |
| **Previews** | `previews[]` | array of `PreviewSpec` (§5). The keystone. |
| **Guidance** | `shouldDo[]`, `shouldNotDo[]`, `usage?` | |
| **Transform** | `options.transformer?` | per-stack token-naming config (SS&C uses it for the Figma-variant→token map). Opaque to the schema; passed through. |
| **Source link** | `figma?` | `{ fileKey?, nodeId?, componentSetId?, url? }` — normalized (today it's sometimes a bare string, sometimes a `links.figma` object; canonicalize to an object). |
| **Envelope** | `$extensions.handoff` | `{ source, syncState, lineage[], ownership?, lastSynced }`. |

Renames/normalizations vs today's `ComponentObject`: `type` → `kind`; bare-string `figma` →
object; explicit `renderer`; previews become an **array** of objects with stable `id`s (today
it's a keyed map — an array with `id` is friendlier for ordering, contribution, and provenance
per-preview).

---

## 4. PropertySpec — the contract, renderer-agnostic

The fix for the `type` overload: **split the closed canonical type from the open editorial
widget, and make `enum` first-class.**

```
PropertySpec {
  name: string                 // display name ("Type")
  description?: string
  valueType: ValueType         // CLOSED canonical enum (below)
  editorWidget?: string        // OPEN editorial hint: "richtext" | "menu" | "video_embed" | …
  enumOptions?: EnumOption[]    // [{ value, label? }] — first-class, not smuggled into valueType
  default?: Json
  rules?: Rules                // { required?, content?{min,max}, dimensions?, filesize?, filetype?, pattern? }
  items?: PropertySpec         // for valueType: "array"
  properties?: { [k]: PropertySpec }  // for valueType: "object"
  // React provenance (optional, populated from schema.ts):
  kind?: "primitive" | "slot" | "function" | "object"
  sourceType?: string          // the TS type, e.g. "string | null", "React.ReactNode"
  generic?: string
}

ValueType = text | richtext | number | boolean | image | link | button
          | icon | array | object | enum | slot | function | any
```

- `valueType` is the **renderer-agnostic, validatable** type. `richtext`/`menu`/`video_embed`
  etc. become `valueType: text|object|…` + `editorWidget: "richtext"` — so validation has a
  closed set to reason about, while the editor still knows the rich widget to show.
- SS&C's `type:"text"` + `enum:[…]` normalizes to `valueType:"enum"`, `enumOptions:[…]`.
- React slots (`React.ReactNode`) → `valueType: "slot"`, `kind: "slot"`, `sourceType:
  "React.ReactNode"`. The canonical contract still lists them as properties; only the *preview
  value channel* differs (§5).

---

## 5. PreviewSpec — the keystone

A preview is **a validated set of property values, with meaning**. The critical design move is
**two value channels** to resolve the `values: any` tension (SS&C literals vs 8x8 ReactNodes):

```
PreviewSpec {
  id: string                   // stable slug
  title: string                // human label ("Primary — main page CTA")
  values: { [propKey]: Json }  // SERIALIZABLE values only — the canonical, validatable,
                               //   MCP/REST-projectable channel. Keys ∈ component.properties.
  slots?: { [propKey]: SlotRef }   // NON-serializable render inputs (React node factories,
                               //   component refs) — render-only, NOT canonical data.
  semantic?: SemanticTag       // primary | secondary | tertiary | destructive | success |
                               //   warning | disabled | empty-state | loading | … (open, recommended set)
  rationale?: string           // WHY this preview exists / when to use it — the text that
                               //   gives the MCP and humans the *meaning* of the config
  render?: { image?, html?, mode: "prebuilt" | "client" }  // artifact ref / render strategy
  $extensions.handoff: { source, author?, createdAt, syncState }
}
```

- **`values` is canonical and serializable** → it validates against the property contract, and
  it's what the MCP/REST project. This is the channel that makes previews *data*.
- **`slots` is render-only** → React node factories live here, never in `values`. Canonical data
  stays serializable; the React DX is preserved without polluting the standard.
- **`semantic` + `rationale` are the meaning** → "this is the *primary* button, `Type:primary`,
  because it's the main page CTA." This is what the spike found missing (yellow-vs-blue): the
  model no longer guesses — the meaning is authored data.

---

## 6. Validation contract

Two levels — and the second is the one that makes it a *system*, not a pile of files:

1. **Shape (intra-entity)** — JSON Schema (AJV) validates the record + each PropertySpec +
   each PreviewSpec against `component.schema.json`.
2. **Referential integrity (inter-entity)** — programmatic checks beyond JSON Schema:
   - every `preview.values` key ∈ `component.properties` keys;
   - each value conforms to its property's `valueType`, `enumOptions`, and `rules`
     (e.g. `Type: "primary"` ∈ enumOptions; `Label` length within `content.min/max`);
   - token references in templates/values resolve to real DTCG tokens;
   - `semantic` tags are in the recommended vocabulary (warn, don't fail, if novel).

   This is **"validate previews against real semantic value"** — an invalid preview is a caught
   error, not a silent bad render.

---

## 7. Cross-stack mapping (the generalization test)

| Concern | SS&C (handlebars) | 8x8 (react) | Canonical record |
|---|---|---|---|
| Template | `template.hbs` | `template.tsx` | `entries.template` + `renderer` (explicit) |
| Contract source | inline `properties` | generated `schema.ts` from `*Props` | `properties{}` (PropertySpec) — react adds `kind`/`sourceType`/`generic` |
| Property "type" | `type:"text"` (+ `enum`) | TS-derived (`React.ReactNode`, `boolean`) | `valueType` (closed) + `editorWidget` (open) + `enumOptions` |
| Preview values | flat literals | literals **+ ReactNode factories** | `values` (serializable) + `slots` (render-only) |
| Token reference | Bootstrap utility classes (SCSS) | Tailwind utilities (JSX) | not in the contract — lives in template/styles; tokens resolve via DTCG |
| Figma link | bare `figma:"<url>"` | `links.figma:{type,text,url}` | normalized `figma:{fileKey,nodeId,url}` |
| Semantic meaning | **absent** (Figma variants only) | **absent** | `preview.semantic` + `rationale` (new) |

Both stacks collapse to one record; the only stack-aware fields are `renderer` and `entries`.

---

## 8. Projection to consumers (the payoff)

- **MCP** — `handoff_get_component` returns the contract (`properties`) + `previews` (values +
  `semantic` + `rationale`). "Show me the primary button" → real values + why. Resolves Finding 4.
- **REST/UI** — render previews client-side from `entries.template` + tokens + `values`
  (`render.mode: "client"`), retiring the server image pipeline for renderable previews.
- **Semantic tokens (optional projection)** — a preview tagged `primary` with
  `values.Type:"primary"` can *generate* `button.primary.*` semantic tokens. Authoring happens
  once, as a preview; the token tier is a derived output, not a parallel hand-authored source.

---

## 9. Authoring DX — `defineComponent` (spec-as-code preserved)

```ts
import { defineComponent } from 'handoff-app';

export default defineComponent({
  id: 'button',
  title: 'Button',
  kind: 'element',
  renderer: 'handlebars',
  entries: { template: './template.hbs', styles: './style.scss' },
  properties: {
    Type:  { valueType: 'enum', enumOptions: [{ value: 'primary' }, { value: 'secondary' }, { value: 'tertiary' }], default: 'primary', rules: { required: true } },
    Label: { valueType: 'text', default: 'Primary CTA', rules: { required: true, content: { min: 5, max: 60 } } },
    URL:   { valueType: 'text', editorWidget: 'url', default: 'https://ssctech.com', rules: { required: true } },
  },
  previews: [
    { id: 'primary', title: 'Primary — main page CTA', semantic: 'primary',
      rationale: 'The single highest-emphasis action on a page. Amber fill, dark label.',
      values: { Type: 'primary', Label: 'Request a demo', URL: '#' } },
  ],
});
```

`defineComponent<T>` is a typed identity helper: full autocomplete + author-time type errors,
zero runtime cost, and it's the adapter input the build normalizes into the canonical record.
React keeps delegating the contract to `schema.ts`; `defineComponent` merges it.

---

## 10. Worked round-trip — SS&C `button`

**Source** (`integration/atoms/button/button.js`, abridged): `type:"element"`, properties
`type` (`type:"text"` + `enum:[primary,secondary,tertiary]`), `label`, `url`; **`previews: {}`
(empty)**; `options.transformer` token-naming config; template is a stub.

**Canonical record** (conforms to `component.schema.json`): see
[`schemas/examples/ssc-button.json`](schemas/examples/ssc-button.json). Highlights of the
normalization:
- `type:"element"` → `kind:"element"`; explicit `renderer:"handlebars"`.
- property `type` → `valueType:"enum"`, `enumOptions:[{value:"primary"},…]` (the
  `type:"text"`+`enum` overload resolved); `url` → `valueType:"text"`, `editorWidget:"url"`.
- `options.transformer` passed through untouched.
- **`previews:[]` becomes the place to author meaning** — adding the `primary` preview above
  (semantic `primary`, rationale, values) is the concrete fix for the spike's yellow-vs-blue
  ambiguity, authored once as data and projected to MCP/UI/REST.
- envelope: `{ source: "figma:0gKWw8gYChpItKWzh8o23N", syncState: "in-sync", lastSynced }`.

---

## 11. Open questions to settle in review

1. **Previews: keyed map vs array.** Proposed array-with-`id` (ordering, per-preview provenance,
   contribution). Today it's a keyed map. Migration is mechanical but it's a breaking shape change.
2. **`valueType` final closed set.** Is the §4 list complete? Where do `video`, `menu`, `template`,
   `component`, `search` (seen in SS&C) map — all `editorWidget` over a base `valueType`?
3. **Semantic vocabulary.** Fix a recommended enum (primary/secondary/destructive/…) or leave fully
   open with a registry? Affects token projection (§8).
4. **Where the canonical record lives.** DTCG covers tokens under `design-system/tokens/`;
   components need a parallel home — `design-system/components/<id>.json` (canonical) authored from
   `integration/.../<id>.ts` (spec). Confirm the file-tree layout.
5. **Backfill.** Existing previews (SS&C keyed maps, 8x8 ReactNode previews) → migrate into
   `values`/`slots`. Largely mechanical; ReactNode previews populate `slots`, leaving `values`
   serializable.
6. **Validation home.** New AJV-based validator (Phase 0 had this as aspirational) — a
   `tokens:validate`-style `components:validate` step run in build + CI.
