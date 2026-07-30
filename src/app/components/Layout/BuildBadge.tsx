'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { handoffApiUrl } from '@/lib/api-path';
import { cn } from '../../lib/utils';

const POLL_INTERVAL_ACTIVE = 3_000;   // 3 s while builds are running
const POLL_INTERVAL_IDLE   = 20_000;  // 20 s when nothing is active

/** Polls the admin build status endpoint. Returns 0 for non-admins / when idle. */
function useActiveBuildCount(): number {
  const { data: session } = useSession();
  const [active, setActive] = useState(false);
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only admins get the badge — no-op for everyone else.
  const isAdmin = session?.user?.role === 'admin';

  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(handoffApiUrl('/api/admin/builds/status'), { credentials: 'include' });
        if (res.ok) {
          const data = (await res.json()) as { active: boolean; count: number };
          setActive(Boolean(data.active));
          setCount(Number(data.count ?? 0));
        }
      } catch {
        // swallow — badge simply stays hidden
      }
    };

    const schedule = (delay: number) => {
      timerRef.current = setTimeout(() => {
        if (cancelled) return;
        void poll().then(() => {
          if (!cancelled) {
            setActive((a) => {
              schedule(a ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE);
              return a;
            });
          }
        });
      }, delay);
    };

    // Initial fetch immediately
    void poll().then(() => {
      if (!cancelled) {
        setActive((a) => {
          schedule(a ? POLL_INTERVAL_ACTIVE : POLL_INTERVAL_IDLE);
          return a;
        });
      }
    });

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isAdmin]);

  return isAdmin && active ? count : 0;
}

/**
 * Count of running build tasks in a small black circle, shown next to the
 * "Builds" item in the account sidebar. Hidden when idle or for non-admins.
 */
export function BuildsCountBadge({ className }: { className?: string }) {
  const count = useActiveBuildCount();
  if (count < 1) return null;
  return (
    <span
      className={cn(
        'ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground',
        className
      )}
      aria-label={`${count} build${count !== 1 ? 's' : ''} in progress`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
