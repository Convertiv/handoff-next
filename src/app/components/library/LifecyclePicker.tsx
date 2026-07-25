'use client';

import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LIFECYCLE, LIFECYCLE_META, type Lifecycle } from '@/lib/authz/vocab';

export function LifecyclePicker({
  value,
  onChange,
  canApprove,
  disabled,
}: {
  value: Lifecycle;
  onChange: (s: Lifecycle) => void;
  canApprove: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1" role="radiogroup" aria-label="Lifecycle status">
      {LIFECYCLE.map((status) => {
        const meta = LIFECYCLE_META[status];
        const selected = status === value;
        const lockedByRole = status === 'approved' && !canApprove;
        const optionDisabled = Boolean(disabled) || lockedByRole;
        return (
          <button
            key={status}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={optionDisabled}
            onClick={() => onChange(status)}
            className={cn(
              'flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors',
              selected ? 'border-primary bg-primary/5 text-foreground' : 'border-border text-foreground hover:bg-muted',
              optionDisabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
            )}
          >
            <span className="flex items-center gap-2">
              <span className="font-medium">{meta.label}</span>
              {lockedByRole ? (
                <span className="text-xs text-muted-foreground">Maintainer only</span>
              ) : null}
            </span>
            {selected ? <Check className="h-4 w-4 text-primary" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

export default LifecyclePicker;
