'use client';

import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { LIFECYCLE_META, type Lifecycle } from '@/lib/authz/vocab';

const LIFECYCLE_VARIANT: Record<Lifecycle, BadgeProps['variant']> = {
  prototype: 'outline',
  draft: 'info',
  review: 'warning',
  approved: 'green',
  archived: 'secondary',
};

export function LifecycleBadge({ status }: { status: Lifecycle }) {
  const variant = LIFECYCLE_VARIANT[status];
  const isGhost = status === 'prototype';
  return (
    <Badge
      variant={variant}
      className={cn(isGhost && 'border border-dashed border-muted-foreground/40 text-muted-foreground')}
    >
      {LIFECYCLE_META[status].short}
    </Badge>
  );
}

export default LifecycleBadge;
