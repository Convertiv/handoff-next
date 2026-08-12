/**
 * Field descriptor → the control type the editor renders.
 *
 * **Extracted out of `Field.tsx` so the server can share it.** `content-only.ts` classifies fields with this
 * function on purpose — "what is hidden cannot drift from what is drawn" — but `Field.tsx` is a `'use client'`
 * React module, so importing it dragged the whole client component graph into anything server-side that wanted to
 * know a field's type. That blocked the guardrail gate from asking the one question it needs to ask: *is this field
 * one the guest can even see?* (roadmap E.11).
 *
 * Pure by construction: no React, no context, no imports. `Field.tsx` re-exports it, so every existing caller is
 * unchanged and there is still exactly one definition.
 */

/**
 * Resolve a field descriptor to the control type the switch renders.
 *
 * TS-inference schemas (8x8) carry both a render `type` and an inference
 * `kind`. The `type` can be a literal TS type string (e.g. `React.ReactNode`)
 * that the switch wouldn't otherwise recognise, so we fall back to `kind`
 * to map slots/functions/unknowns onto real controls instead of dumping JSON.
 */
export function resolveFieldType(value: any): string {
  // An authored `editorType` (fields annotation, §12a) is the intent signal and
  // wins on widget selection — a `React.ReactNode` slot annotated `image` should
  // render the image editor, not the slot fallback.
  const BUILDER_EDITORS = new Set([
    // `image-url` is a picker whose value is the URL string itself, for a field like an image item's
    // `src`. `image` is bound to a whole image object and writes `src`/`srcset`/`alt` inside it.
    'text', 'richtext', 'number', 'boolean', 'select', 'image', 'image-url', 'link', 'button', 'object', 'array', 'slot',
  ]);
  const editorType = value?.editorType;
  if (typeof editorType === 'string' && BUILDER_EDITORS.has(editorType)) return editorType;

  const type = value?.type;
  if (type === 'React.ReactNode') return 'slot';
  if (type === 'function') return 'function';
  if (type === 'any') return 'any';
  const known = new Set([
    'object', 'array', 'image', 'video_file', 'button', 'link',
    'text', 'string', 'richtext', 'number', 'boolean', 'select', 'enum',
  ]);
  if (typeof type === 'string' && known.has(type)) return type;
  // Unrecognised `type` — lean on the inference `kind`.
  switch (value?.kind) {
    case 'slot': return 'slot';
    case 'function': return 'function';
    case 'enum': return 'enum';
    case 'object': return 'object';
    case 'array': return 'array';
    case 'primitive': return 'text';
    case 'unknown': return 'any';
    default: return type ?? 'any';
  }
}
