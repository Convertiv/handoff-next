'use client';

import Image from 'next/image';
import { cn } from '@/lib/utils';

type Owner = { id: string; name?: string | null; image?: string | null } | null;

function initialsFrom(owner: NonNullable<Owner>): string {
  const source = owner.name?.trim() || owner.id;
  if (!source) return '?';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

// Deterministic color pick from a stable id so the same owner reads consistently.
const AVATAR_COLORS = [
  'bg-rose-500',
  'bg-orange-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-teal-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-violet-500',
  'bg-fuchsia-500',
];

function colorFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function OwnerAvatar({ owner, className }: { owner: Owner; className?: string }) {
  if (owner?.image) {
    return (
      <Image
        src={owner.image}
        alt={owner.name || 'Owner'}
        width={24}
        height={24}
        unoptimized
        className={cn('h-6 w-6 shrink-0 rounded-full object-cover', className)}
      />
    );
  }

  if (!owner) {
    return (
      <span
        className={cn(
          'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground',
          className,
        )}
        aria-hidden
      >
        ?
      </span>
    );
  }

  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium text-white',
        colorFor(owner.id),
        className,
      )}
      aria-hidden
    >
      {initialsFrom(owner)}
    </span>
  );
}

export function OwnerAttribution({
  owner,
  isMe,
  editedLabel,
  hideAvatar,
  className,
}: {
  owner: Owner;
  isMe: boolean;
  editedLabel?: string;
  hideAvatar?: boolean;
  className?: string;
}) {
  const name = owner?.name?.trim() || 'teammate';
  return (
    <div className={cn('flex items-center gap-2 text-sm text-muted-foreground', className)}>
      {hideAvatar ? null : <OwnerAvatar owner={owner} />}
      <span>
        {isMe ? <span className="text-foreground">You</span> : <>by {name}</>}
        {editedLabel ? <span className="text-muted-foreground"> · edited {editedLabel}</span> : null}
      </span>
    </div>
  );
}

export default OwnerAttribution;
