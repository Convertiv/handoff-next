'use client';

import { Building2, Globe, Lock, Users, type LucideIcon } from 'lucide-react';
import { VISIBILITY_META, type Visibility } from '@/lib/authz/vocab';

const VISIBILITY_ICON: Record<Visibility, LucideIcon> = {
  private: Lock,
  shared: Users,
  team: Building2,
  public: Globe,
};

export function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const Icon = VISIBILITY_ICON[visibility];
  const meta = VISIBILITY_META[visibility];
  return (
    <span className="inline-flex items-center gap-1 rounded border bg-muted px-2 py-0.5 text-xs font-normal text-muted-foreground">
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </span>
  );
}

export default VisibilityBadge;
