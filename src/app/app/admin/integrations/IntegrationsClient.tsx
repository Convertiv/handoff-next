'use client';

import { CheckCircle, ExternalLink, Loader2, RefreshCw, Unplug } from 'lucide-react';
import { signIn, useSession } from 'next-auth/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Layout from '../../../components/Layout/Main';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card';
import { handoffApiUrl } from '../../../lib/api-path';

type FetchJob = {
  id: number;
  status: 'queued' | 'running' | 'complete' | 'failed' | string;
  error: string | null;
};

type StatusPayload = {
  connected: boolean;
  oauthConfigured: boolean;
};

export default function IntegrationsClient({
  config,
  menu,
  message,
}: {
  config: any;
  menu: any;
  message?: string;
}) {
  const layoutMeta = { metaTitle: 'Integrations', metaDescription: 'Manage third-party integrations' };
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';

  const [connected, setConnected] = useState(false);
  const [oauthConfigured, setOauthConfigured] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [job, setJob] = useState<FetchJob | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const refreshStatus = useCallback(async () => {
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
  }, []);

  const pollJob = useCallback(async (jobId: number) => {
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/figma/fetch?jobId=${jobId}`), { credentials: 'include' });
      if (!res.ok) return;
      const data = (await res.json()) as FetchJob;
      setJob(data);
      if (data.status === 'queued' || data.status === 'running') {
        timerRef.current = setTimeout(() => void pollJob(jobId), 1500);
      } else if (data.status === 'complete') {
        setStatusMessage('Figma fetch complete. Token pages now use the updated snapshot.');
        void refreshStatus();
      } else if (data.status === 'failed') {
        setStatusMessage(data.error ?? 'Figma fetch failed.');
      }
    } catch {
      /* ignore transient polling errors */
    }
  }, [refreshStatus]);

  const triggerFetch = async () => {
    setTriggerBusy(true);
    setStatusMessage(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/figma/fetch'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = (await res.json()) as { jobId?: number; error?: string };
      if (!res.ok) {
        setStatusMessage(data.error ?? 'Failed to queue Figma fetch.');
        return;
      }
      if (!data.jobId) {
        setStatusMessage('No fetch job id returned.');
        return;
      }
      setJob({ id: data.jobId, status: 'queued', error: null });
      timerRef.current = setTimeout(() => void pollJob(data.jobId as number), 1000);
    } catch {
      setStatusMessage('Failed to queue Figma fetch.');
    } finally {
      setTriggerBusy(false);
    }
  };

  const connectFigma = async () => {
    setStatusMessage(null);
    await signIn('figma', { callbackUrl: window.location.href });
  };

  useEffect(() => {
    if (!message && isAdmin) {
      void refreshStatus();
    }
  }, [message, isAdmin, refreshStatus]);

  const jobActive = job?.status === 'queued' || job?.status === 'running';

  return (
    <Layout config={config} menu={menu} current={null} metadata={layoutMeta}>
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-1 text-xl font-semibold">Integrations</h1>
        <p className="mb-6 text-sm text-muted-foreground">Connect third-party services to enable additional features.</p>

        {message ? (
          <p className="text-sm text-muted-foreground">{message}</p>
        ) : (
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    <svg viewBox="0 0 38 57" className="h-5 w-5" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M19 28.5C19 23.2533 23.2533 19 28.5 19C33.7467 19 38 23.2533 38 28.5C38 33.7467 33.7467 38 28.5 38C23.2533 38 19 33.7467 19 28.5Z" fill="#1ABCFE"/>
                      <path d="M0 47.5C0 42.2533 4.25329 38 9.5 38H19V47.5C19 52.7467 14.7467 57 9.5 57C4.25329 57 0 52.7467 0 47.5Z" fill="#0ACF83"/>
                      <path d="M19 0V19H28.5C33.7467 19 38 14.7467 38 9.5C38 4.25329 33.7467 0 28.5 0H19Z" fill="#FF7262"/>
                      <path d="M0 9.5C0 14.7467 4.25329 19 9.5 19H19V0H9.5C4.25329 0 0 4.25329 0 9.5Z" fill="#F24E1E"/>
                      <path d="M0 28.5C0 33.7467 4.25329 38 9.5 38H19V19H9.5C4.25329 19 0 23.2533 0 28.5Z" fill="#A259FF"/>
                    </svg>
                  </div>
                  <div>
                    <CardTitle className="text-base">Figma</CardTitle>
                    <CardDescription>Connect your Figma account to fetch design tokens directly from the GUI.</CardDescription>
                  </div>
                </div>
                {loadingStatus ? (
                  <Badge variant="outline" className="gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Checking…
                  </Badge>
                ) : connected ? (
                  <Badge variant="outline" className="gap-1.5 border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400">
                    <CheckCircle className="h-3 w-3" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="gap-1.5 border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400">
                    <Unplug className="h-3 w-3" /> Not connected
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!oauthConfigured && !loadingStatus ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  <p className="font-medium">OAuth not configured</p>
                  <p className="mt-1">
                    Set <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs dark:bg-amber-900">AUTH_FIGMA_ID</code> and{' '}
                    <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs dark:bg-amber-900">AUTH_FIGMA_SECRET</code> in your
                    server environment variables to enable Figma OAuth.
                  </p>
                  <a
                    href="https://www.figma.com/developers/api#authentication"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-900 underline underline-offset-2 dark:text-amber-100"
                  >
                    Figma OAuth docs <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void connectFigma()}
                      disabled={!oauthConfigured || loadingStatus}
                    >
                      {connected ? <RefreshCw className="h-3.5 w-3.5" /> : <Unplug className="h-3.5 w-3.5" />}
                      {connected ? 'Reconnect Figma' : 'Connect Figma'}
                    </Button>

                    <Button
                      variant="default"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void triggerFetch()}
                      disabled={triggerBusy || !connected || jobActive || loadingStatus}
                    >
                      {triggerBusy || jobActive ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <CheckCircle className="h-3.5 w-3.5" />
                      )}
                      {jobActive ? 'Fetching…' : 'Run Figma Fetch'}
                    </Button>
                  </div>

                  {statusMessage ? (
                    <p className={`text-sm ${job?.status === 'failed' ? 'text-red-600' : 'text-muted-foreground'}`}>
                      {statusMessage}
                    </p>
                  ) : null}

                  {!connected && oauthConfigured && !loadingStatus ? (
                    <p className="text-sm text-muted-foreground">
                      Click <strong>Connect Figma</strong> to authorize Handoff to read your Figma files.
                      Once connected, you can fetch design tokens directly from the GUI.
                    </p>
                  ) : null}

                  {connected && !loadingStatus ? (
                    <p className="text-sm text-muted-foreground">
                      Your Figma account is linked. Click <strong>Run Figma Fetch</strong> to pull the latest
                      design tokens from your Figma project into Handoff.
                    </p>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
