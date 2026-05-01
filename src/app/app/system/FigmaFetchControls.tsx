'use client';

import { CheckCircle, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { signIn, useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { handoffApiUrl } from '../../lib/api-path';

type FetchJob = {
  id: number;
  status: 'queued' | 'running' | 'complete' | 'failed' | string;
  error: string | null;
};

type StatusPayload = {
  connected: boolean;
  oauthConfigured: boolean;
};

export function FigmaFetchControls() {
  const { data: session, status } = useSession();
  const canUse = status === 'authenticated' && Boolean(session?.user) && session?.user?.role === 'admin';

  const [connected, setConnected] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [job, setJob] = useState<FetchJob | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const refreshStatus = async () => {
    setLoadingStatus(true);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/figma/fetch'), { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as StatusPayload;
      setConnected(Boolean(data.connected));
      setOauthConfigured(Boolean(data.oauthConfigured));
    } finally {
      setLoadingStatus(false);
    }
  };

  const pollJob = async (jobId: number) => {
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/figma/fetch?jobId=${jobId}`), { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as FetchJob;
      setJob(data);
      if (data.status === 'queued' || data.status === 'running') {
        timerRef.current = setTimeout(() => void pollJob(jobId), 1500);
      } else if (data.status === 'complete') {
        setMessage('Figma fetch complete. Token pages now use the updated snapshot.');
        void refreshStatus();
      } else if (data.status === 'failed') {
        setMessage(data.error ?? 'Figma fetch failed.');
      }
    } catch {
      /* ignore transient polling errors */
    }
  };

  const triggerFetch = async () => {
    setTriggerBusy(true);
    setMessage(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/figma/fetch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = (await res.json()) as { jobId?: number; error?: string };
      if (!res.ok) {
        setMessage(data.error ?? 'Failed to queue Figma fetch.');
        return;
      }
      if (!data.jobId) {
        setMessage('No fetch job id returned.');
        return;
      }
      setJob({ id: data.jobId, status: 'queued', error: null });
      timerRef.current = setTimeout(() => void pollJob(data.jobId as number), 1000);
    } catch {
      setMessage('Failed to queue Figma fetch.');
    } finally {
      setTriggerBusy(false);
    }
  };

  const connectFigma = async () => {
    setMessage(null);
    await signIn('figma', { callbackUrl: window.location.href });
  };

  useEffect(() => {
    if (canUse) {
      void refreshStatus();
    }
  }, [canUse]);

  if (!canUse) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => void connectFigma()}
        disabled={!oauthConfigured}
      >
        {connected ? <RefreshCw className="h-3.5 w-3.5" /> : <Unplug className="h-3.5 w-3.5" />}
        {connected ? 'Reconnect Figma' : 'Connect Figma'}
      </Button>

      <Button
        type="button"
        variant="default"
        size="sm"
        className="gap-1.5"
        onClick={() => void triggerFetch()}
        disabled={triggerBusy || !connected || job?.status === 'queued' || job?.status === 'running'}
      >
        {(triggerBusy || job?.status === 'queued' || job?.status === 'running') ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <CheckCircle className="h-3.5 w-3.5" />
        )}
        {(job?.status === 'queued' || job?.status === 'running') ? 'Fetching…' : 'Run Figma Fetch'}
      </Button>

      {loadingStatus ? <span className="text-xs text-muted-foreground">Checking Figma status…</span> : null}
      {!oauthConfigured ? <span className="text-xs text-amber-600">Set AUTH_FIGMA_ID/SECRET on server.</span> : null}
      {message ? <span className="text-xs text-muted-foreground">{message}</span> : null}
      {job?.status === 'failed' && job.error ? <span className="text-xs text-red-600">{job.error}</span> : null}
    </div>
  );
}
