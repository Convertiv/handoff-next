'use client';

import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { handoffApiUrl } from '@/lib/api-path';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip';

const POLL_INTERVAL_ACTIVE = 3_000;   // 3 s while builds are running
const POLL_INTERVAL_IDLE   = 20_000;  // 20 s when nothing is active

/**
 * Invisible when idle; shows a spinning badge (with count) when any build
 * task is active. Clicking navigates to /admin/builds.
 */
export function BuildBadge() {
  const { data: session } = useSession();
  const [active, setActive] = useState(false);
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Only admins get the badge — no-op for everyone else.
  const isAdmin = session?.user?.role === 'admin';

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

  useEffect(() => {
    if (!isAdmin) return;

    let cancelled = false;

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  if (!isAdmin || !active) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Link
            href="/admin/builds"
            className="relative flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
            aria-label={`${count} build${count !== 1 ? 's' : ''} in progress`}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {count > 1 && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
                {count > 9 ? '9+' : count}
              </span>
            )}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {count} build task{count !== 1 ? 's' : ''} running — click to view
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
