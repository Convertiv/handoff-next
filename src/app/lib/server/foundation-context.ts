import 'server-only';

import { getDataProvider } from '@/lib/data';
import type { DesignWorkbenchFoundationContext } from '@/app/design/workbench-types';

/**
 * Build the design-generation foundation context from the registry's own tokens.
 *
 * **Why this exists.** The image model is only as accurate as the reference material it is handed,
 * and the single most load-bearing piece of that material is a *rasterized* sheet of the design
 * system's colours, type specimens and spacing scale. `renderFoundationsImage` produces it — but
 * only when the context is non-empty (`shouldRasterizeFoundations` returns false for four empty
 * arrays), and `formatFoundationsBlock` likewise emits nothing without it.
 *
 * `handoff_generate_design_image` hardcoded `{ colors: [], typography: [], effects: [], spacing: [] }`,
 * so **every MCP-initiated generation silently lost both the token sheet and the textual token
 * block** while UI-initiated generation kept them. That is why an MCP-driven design drifts off-token
 * (wrong teal, larger type) where the workbench lands on the values exactly — measured at 76% token
 * overlap on a spec round-trip, 2026-07-29.
 *
 * Never throws: a registry with no tokens yields empty arrays and generation degrades to
 * prompt-only, which is the previous behaviour rather than a failure.
 */

type AnyRec = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Compact one-line type specimen, matching what the workbench sends. */
function typographyLine(values: AnyRec): string {
  const size = str(values.fontSize);
  const lh = str(values.lineHeightPx);
  return [str(values.fontFamily), str(values.fontWeight), size && lh ? `${size}/${lh}` : size]
    .filter(Boolean)
    .join(' ');
}

export async function buildFoundationContextFromRegistry(): Promise<DesignWorkbenchFoundationContext> {
  const empty: DesignWorkbenchFoundationContext = { colors: [], typography: [], effects: [], spacing: [] };

  let localStyles: AnyRec = {};
  try {
    const doc = (await getDataProvider().getTokens()) as AnyRec | null;
    localStyles = ((doc ?? {}).localStyles ?? {}) as AnyRec;
  } catch {
    return empty;
  }

  const colors = Array.isArray(localStyles.color)
    ? (localStyles.color as AnyRec[])
        .map((c) => ({ name: str(c.name), value: str(c.value), group: str(c.group) || undefined }))
        .filter((c) => c.name && c.value)
    : [];

  const typography = Array.isArray(localStyles.typography)
    ? (localStyles.typography as AnyRec[])
        .map((t) => ({ name: str(t.name), line: typographyLine((t.values ?? {}) as AnyRec) }))
        .filter((t) => t.name && t.line)
    : [];

  const effects = Array.isArray(localStyles.effect)
    ? (localStyles.effect as AnyRec[])
        .map((e) => ({ name: str(e.name), line: str(e.value) || str((e as AnyRec).effect) }))
        .filter((e) => e.name && e.line)
    : [];

  // Spacing lives in the DTCG pipeline rather than the Figma localStyles snapshot, and
  // getDtcgTokenStrings returns serialized formats — so the tree has to be parsed out of `.dtcg`.
  const spacing: { name: string; value: string }[] = [];
  try {
    const strings = await getDataProvider().getDtcgTokenStrings('spacing');
    if (strings?.dtcg) {
      const walk = (node: unknown, path: string[]) => {
        if (!node || typeof node !== 'object' || spacing.length >= 40) return;
        const obj = node as AnyRec;
        if ('$value' in obj) {
          spacing.push({ name: path.join('.'), value: str(obj.$value) });
          return;
        }
        for (const [k, v] of Object.entries(obj)) {
          if (k.startsWith('$')) continue;
          walk(v, [...path, k]);
        }
      };
      walk(JSON.parse(strings.dtcg), []);
    }
  } catch {
    /* spacing is optional — several registries have no DTCG dimension tokens */
  }

  return { colors, typography, effects, spacing };
}
