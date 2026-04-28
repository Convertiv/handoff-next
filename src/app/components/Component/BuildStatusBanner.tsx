'use client';

import { CheckCircle, Loader2, XCircle, Hammer } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { handoffApiUrl } from '../../lib/api-path';
import { Button } from '../ui/button';

type BuildJob = {
  id: number;
  componentId: string;
  status: string;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
};

type Props = {
  componentId: string;
  onBuildComplete?: () => void;
};

export function BuildStatusBanner({ componentId, onBuildComplete }: Props) {
  const [job, setJob] = useState<BuildJob | null>(null);
  const [polling, setPolling] = useState(false);
  const [triggerBusy, setTriggerBusy] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pollJob = useCallback(
    async (jobId: number) => {
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/components/build?jobId=${jobId}`), { credentials: 'include' });
        if (!res.ok) return;
        const data = (await res.json()) as BuildJob;
        setJob(data);
        if (data.status === 'queued' || data.status === 'building') {
          setPolling(true);
          timerRef.current = setTimeout(() => void pollJob(jobId), 1500);
        } else {
          setPolling(false);
          if (data.status === 'complete') {
            onBuildComplete?.();
          }
        }
      } catch {
        setPolling(false);
      }
    },
    [onBuildComplete]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const triggerBuild = async () => {
    setTriggerBusy(true);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/components/build'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ componentId }),
      });
      if (!res.ok) return;
      const { jobId } = (await res.json()) as { jobId: number };
      setJob({ id: jobId, componentId, status: 'queued', error: null, createdAt: new Date().toISOString(), completedAt: null });
      setPolling(true);
      timerRef.current = setTimeout(() => void pollJob(jobId), 1000);
    } catch {
      /* */
    } finally {
      setTriggerBusy(false);
    }
  };

  if (!job) {
    return (
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void triggerBuild()} disabled={triggerBusy} className="gap-1.5">
          <Hammer className="h-3.5 w-3.5" />
          {triggerBusy ? 'Queuing…' : 'Build preview'}
        </Button>
      </div>
    );
  }

  const statusUi = () => {
    switch (job.status) {
      case 'queued':
        return (
          <span className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Queued…
          </span>
        );
      case 'building':
        return (
          <span className="flex items-center gap-1.5 text-xs text-sky-700 dark:text-sky-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Building…
          </span>
        );
      case 'complete':
        return (
          <span className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle className="h-3.5 w-3.5" /> Build complete
          </span>
        );
      case 'failed':
        return (
          <span className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <XCircle className="h-3.5 w-3.5" /> Build failed
            </span>
            {job.error ? <span className="max-w-lg truncate text-[11px] text-red-500">{job.error}</span> : null}
          </span>
        );
      default:
        return <span className="text-xs text-gray-500">{job.status}</span>;
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      {statusUi()}
      {(job.status === 'complete' || job.status === 'failed') && (
        <Button type="button" variant="outline" size="sm" onClick={() => void triggerBuild()} disabled={triggerBusy || polling} className="gap-1.5">
          <Hammer className="h-3.5 w-3.5" />
          Rebuild
        </Button>
      )}
      <span className="text-[11px] text-gray-400">Job #{job.id}</span>
    </div>
  );
}
