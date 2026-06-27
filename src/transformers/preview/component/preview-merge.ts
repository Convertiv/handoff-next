/**
 * Unified preview model (Component+Preview standard, #3 merge). A built Figma
 * *variant* and an authored *registry* preview are the same thing — a named set
 * of property values — differing only in origin. This merges both into one list
 * the single preview surface renders (client-side) and toggles through.
 *
 * Pure — no I/O, no React — so it's unit-testable and shared by the surface +
 * the workbench.
 */

export type PreviewSource = 'variant' | 'registry';

export interface UnifiedPreview {
  /** Stable, source-namespaced key (e.g. "variant:generic", "registry:<uuid>"). */
  key: string;
  label: string;
  values: Record<string, unknown>;
  source: PreviewSource;
  /** Built variant only — the prebuilt `.html` artifact URL (kept for open-in-new-tab). */
  url?: string;
  /** Registry only. */
  semantic?: string | null;
  rationale?: string | null;
  syncState?: string | null;
}

interface BuiltPreview {
  title?: string;
  values?: Record<string, unknown>;
  url?: string;
}

export interface RegistryPreviewLite {
  id: string;
  previewKey: string;
  title: string;
  values: Record<string, unknown>;
  semantic: string | null;
  rationale: string | null;
  syncState: string;
}

/** Merge built variants (from `component.previews`) + registry previews into one list. */
export function mergePreviews(
  built: Record<string, BuiltPreview> | undefined,
  registry: RegistryPreviewLite[] | undefined
): UnifiedPreview[] {
  const out: UnifiedPreview[] = [];
  for (const [key, p] of Object.entries(built ?? {})) {
    if (!p || typeof p !== 'object') continue;
    out.push({
      key: `variant:${key}`,
      label: p.title || key,
      values: p.values ?? {},
      source: 'variant',
      url: p.url,
    });
  }
  for (const r of registry ?? []) {
    if (!r?.id) continue;
    out.push({
      key: `registry:${r.id}`,
      label: r.title || r.previewKey,
      values: r.values ?? {},
      source: 'registry',
      semantic: r.semantic,
      rationale: r.rationale,
      syncState: r.syncState,
    });
  }
  return out;
}

/** The registry-preview id behind a `registry:<id>` key, or null for variants/unknown. */
export function registryIdFromKey(key: string | null | undefined): string | null {
  if (!key || !key.startsWith('registry:')) return null;
  return key.slice('registry:'.length);
}
