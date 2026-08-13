'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KIND_META, SELECTABLE_KINDS, type PatternKind } from '@/lib/authz/vocab';

/**
 * Page or template — promotion and demotion (reflow R.1).
 *
 * **Two radio options, not a "Make this a template" button.** A button implies a one-way door and gives
 * demotion nowhere to live; a pair of options shows the current state and makes going back the same size of
 * act as going forward. Same shape as `VisibilityPicker` and `LifecyclePicker`, because it belongs to the
 * same question — what is this thing, and who is it for.
 *
 * `brief` is never offered. It is the transitional value migration 0029 writes for the snapshots the reflow
 * retires; a brief that reaches this control renders read-only rather than pretending to be convertible.
 */
export function KindPicker({
  value,
  onChange,
  disabled,
}: {
  value: PatternKind;
  onChange: (kind: PatternKind) => void;
  disabled?: boolean;
}) {
  if (value === 'brief') {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
        This is a legacy brief. It stays as it is.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1" role="radiogroup" aria-label="Page or template">
      {SELECTABLE_KINDS.map((kind) => {
        const meta = KIND_META[kind];
        const selected = kind === value;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(kind)}
            className={cn(
              'flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-left transition-colors',
              selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
              disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent'
            )}
          >
            <span className="flex flex-col gap-0.5">
              <span className="text-sm font-medium text-foreground">{meta.label}</span>
              <span className="text-xs leading-snug text-muted-foreground">{meta.sub}</span>
            </span>
            {selected ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

export default KindPicker;
