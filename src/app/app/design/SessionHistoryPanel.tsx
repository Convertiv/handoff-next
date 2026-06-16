'use client';

import { DownloadIcon, ExternalLinkIcon, XIcon } from 'lucide-react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { GeneratedImage } from './workbench-types';

type Props = {
  image: GeneratedImage | null;
  onClose: () => void;
  onSetAsCanvas: (image: GeneratedImage) => void;
  onSaveForReview: (image: GeneratedImage) => void;
  onDownload: (src: string) => void;
  basePath: string;
};

const STAGE_LABELS: Record<string, string> = {
  preparing: 'Preparing assets…',
  building_prompt: 'Building prompt…',
  generating: 'Generating design…',
};

function formatTs(ts: string | undefined): string {
  if (!ts) return '';
  try { return new Date(ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); } catch { return ts; }
}

export default function SessionHistoryPanel({ image, onClose, onSetAsCanvas, onSaveForReview, onDownload, basePath }: Props) {
  return (
    <Sheet open={Boolean(image)} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full max-w-sm flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-sm font-semibold">Generation detail</SheetTitle>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        </SheetHeader>

        {image ? (
          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
            {/* Image preview */}
            <div className="overflow-hidden rounded-lg border bg-muted/20">
              {image.status === 'completed' && image.src ? (
                <Image
                  src={image.src}
                  alt={image.prompt}
                  width={512}
                  height={512}
                  unoptimized
                  className="w-full object-contain"
                />
              ) : (
                <div
                  className={`aspect-square w-full ${
                    image.status === 'error'
                      ? 'flex items-center justify-center bg-destructive/10 text-sm text-destructive'
                      : 'animate-pulse bg-muted'
                  }`}
                >
                  {image.status === 'error' ? (image.error || 'Generation failed.') : null}
                  {image.status === 'pending' && image.stage ? (
                    <span className="flex h-full items-end justify-center pb-3 text-xs text-muted-foreground">
                      {STAGE_LABELS[image.stage] ?? image.stage}
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            {/* Prompt */}
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase text-muted-foreground">Prompt</p>
              <p className="text-sm leading-relaxed">{image.prompt}</p>
            </div>

            {/* Metadata */}
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>Status: <strong className="text-foreground">{image.status}</strong></span>
              {image.ts || image.createdAt ? <span>{formatTs(image.ts ?? image.createdAt)}</span> : null}
              {image.jobId ? <span>Job #{image.jobId}</span> : null}
              {image.artifactId ? (
                <a
                  href={`${basePath}/design/library/${encodeURIComponent(image.artifactId)}/`}
                  className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View draft <ExternalLinkIcon className="h-3 w-3" />
                </a>
              ) : null}
            </div>

            {/* Actions */}
            {image.status === 'completed' && image.src ? (
              <div className="mt-auto flex flex-col gap-2">
                <Button className="w-full" onClick={() => { onSetAsCanvas(image); onClose(); }}>
                  Set as canvas
                </Button>
                <Button variant="secondary" className="w-full" onClick={() => { onSaveForReview(image); onClose(); }}>
                  Save for review
                </Button>
                <Button variant="outline" className="w-full" onClick={() => onDownload(image.src!)}>
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  Download
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
