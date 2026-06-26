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
  valueType: ValueType         // CLOSED canonical enum (below) — for validation + generic rendering
  editorType?: string          // OPEN, extensible content/widget signal: "richtext" | "menu" |
                               //   "video_embed" | "url" | … — consumed by the EDITOR (which widget)
                               //   AND downstream TRANSPILERS (how to treat the content). Carries the
                               //   original SS&C `type` value with full fidelity. Grows per-project
                               //   without touching the closed valueType enum.
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

- `valueType` is the **renderer-agnostic, validatable** type — a *closed* set so validation and
  generic rendering can reason exhaustively. `richtext`/`menu`/`video_embed` etc. become
  `valueType: text|object|…` + `editorType: "richtext"`. The split matters because the two needs
  are opposed: `valueType` must stay **closed/stable** (for validation), while the transpiler
  signal is an **open, per-project-growing** vocabulary. SS&C's downstream transpilers read
  `editorType` — so no content-structure meaning is lost; it's just no longer overloaded onto the
  field validation depends on.
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
| Property "type" | `type:"text"` (+ `enum`) | TS-derived (`React.ReactNode`, `boolean`) | `valueType` (closed) + `editorType` (open) + `enumOptions` |
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
    URL:   { valueType: 'text', editorType: 'url', default: 'https://ssctech.com', rules: { required: true } },
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
  `type:"text"`+`enum` overload resolved); `url` → `valueType:"text"`, `editorType:"url"`.
- `options.transformer` passed through untouched.
- **`previews:[]` becomes the place to author meaning** — adding the `primary` preview above
  (semantic `primary`, rationale, values) is the concrete fix for the spike's yellow-vs-blue
  ambiguity, authored once as data and projected to MCP/UI/REST.
- envelope: `{ source: "figma:0gKWw8gYChpItKWzh8o23N", syncState: "in-sync", lastSynced }`.

---

## 11. CSF (Storybook) as a third authoring adapter

CSF normalizes into the canonical record with **no structural change** — `RendererKind` already
includes `csf` and `entries` already has `story`. A Storybook file *is* a component + a set of
previews:

| CSF | Canonical |
|---|---|
| `meta.component` | the component (its props type → contract, via §12 inference) |
| `meta.argTypes` | `properties{}` — `control:'select'`+`options` → `valueType:"enum"`+`enumOptions`; `control:'text'` → `text`; `boolean`/`number`/`object`/`radio` likewise |
| `meta.args` | base default values |
| each **named export** (a story) | a `PreviewSpec` — export name → `title`/`id`, `args` → `values` |
| `args` that are functions / JSX | → the `slots` channel (same rule as React node previews) |
| `parameters` / tags | → `semantic` + `rationale` |
| `play` (interaction test) | ignored — out of scope for previews |

Two things to specify: (1) a **meaning convention** — Storybook has no native "this story is the
primary variant," so carry it in a namespaced `parameters.handoff = { semantic, rationale }` (or
tags); (2) CSF **composes with inference** — `argTypes` is usually partial, so the §12 TS-inferred
contract fills the gaps and `argTypes` overrides where present.

That CSF, inline TS specs, generated `schema.ts`, Figma, and manual/LLM authoring all collapse to
the *same* `properties` + `previews` is the generalization test the schema has to pass — and does.

---

## 12. TypeScript inference → field architecture → builder/playground

This works because **`PropertySpec` is a form-field descriptor by construction**. One structure does
triple duty: it is the *target* of TS inference, the *field list* that drives the preview-builder
and playground, and the *editable artifact* in a field-builder UI. (8x8's generated `schema.ts`
already proves the inference path; it carries `sourceType`/`generic`/`kind`/`docgenType`/`deepType`/
`typeRefs`.)

**Inference mapping (`*Props` type → PropertySpec):**

| TS type | PropertySpec |
|---|---|
| `string` / `number` / `boolean` | `text` / `number` / `boolean` |
| string-literal union `'a' \| 'b'` | `enum` + `enumOptions` (high value) |
| interface / object | `object` + recursive `properties` |
| `T[]` | `array` + `items` |
| `prop?:` / `\| undefined` | `rules.required: false` |
| `React.ReactNode` | `slot` (render-only; field UI offers a text/child fallback, not arbitrary JSX) |
| function | `function` (non-editable; preset picker at best) |
| complex generic / conditional / discriminated union | fallback `any`/`object`, **retain `deepType`/`typeRefs`** for manual refinement |

