'use client';

import { cn } from '@/lib/utils';
import { LANES, LANE_META, type Lane } from '@/lib/authz/vocab';

export function LaneTabs({
  value,
  onChange,
  counts,
}: {
  value: Lane;
  onChange: (l: Lane) => void;
  counts?: Partial<Record<Lane, number>>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Library lanes"
      className="inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground"
    >
      {LANES.map((lane) => {
        const active = lane === value;
        const count = counts?.[lane];
        return (
          <button
            key={lane}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(lane)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'bg-background text-foreground shadow-sm' : 'hover:text-foreground',
            )}
          >
            {LANE_META[lane].label}
            {typeof count === 'number' ? (
              <span
                className={cn(
                  'inline-flex min-w-4 items-center justify-center rounded px-1 text-xs',
                  active ? 'bg-muted text-muted-foreground' : 'bg-background/60 text-muted-foreground',
                )}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export default LaneTabs;
