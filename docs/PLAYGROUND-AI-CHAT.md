# Spec — "Generate with AI" for the playground, as a chat

**Status:** Designed, not built (2026-07-30). Scope set by Brad: **assemble existing components, populate
content, and use images from the asset store.** No image generation.

## What exists today, and why it needs replacing

`components/Playground/Wizard/` is a modal dialog that already does a version of this. It should go,
and not only because a chat is nicer:

```ts
// Wizard/llm-client.ts
const apiKey = getApiKey();
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  headers: { Authorization: `Bearer ${apiKey}` },
```

It calls OpenAI **directly from the browser with a user-pasted API key** (`ApiKeySettings.tsx`, held
client-side). That means: a secret in the browser, no cost tracking in `handoff_event_log`, no shared
server key, and none of the workspace context — brand voice, design guidelines — that every other
generation path inherits automatically. Moving this server-side is the substantive win; the chat UI is
the part the user sees.

## Shape

A right sidebar in `PlaygroundBuilder`, mirroring the existing 260px left library rail, using Natko's
chat components (`components/Chat/` — `ChatDrawer`, `ChatInput`, `ChatMessage`, `ChatActionCard`,
`ChatComponentGrid`). Conversation on the right, live preview in the middle, block library on the left.

**The chat proposes; the client applies.** The server never writes the pattern. It returns a proposed
block list, the client calls `bulkAddComponents(entries, replace?)`, and the user watches the page
assemble in the preview they already have — then tweaks and saves through the normal path. This is not
a shortcut: it keeps every existing edit affordance meaningful, and it means a bad proposal costs a
click rather than a saved artifact.

Integration point already exists and needs no change:

```ts
bulkAddComponents(entries: { componentId: string; data: Record<string, any> }[], replace?: boolean)
```

## Server route and its tools

New `POST /api/handoff/ai/playground-chat`, modelled on the existing `/api/handoff/ai/chat` (same
tool-calling loop, different toolset) and using `openAiChatJson` so cost and events are logged like
everything else.

| Tool | Purpose |
|---|---|
| `search_components` | What blocks exist. Light — id/title/group only. |
| `scaffold_args` | **The important one.** Returns a correctly-shaped `args` template per component, seeded from a real preview and annotated with editorType (richtext = HTML string, image = `{src, alt}`, …). Already exists as an MCP tool; lift the implementation into a shared lib so both call it. Without this the model guesses prop shapes and blocks render empty. |
| `search_assets` | The asset store. This is how imagery gets in — never generated. Returns `{ id, name, src }`, and `src` goes straight into an image-typed arg. |
| `propose_page` | Terminal call: `{ blocks: [{componentId, args}], rationale }`. Rendered as a `ChatActionCard` the user clicks to apply. |

Brand voice and design guidelines come from `getDesignWorkspace()` server-side, so copy is on-voice
without the user restating it — the same inheritance the workbench gets.

## Decisions worth keeping

- **Assets are searched, never invented.** The model picks from what the store actually holds. If
  nothing fits, it says so rather than fabricating a path — a broken `src` renders as a missing image
  and looks like a bug in the page, not a gap in the library.
- **`scaffold_args` before authoring, always.** The single biggest quality lever. It is why the MCP tool
  exists and carries that instruction in its own description.
- **Apply is explicit.** `propose_page` produces a card, not a mutation. `replace: false` by default so
  a proposal adds to what is there rather than silently discarding the user's work.
- **Questions are a feature.** The point of a chat over a dialog is that it can ask — audience, tone,
  how many sections, whether there is a form. The prompt should encourage one round of clarifying
  questions before proposing, and never more than one.

## Removal, once this lands

`Wizard/llm-client.ts`, `Wizard/ApiKeySettings.tsx` and the stored client-side key. `PageImporter.tsx`
is a separate capability (import an existing page) — check whether it shares the key path before
deleting anything.

## Open questions

- **Media attachment.** Brad asked for it. Attaching a reference image to a *component-assembly* chat is
  only useful if the model reads it for layout intent ("build something like this"), since the output is
  blocks, not pixels. Worth confirming that is the intent before wiring vision in.
- **Does it edit an existing page, or only build new?** `bulkAddComponents(replace)` supports both. The
  richer behaviour — "swap the hero for the split one", "add a pricing section" — needs the chat to know
  the current composition, which means passing it in on every turn.
