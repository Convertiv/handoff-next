'use client';

import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { PlaygroundAsset } from './types';

/**
 * What the block editor's **image** field may do on this surface: where its assets come from, and whether it
 * may offer generation.
 *
 * Both answers differ for a guest building from an invitation, and neither can be read from
 * `PlaygroundContext` — `MediaBrowser` and `ImageField` also render inside `ComponentWorkbenchDialog`, which
 * has no `PlaygroundProvider` above it, so `usePlayground()` would throw and take that dialog down. Same
 * reasoning as [FieldGuardrailsContext]; the defaults below describe that no-provider case.
 *
 * Plain `createElement` rather than JSX so this stays a `.ts` module that renders under any JSX runtime.
 */

export type AssetLister = () => Promise<PlaygroundAsset[]>;

export interface FieldMedia {
  /**
   * Where the picker gets its assets, or `null` for the default authenticated endpoints.
   *
   * A guest has no session, so `/api/handoff/assets` 401s; the picker used to fall through to the static
   * workspace assets, find none, and land on the placeholder tab — leaving the asset library, the *only*
   * image source a guest is given, unreachable.
   */
  assetLister: AssetLister | null;
  /**
   * Whether to offer "Generate".
   *
   * False for guests: they illustrate a page from the asset library and nothing else (Brad, 2026-08-05), and
   * `/api/handoff/ai/generate-image` requires a session — so the button was both against the rule and a
   * guaranteed 401. Defaults true because every authenticated surface may generate.
   */
  imageGeneration: boolean;
}

const DEFAULT: FieldMedia = { assetLister: null, imageGeneration: true };

const FieldMediaContext = createContext<FieldMedia>(DEFAULT);

export function FieldMediaProvider({ value, children }: { value: FieldMedia; children: ReactNode }) {
  return createElement(FieldMediaContext.Provider, { value }, children);
}

/** Never throws — outside a provider this reports the authenticated defaults. */
export function useFieldMedia(): FieldMedia {
  return useContext(FieldMediaContext);
}
