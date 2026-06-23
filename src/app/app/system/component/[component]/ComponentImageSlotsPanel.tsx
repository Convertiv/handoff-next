'use client';

import { useEffect, useState } from 'react';
import { handoffApiUrl } from '../../../../lib/api-path';
import { Badge } from '../../../../components/ui/badge';

type ImageSlot = {
  id: string;
  componentId: string;
  slotName: string;
  nodeId: string | null;
  recommendedWidth: number | null;
  recommendedHeight: number | null;
  aspectRatioW: number | null;
  aspectRatioH: number | null;
  scaleMode: string | null;
  isResponsive: boolean | null;
  minWidth: number | null;
  minHeight: number | null;
};

const SCALE_MODE_LABELS: Record<string, string> = {
  FILL: 'Crops to fill — image covers the entire slot',
  FIT:  'Fits inside — image letterboxed within slot',
  CROP: 'Positioned crop — image cropped at a set position',
  TILE: 'Tiled — image repeats to fill slot',
};

function AspectRatioBox({ w, h }: { w: number; h: number }) {
  // Clamp to a max display ratio so the box doesn't go extreme
  const displayW = Math.min(w, h * 3);
  const displayH = Math.min(h, w * 3);
  const pct = ((displayH / displayW) * 100).toFixed(1);
  return (
    <div
      className="relative w-16 shrink-0 overflow-hidden rounded border border-border bg-muted"
      style={{ paddingBottom: `${pct}%` }}
    >
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-muted-foreground">
        {w}:{h}
      </span>
    </div>
  );
}

/**
 * "Image sizing guide" section on the component detail page.
 * Shows recommended dimensions, aspect ratio, fill mode, and responsive
 * behaviour for each image slot extracted from the Figma design.
 */
export default function ComponentImageSlotsPanel({ componentId }: { componentId: string }) {
  const [slots, setSlots] = useState<ImageSlot[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          handoffApiUrl(`/api/handoff/image-slots?componentId=${encodeURIComponent(componentId)}`),
          { credentials: 'include' },
        );
        if (!res.ok || cancelled) return;
        const json = (await res.json().catch(() => ({ slots: [] }))) as { slots: ImageSlot[] };
        if (!cancelled) setSlots(Array.isArray(json.slots) ? json.slots : []);
      } catch {
        /* non-fatal */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [componentId]);

  if (!loaded || slots.length === 0) return null;

  return (
    <section className="mt-8" id="image-slots">
      <h2 className="mb-1 text-sm font-semibold">Image sizing guide</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Recommended dimensions for each image slot, extracted from the Figma design.
      </p>
      <div className="space-y-3">
        {slots.map((slot) => {
          const hasRatio = slot.aspectRatioW && slot.aspectRatioH;
          const hasSize  = slot.recommendedWidth && slot.recommendedHeight;
          const scaleLabel = slot.scaleMode ? SCALE_MODE_LABELS[slot.scaleMode] ?? slot.scaleMode : null;

          return (
            <div
              key={slot.id}
              className="flex gap-4 rounded-lg border border-border bg-card p-4"
            >
              {hasRatio && (
                <AspectRatioBox w={slot.aspectRatioW!} h={slot.aspectRatioH!} />
              )}
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{slot.slotName}</span>
                  {hasRatio && (
                    <Badge variant="secondary" className="font-mono text-xs">
                      {slot.aspectRatioW}:{slot.aspectRatioH}
                    </Badge>
                  )}
                  {slot.isResponsive && (
                    <Badge variant="outline" className="text-xs">Responsive</Badge>
                  )}
                  {slot.scaleMode && (
                    <Badge variant="outline" className="text-xs">{slot.scaleMode}</Badge>
                  )}
                </div>

                <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  {hasSize && (
                    <span>
                      <span className="text-foreground font-medium">
                        {slot.recommendedWidth} × {slot.recommendedHeight} px
                      </span>
                      {' '}recommended
                    </span>
                  )}
                  {slot.minWidth && slot.minHeight && (
                    <span>
                      Min: {slot.minWidth} × {slot.minHeight} px
                    </span>
                  )}
                  {slot.minWidth && !slot.minHeight && (
                    <span>Min width: {slot.minWidth} px</span>
                  )}
                </div>

                {scaleLabel && (
                  <p className="text-xs text-muted-foreground">{scaleLabel}</p>
                )}

                {slot.nodeId && (
                  <p className="text-[11px] text-muted-foreground/60 font-mono">
                    Node: {slot.nodeId}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
