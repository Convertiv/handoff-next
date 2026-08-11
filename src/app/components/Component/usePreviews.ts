'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  enabled = true,
  /**
   * Preview key to open on, from `?preview=` — what `handoff_create_preview`'s `verifyUrl` points at.
   *
   * Honoured **once**, and only once the named preview actually exists: a registry preview arrives from a
   * client fetch after the built-in ones, so seeding `selectedKey` eagerly would be overwritten by the
   * default-to-first effect below. Before this the param was simply ignored, so `verifyUrl` loaded the
   * component with `Generic` selected and no sign of the preview it was meant to prove (found 2026-08-10).
   */
  initialKey?: string | null
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

  /** Guards the one-shot: after the requested key has been applied, the user owns the selection. */
  const initialApplied = useRef(false);

  // Keep a valid selection; honour `?preview=` the first time it resolves, else default to the first.
  useEffect(() => {
    setSelectedKey((cur) => {
      if (!initialApplied.current && initialKey && previews.some((p) => p.key === initialKey)) {
        initialApplied.current = true;
        return initialKey;
      }
      return cur && previews.some((p) => p.key === cur) ? cur : previews[0]?.key ?? null;
    });
  }, [previews, initialKey]);

  const selected = useMemo(() => previews.find((p) => p.key === selectedKey) ?? null, [previews, selectedKey]);

  return { previews, selected, selectedKey, setSelectedKey, refresh, registry };
}