**The load-bearing design property:** separate the *inferred provenance* from the *editable
contract*.
- `sourceType` / `generic` / `kind` / `docgenType` / `deepType` / `typeRefs` = what the type **is**
  (immutable truth from the source).
- `valueType` / `editorType` / `enumOptions` / `rules` / `default` = how it's **edited**
  (refinable by a human or the field-builder UI).

Inference produces a *candidate* contract; the field-builder refines widget/rules/options;
re-inference re-derives provenance but **preserves human overrides** via the same provenance /
`syncState` envelope — drift detection at the property level. The inferred `enumOptions` + `rules`
also feed the preview-builder's live (level-2 referential) validation, so the chain
*infer → fields → validated previews* is coherent end-to-end.

**Honest edge:** TS is more expressive than any form UI. You auto-derive ~80% cleanly (primitives,
unions, objects, arrays, optionality); the rest falls back to `slot`/`any` with provenance retained.
**Bidirectional bonus:** field-builder edits can project *back* to a generated `*Props` interface,
closing the loop for the developer.

---

## 13. Decisions (resolved in review)

1. **Previews → array-with-`id`, with lenient normalization.** Canonical form is the array.
   The intake adapter is **lenient**: if it detects the legacy keyed-map (`{ key: { title, values } }`),
   it normalizes (key → `id`) rather than throwing. General principle, applied everywhere: *accept
   loose input, normalize to canonical — don't error on a recoverable shape.*
2. **Split confirmed: `valueType` (closed) + `editorType` (open).** The content-structure meaning
   SS&C transpilers depend on is carried faithfully in `editorType`, kept off the closed
   `valueType` that validation reasons over. `video`/`menu`/`template`/`component`/`search` are
   `editorType` values over a base `valueType` (`object`/`array`/`text` as appropriate).
3. **Semantic vocabulary: open, with a registry.** A recommended set ships
   (primary/secondary/tertiary/destructive/…); projects extend it via a registry. Unregistered
   tags are allowed (warn, don't fail) and simply don't auto-project to semantic tokens (§8).
4. **Canonical record lives at `design-system/components/<id>.json`**, authored from
   `integration/.../<id>.ts` (the spec). Parallel to DTCG tokens under `design-system/tokens/`.
   Build emits the record; push ships it; consumers read it.
5. **Backfill is mechanical.** Existing previews migrate into `values`/`slots` — SS&C keyed maps →
   array + `values`; 8x8 ReactNode previews → `slots`, leaving `values` serializable.
6. **Validation home: a `components:validate` step** (AJV shape + referential checks), run in
   build + CI, mirroring the planned `tokens:validate`.
7. **CSF meaning: `parameters.handoff = { semantic, rationale }` is authoritative, tags are a
   shorthand.** Reasoning: `tags` are flat strings — great for `semantic` (a tag matching the
   vocabulary maps straight to it) but they can't carry the prose `rationale`. `parameters.handoff`
   is structured and holds both. So honor both: `parameters.handoff` wins where present; a
   vocabulary-matching tag is a convenient shorthand for `semantic`. Best of both — tag ergonomics
   + rationale richness.
8. **Inference override policy — resolved via property-level provenance.** *Implications, concretely:*
   when fields are inferred from a TS type and a human later edits one in the field-builder (changes
   the widget, adds a rule, relabels an option), a *later* re-inference must not silently clobber
   that edit. Policy:
   - Each property carries `syncState` in its envelope. Purely-inferred = `in-sync`; human-edited =
     `overridden`.
   - Re-inference always refreshes the **provenance** fields (`sourceType`/`generic`/`deepType`/…) —
     the immutable truth from the type — but for an `overridden` property it leaves the **editable
     contract** (`valueType`/`editorType`/`enumOptions`/`rules`/`default`) alone, and flags `drifted`
     if the underlying type changed in a way that conflicts (e.g. an enum member the override
     renamed was removed upstream). The UI surfaces drift for a human to reconcile.
   - **Non-inferrable types** (functions, complex generics, conditional/mapped types) resolve to
     `slot`/`any`/`object` with `deepType`/`typeRefs` retained; they're rendered **non-editable** in
     the field-builder (or offered a preset/slot picker) rather than a broken form control.
   *Example:* button's `Type` infers as `enum[primary,secondary,tertiary]`; a designer adds a
   `rules.required`. Later a dev adds `'quaternary'` to the union → re-inference keeps the designer's
   rule, adds the new option as a suggestion, and flags nothing (additive). If the dev instead
   *removed* `tertiary` while the override referenced it → `drifted`, surfaced for reconciliation.
