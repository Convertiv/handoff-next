import { fetchComponentDetail } from '../Playground/PlaygroundContext';
import { renderPreview } from '../Playground/Preview';
import { mergeBlockArgs, type PatternComponentEntry } from '@/lib/guest-editable';
import type { SelectedPlaygroundComponent } from '../Playground/types';

/**
 * Turn a stored page row into the hydrated blocks `constructComponentPreview` needs.
 *
 * Used by the HTML download, which must not depend on whatever the preview pane happens to be showing —
 * a download is of the *record*, not of the screen. Hydration reuses `fetchComponentDetail` and
 * `renderPreview` rather than reimplementing them, so an exported page renders exactly as the canvas does.
 *
 * A block whose component is missing from the registry is skipped rather than failing the export: losing one
 * block from a downloaded file is better than handing back nothing, and the omission is visible.
 */
export async function hydrateForExport(
  pattern: Record<string, unknown>,
  basePath: string
): Promise<SelectedPlaygroundComponent[]> {
  const entries = (Array.isArray(pattern.components) ? pattern.components : []) as PatternComponentEntry[];
  const data = (pattern.data ?? {}) as { previews?: { default?: { values?: unknown } } };
  const values = Array.isArray(data.previews?.default?.values)
    ? (data.previews!.default!.values as Record<string, unknown>[])
    : [];

  const hydrated = await Promise.all(
    entries.map(async (entry, index): Promise<SelectedPlaygroundComponent | null> => {
      try {
        const merged = mergeBlockArgs(entry, values[index]);
        const detail = await fetchComponentDetail(entry.id, basePath);
        const rendered = await renderPreview(detail, merged, basePath);
        return {
          ...detail,
          rendered,
          data: merged,
          order: index,
          quantity: 1,
          uniqueId: `${entry.id}-export-${index}`,
        } as SelectedPlaygroundComponent;
      } catch {
        return null;
      }
    })
  );

  return hydrated.filter((c): c is SelectedPlaygroundComponent => c !== null);
}
