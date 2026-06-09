'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Layers, Star } from 'lucide-react';
import { Badge } from '@handoff/app/components/ui/badge';
import { Button } from '@handoff/app/components/ui/button';
import { useChatContext } from './ChatContext';
import type { ComponentCardRef } from './ChatContext';

interface Props {
  components: ComponentCardRef[];
  recommendation?: string;
  recommendationReason?: string;
  basePath?: string;
  onClose?: () => void;
}

export function ChatComponentGrid({ components, recommendation, recommendationReason, basePath = '', onClose }: Props) {
  const router = useRouter();
  const { sendMessage } = useChatContext();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (components.length === 0) return null;

  // Sort: recommendation first
  const sorted = [...components].sort((a, b) => {
    if (a.id === recommendation) return -1;
    if (b.id === recommendation) return 1;
    return 0;
  });

  return (
    <div className="mt-2 w-full">
      {/* Recommendation callout */}
      {recommendation && recommendationReason && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800/50 dark:bg-amber-950/30">
          <Star className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            <span className="font-semibold">Recommended: </span>
            {recommendationReason}
          </p>
        </div>
      )}

      {/* Card grid */}
      <div className="grid grid-cols-2 gap-2">
        {sorted.map((comp) => {
          const isRecommended = comp.id === recommendation;
          const isHovered = hoveredId === comp.id;

          return (
            <div
              key={comp.id}
              onMouseEnter={() => setHoveredId(comp.id)}
              onMouseLeave={() => setHoveredId(null)}
              className={`group relative flex flex-col overflow-hidden rounded-xl border transition-all ${
                isRecommended
                  ? 'border-amber-400 ring-1 ring-amber-400/50 dark:border-amber-600'
                  : 'border-border'
              } bg-card hover:border-primary/50 hover:shadow-md`}
            >
              {/* Screenshot */}
              <div className="relative aspect-video w-full overflow-hidden bg-muted/40">
                {comp.screenshotUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={comp.screenshotUrl.startsWith('http') ? comp.screenshotUrl : `${basePath}${comp.screenshotUrl}`}
                    alt={comp.title}
                    className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                      (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty('display', 'flex');
                    }}
                  />
                ) : null}
                {/* Placeholder shown when no screenshot or image load error */}
                <div
                  className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted-foreground"
                  style={{ display: comp.screenshotUrl ? 'none' : 'flex' }}
                >
                  <Layers className="h-6 w-6 opacity-40" />
                </div>

                {/* Recommended badge overlay */}
                {isRecommended && (
                  <div className="absolute left-2 top-2">
                    <Badge className="flex items-center gap-1 bg-amber-500 text-[10px] text-white hover:bg-amber-500">
                      <Star className="h-2.5 w-2.5 fill-current" />
                      Recommended
                    </Badge>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="flex flex-1 flex-col gap-1 p-2.5">
                <div className="flex items-start justify-between gap-1">
                  <p className="line-clamp-1 text-xs font-semibold leading-tight">{comp.title}</p>
                </div>
                {comp.group && (
                  <p className="text-[10px] text-muted-foreground">{comp.group}</p>
                )}
                {comp.description && (
                  <p className="line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{comp.description}</p>
                )}
              </div>

              {/* Actions — visible on hover */}
              <div
                className={`flex gap-1.5 border-t border-border/60 px-2.5 py-2 transition-all ${
                  isHovered ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 flex-1 px-1.5 text-[11px]"
                  onClick={() => {
                    sendMessage(`The ${comp.title} looks good. Let's use that as the basis.`);
                  }}
                >
                  Select
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0"
                  title="View component details"
                  onClick={() => {
                    router.push(`${basePath}/system/component/${encodeURIComponent(comp.id)}`);
                    onClose?.();
                  }}
                >
                  <ArrowRight className="h-3 w-3" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
