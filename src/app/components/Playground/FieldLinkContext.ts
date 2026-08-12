'use client';

import { createContext, createElement, useContext, type ReactNode } from 'react';

/**
 * The link between a field in the rail and where it renders in the canvas — roadmap F.2's orientation half.
 *
 * F.1 marks where each field renders and F.2 lets you edit it in place, which left the two lists of fields
 * unrelated: the rail showed them in *schema* order with no indication of which one you were looking at, and the
 * canvas knew the answer but had nobody to tell. The frame already emitted `playground-field-hover` and accepted
 * `playground-highlight-field`; nothing consumed either.
 *
 * Its own tiny module for the same two reasons as `FieldGuardrailsContext`, which this mirrors deliberately:
 *
 * 1. **The field layer must not reach server code.** `PlaygroundContext` imports server actions, so importing it
 *    from a field drags `server-only` into every consumer of `renderFormFields`.
 * 2. **Fields render outside the playground.** `ComponentWorkbenchDialog` renders them with no provider above, so
 *    the default has to be meaningful rather than a throw. Here that default is "no canvas to link to": nothing
 *    highlights, `onHover` does nothing, and the rail keeps schema order.
 *
 * Plain `createElement` rather than JSX so this stays a `.ts` module.
 */

export interface FieldLink {
  /**
   * The field currently under the pointer, as a dotted path **without a row index**.
   *
   * Row-less because the rail renders one editor per repeater row but the highlight reads better on the whole
   * field, and because a mark id arrives as `items.paragraph:1` while the rail's path is `items.1.paragraph` —
   * normalising both ends to `items.paragraph` is what lets them match at all.
   */
  hovered: string | null;
  /** Called by a field row as the pointer enters and leaves. Null on leave. */
  onHover: (path: string | null) => void;
  /**
   * Field paths in the order they render on the page, or null when the canvas has not reported.
   *
   * Null rather than an empty array on purpose: "nothing reported" must keep schema order, while "reported
   * nothing" (a block with no marks, e.g. React) would otherwise sort every field to the end.
   */
  documentOrder: string[] | null;
}

const NO_CANVAS: FieldLink = { hovered: null, onHover: () => {}, documentOrder: null };

const FieldLinkContext = createContext<FieldLink>(NO_CANVAS);

export function FieldLinkProvider({ value, children }: { value: FieldLink; children: ReactNode }) {
  return createElement(FieldLinkContext.Provider, { value }, children);
}

/** The canvas link, or an inert one when a field renders with no canvas beside it. Never throws. */
export function useFieldLink(): FieldLink {
  return useContext(FieldLinkContext);
}

/**
 * A field path as both ends can compare it: no row indices, no mark suffix.
 *
 * `items.1.paragraph` (the rail, walking real args) and `items.paragraph:1` (a mark, carrying `@index`) are the
 * same field, and this is the only place that fact is encoded.
 */
export function fieldLinkKey(path: string): string {
  return path
    .replace(/:\d+$/, '')
    .split('.')
    .filter((seg) => !/^\d+$/.test(seg))
    .join('.');
}

/** The message a findings list posts to ask the builder to reveal a field. Named here beside the other link parts. */
export const REVEAL_FIELD_MESSAGE = 'playground-reveal-field';

/**
 * Ask the playground to select a block and highlight one of its fields — what clicking a finding does (E.11).
 *
 * **A window message rather than a prop or a context**, because the two callers sit on opposite sides of the
 * playground and no single React path connects them. `BuildPanel` is *rendered* inside `PlaygroundBuilder` (it
 * arrives as the `leftPanel` element, so context would reach it), but `GuestAuthoring` renders the whole editor as a
 * child and sits **above** it — a context provided by the builder is invisible from there, and threading a callback
 * upward would invert the data flow through three components.
 *
 * `PlaygroundBuilder` already runs a `window` message hub for exactly this class of request —
 * `playground-scroll-to-block`, `playground-highlight-field`, `playground-edit-field` — so this is the existing
 * idiom rather than a new channel. It also keeps the guest surface ignorant of the playground's internals: it says
 * *what* it wants, not *how*.
 *
 * @param blockIndex Zero-based position, as a finding reports it.
 * @param path Dotted field path, or null for a page-level finding (block gets selected, nothing highlights).
 */
export function requestFieldReveal(blockIndex: number, path: string | null): void {
  if (typeof window === 'undefined') return;
  window.postMessage({ type: REVEAL_FIELD_MESSAGE, blockIndex, path }, '*');
}

/**
 * Properties reordered to match the page — the answer to "fields come in the order they come in".
 *
 * The order is *reported*, never inferred: the frame walks its comment marks with a `TreeWalker`, which yields
 * them in document order for free, so this only has to apply what it was told.
 *
 * Two rules worth stating because they are the reason this is a function and not a `sort` call:
 *
 * - **No report means no reordering.** A null order returns the object untouched, so a React block (no marks) and
 *   a canvas that has not loaded both keep schema order rather than being scrambled or emptied.
 * - **Unreported fields keep schema order, after the reported ones.** A field the template never renders — config,
 *   an anchor, a theme switch — has no document position to sort by, and inventing one would move it arbitrarily
 *   on every reload.
 */
export function orderPropertiesByDocument<T extends Record<string, unknown>>(
  properties: T | null | undefined,
  documentOrder: string[] | null
): T | null | undefined {
  if (!properties || !documentOrder || !documentOrder.length) return properties;

  const rank = new Map<string, number>();
  documentOrder.forEach((id, index) => {
    // Marks address nested fields (`items.paragraph`), but the rail orders top-level keys, so the first segment
    // is what carries the position — and the *earliest* mention is the field's place on the page.
    const top = fieldLinkKey(id).split('.')[0];
    if (top && !rank.has(top)) rank.set(top, index);
  });

  const keys = Object.keys(properties);
  const reordered = [...keys].sort((a, b) => {
    const ra = rank.get(a);
    const rb = rank.get(b);
    if (ra === undefined && rb === undefined) return keys.indexOf(a) - keys.indexOf(b);
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });

  // Object key order is insertion order, which is what `renderFormFields` walks.
  const out: Record<string, unknown> = {};
  for (const key of reordered) out[key] = properties[key];
  return out as T;
}
