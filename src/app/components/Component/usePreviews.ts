'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { handoffApiUrl } from '../../lib/api-path';
import {
  mergePreviews,
  type RegistryPreviewLite,
  type UnifiedPreview,
} from '@handoff/transformers/preview/component/preview-merge';

export interface UsePreviewsResult {
  /** Built variants + registry previews, one merged list. */
  previews: UnifiedPreview[];
  selected: UnifiedPreview | null;
  selectedKey: string | null;
  setSelectedKey: (key: string | null) => void;
  /** Re-fetch registry previews (call after a workbench save/delete). */
  refresh: () => Promise<void>;
  /** Raw registry previews (for the workbench list / editing). */
  registry: RegistryPreviewLite[];
}

/**
 * One source of truth for a component's previews: merges built variants
 * (`component.previews`) with registry previews fetched from the slice-2 API,
 * and owns the current selection. Consumed by the single preview surface and
 * the workbench so they stay in lockstep (auto-switch on save).
 */
export function usePreviews(
  componentId: string,
  builtPreviews: Record<string, unknown> | undefined,
  enabled = true
): UsePreviewsResult {
  const [registry, setRegistry] = useState<RegistryPreviewLite[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const apiBase = `/api/registry/components/${encodeURIComponent(componentId)}/previews`;

  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(handoffApiUrl(apiBase), { credentials: 'include' });
      if (res.ok) {
        const j = (await res.json()) as { previews?: RegistryPreviewLite[] };
        setRegistry(j.previews ?? []);
      }
    } catch {
      /* registry previews are optional — ignore fetch failures */
    }
  }, [apiBase, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const previews = useMemo(
    () => mergePreviews(builtPreviews as Record<string, never> | undefined, registry),
    [builtPreviews, registry]
  );

  // Keep a valid selection; default to the first preview.
  useEffect(() => {
    setSelectedKey((cur) => (cur && previews.some((p) => p.key === cur) ? cur : previews[0]?.key ?? null));
  }, [previews]);

  const selected = useMemo(() => previews.find((p) => p.key === selectedKey) ?? null, [previews, selectedKey]);

  return { previews, selected, selectedKey, setSelectedKey, refresh, registry };
}
