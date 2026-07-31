# The field bridge — editing arbitrary React components reliably

**Status:** design note, 2026-07-31. Written after the third production bug from one cause.

## The bug class, stated once

Three failures this month, all the same shape:

| Symptom | Declared | Actual |
|---|---|---|
| `<p>` tags visible in copy | `slot` → "HTML string" | bare text |
| Empty buttons; `items.map is not a function` | `array` → "array of button" | a single React element |
| Image generated, "Applied", page unchanged | `image` → `{ src, alt }` | `{ type: 'img', props: { src } }` |

Each was fixed at its call site. The cause was never fixed, so it came back twice.

## Why the bridge cannot currently be right

`shapeNote` in `lib/mcp/scaffold-helpers.ts` is the bridge:

```ts
case 'image': return '{ src, alt, width?, height? }';
```

A hardcoded table from a declared `editorType` to a **prose string**, asserted for every component in
every registry, with no reference to what the component renders. It is not that this is wrong and could
be corrected — **one `editorType` maps to many real shapes**, so no table can be right. `image` is
`{ src, alt }` in one component and a serialized `img` element in the next. `buttonSlots` is
`{ url, text }` here and `{ label, href }` there. The mapping does not exist to be looked up.

**The deeper problem: a label describes, but the UI needs a location.** `'{ src, alt }'` tells you the
shape and not where to write. Knowing "this is an image" did not stop us writing to `slot.src` when the
renderer reads `slot.props.src`. And a prose label cannot be tested — there is no assertion you can
write against the string `'{ src, alt, width?, height? }'`.

So: **the bridge should be a lens, not a label.**

## Three sources, each authoritative for exactly one question

The failure is not a missing source of truth. It is one source answering a question it cannot.

| Source | Authoritative for | Cannot answer |
|---|---|---|
| **Observed value** (preview render) | *Where the data lives* — the lens | What is allowed; what is required; intent |
| **TypeScript type** | *What is allowed* — enum members, optionality, required | Runtime shape, once a prop is `React.ReactNode` |
| **Author annotation** | *Intent* — which editor, label, help, grouping, dimension rules | Anything structural |

Today annotation answers the structural question. That is the whole bug class.

**Types alone cannot close this**, which is worth being clear about because it is the intuitive fix.
`desktopImageSlot: React.ReactNode` is a perfectly honest type meaning "anything renderable" — a string,
an element, an array of them. Full type inference would tell us exactly that, which is exactly nothing.
The runtime value is the only thing that knows a given component renders an `img` there. Type extraction
is worth doing for enums and required-ness; it will never answer "where does the src go".

## The lens

Replace the prose shape with a structural descriptor that says where each editable leaf lives:

```ts
// hero-background.desktopImageSlot
{ kind: 'element', tag: 'img', paths: { src: ['props', 'src'], alt: ['props', 'alt'] } }

// some-card.image
{ kind: 'object', paths: { src: ['src'], alt: ['alt'] } }

// a richtext slot
{ kind: 'html', paths: { html: ['props', 'dangerouslySetInnerHTML', '__html'] } }
```

Derived from the observed value, not declared. `findImageNode`/`setElementImage` in
`merge-block-values.ts` are the first instance of this written by hand for one case; the generalisation
is to compute the paths once, per component, and have every writer use them — the AI merge, the block
editor's `ImageField`, the placeholder swap. Three writers currently each rediscover the shape, which is
why one of them can be right while another is wrong on the same field.

## The invariant that makes it testable

This is the part that matters for arbitrary components, and it needs no understanding of the component:

```
write(lens, args, SENTINEL) → render → SENTINEL appears in the output
```

Round-trip through the actual renderer. If a write through the declared lens is not observable in the
render, the lens is wrong — and you know at build time rather than when a user's hero comes out blank.

Run it as a property over the whole catalog: **every component × every preview × every editable slot.**
It is a few hundred cheap assertions, it would have caught all three bugs above, and it keeps catching
them as components change — which is the actual risk, since a component author who restructures a slot
has no idea a field descriptor somewhere describes it.

This also gives a real answer to "is this component editable?" — a question we currently answer by
assumption. A component whose slots round-trip is editable. One whose slots do not is not, and we should
say so.

## The honesty rule

When no lens can be derived — no preview, or the round-trip fails — **show a raw JSON editor with a
warning, not a pretty form.** A form that writes to the wrong path is worse than an ugly one that
writes to the right path, because it reports success. Every failure in the table above looked like it
worked; two of them printed "Applied".

## Where this leaves the paused typed-React initiative

The fields-annotation layer (`project-typed-react-preview-builder`) is the right thing built against the
wrong contract. Keep it for what annotation is good at — which editor to show, labels, help text,
grouping, validation rules — and **stop it being the shape authority.** Its output becomes an input to
the lens, not a substitute for it, and it gets validated by the same round-trip.

That also makes it safe to roll out, which is arguably why it stalled: nobody could tell whether turning
it on would break rendering, because nothing checked.

## Order to build it

1. **The conformance test.** Derive lenses from previews, round-trip every slot, report the catalog's
   failures. Ships no behaviour change and immediately tells us how big the problem actually is across
   8x8, Cynosure and SSC — a number we do not currently have.
2. **One lens module**, replacing the three hand-rolled shape guesses (AI merge, block editor,
   placeholder swap) with shared accessors.
3. **Type extraction** for enums and required-ness, which the observed value genuinely cannot give.
4. **Annotation layer** on top, for intent, validated by (1).

Step 1 is the one that changes the conversation from "we think the bridge is right" to a number.
