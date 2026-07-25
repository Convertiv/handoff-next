'use client';

import { Building2, Check, Globe, Lock, Users, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { VISIBILITY, VISIBILITY_META, type Visibility } from '@/lib/authz/vocab';

const VISIBILITY_ICON: Record<Visibility, LucideIcon> = {
  private: Lock,
  shared: Users,
  team: Building2,
  public: Globe,
};

export function VisibilityPicker({
  value,
  onChange,
  disabled,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1" role="radiogroup" aria-label="Visibility">
      {VISIBILITY.map((visibility) => {
        const meta = VISIBILITY_META[visibility];
        const Icon = VISIBILITY_ICON[visibility];
        const selected = visibility === value;
        return (
          <button
            key={visibility}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(visibility)}
            className={cn(
              'flex items-start gap-3 rounded-md border px-3 py-2 text-left text-sm transition-colors',
              selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted',
              disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex flex-1 flex-col">
              <span className="font-medium text-foreground">{meta.label}</span>
              <span className="text-xs text-muted-foreground">{meta.desc}</span>
            </span>
            {selected ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );
}

export default VisibilityPicker;
