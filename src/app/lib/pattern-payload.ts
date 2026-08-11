import type { PatternComponentEntry, PatternListObject } from '@handoff/transformers/preview/types';
import type { SelectedPlaygroundComponent } from '@/components/Playground/types';

/**
 * Canvas → stored pattern shape.
 *
 * Extracted from `SavePatternDialog` because autosave (roadmap E.3) writes the same record from the same
 * canvas, and two copies of this mapping would drift — the stored `components`/`previews` pair is exactly
 * what the playground reads back on load and what the guest flow diffs against, so a discrepancy would
 * surface as a page that loads differently than it was saved.
 *
 * `previews.default.values` is the per-block override layer: the same array the guest override layer and
 * the review diff use. Keeping it in one function is what lets those features agree.
 */
export function buildPatternPayload(
  id: string,
  title: string,
  description: string,
  group: string,
  tags: string[],
  selected: SelectedPlaygroundComponent[],
  basePath: string
): { list: PatternListObject; components: PatternComponentEntry[]; payload: Record<string, unknown> } {
  const components: PatternComponentEntry[] = selected.map((c) => {
    const previewKeys = Object.keys(c.previews || {});
    const previewKey = c.previews?.generic ? 'generic' : previewKeys[0];
    return {
      id: c.id,
      ...(previewKey ? { preview: previewKey } : {}),
      args: { ...(c.data ?? {}) },
    };
  });

  return patternPayloadFromEntries(
    id,
    title,
    description,
    group,
    tags,
    components,
    selected.map((c) => ({ ...(c.data ?? {}) })),
    basePath
  );
}

/**
 * The same stored shape, from block entries that are already in `{ id, preview?, args }` form.
 *
 * Exists for the MCP write path, which composes from contracts rather than from a hydrated canvas and so has no
 * `SelectedPlaygroundComponent` to map. Before this it called `writePattern` with **no `data` at all**, which
 * left the record readable only through its `components` column — every page composed over MCP came back as
 * `{ id }` and rendered its published page empty (found 2026-08-10). Sharing the assembly is what stops the two
 * writers producing different records for the same page.
 */
export function patternPayloadFromEntries(
  id: string,
  title: string,
  description: string,
  group: string,
  tags: string[],
  components: PatternComponentEntry[],
  values: Record<string, unknown>[],
  basePath: string
): { list: PatternListObject; components: PatternComponentEntry[]; payload: Record<string, unknown> } {
  const previews = {
    default: {
      title: 'Default',
      values,
    },
  };

  const list: PatternListObject = {
    id,
    path: `${basePath}/api/pattern/${id}.json`,
    title,
    description: description || undefined,
    group: group || undefined,
    tags: tags.length ? tags : undefined,
    components,
    url: `${id}.html`,
  };

  const payload: Record<string, unknown> = { ...list, previews };
  return { list, components, payload };
}
