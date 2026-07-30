'use client';

import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PlaygroundComponent } from './types';
import { componentThumbnailUrl } from '@/lib/component-thumbnail';

interface ComponentCardProps {
  component: PlaygroundComponent;
  onAdd: (component: PlaygroundComponent) => void | Promise<void>;
}

export default function ComponentCard({ component, onAdd }: ComponentCardProps) {
  const [adding, setAdding] = useState(false);
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

  return (
    <button
      type="button"
      disabled={adding}
      onClick={async () => {
        setAdding(true);
        try {
          await onAdd(component);
        } finally {
          setAdding(false);
        }
      }}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-lg border text-left transition-all',
        'hover:border-primary/30 hover:shadow-md',
        'disabled:pointer-events-none'
      )}
    >
      <div className="relative aspect-[4/3] bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={componentThumbnailUrl(component.id, basePath)}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
        />
        {adding ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md">
              <Plus className="h-3.5 w-3.5" />
              Add
            </span>
          </div>
        )}
      </div>
      <div className="p-3">
        <h4 className="text-sm font-medium">{component.title}</h4>
        {component.description && (
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{component.description}</p>
        )}
      </div>
    </button>
  );
}
