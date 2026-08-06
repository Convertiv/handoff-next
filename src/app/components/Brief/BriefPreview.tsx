'use client';

import { useEffect, useState } from 'react';
import { constructComponentPreview } from '../Playground/Preview';
import Preview from '../Playground/Preview';
import { usePlayground } from '../Playground/PlaygroundContext';

/**
 * The preview pane of the brief and built-page viewers — the whole right-hand 70%.
 *
 * Reads the canvas the provider hydrated, and renders it with **no injected controls at all**: not even the
 * edit affordance the guest editor keeps, because nothing on this surface is editable.
 */
export default function BriefPreview() {
  const { selectedComponents, loading } = usePlayground();
  const [html, setHtml] = useState('');
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // No `injectBlockControls`: a read-only surface should not render a toolbar it will refuse to honour.
      const result = await constructComponentPreview(selectedComponents, basePath, { injectBlockControls: false });
      if (!cancelled) setHtml(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedComponents, basePath]);

  /**
   * Keyed on the blocks, **not** on `html`: `constructComponentPreview([])` returns a complete but empty
   * document, so `html` is always truthy and an `!html` guard never fires — which is why the pane rendered as
   * a white slab instead of this placeholder the first time round.
   */
  if (loading || selectedComponents.length === 0) {
    /**
     * A muted placeholder rather than the blank white iframe an empty document renders as — which read as a
     * broken page in dark mode. The iframe's *contents* keep their own theme (they are the page being
     * previewed, not app chrome); this is only what shows when there is nothing to preview yet.
     */
    return (
      <div className="flex h-full items-center justify-center bg-muted/30 p-8">
        <p className="max-w-sm text-center text-sm text-muted-foreground">
          {loading ? 'Loading the preview…' : 'Nothing to preview — this page has no blocks.'}
        </p>
      </div>
    );
  }

  return <Preview html={html} className="h-full" />;
}
