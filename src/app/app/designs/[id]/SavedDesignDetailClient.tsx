'use client';

import type { ClientConfig } from '@handoff/types/config';
import { ArrowLeft, ExternalLink, Link2Icon, Loader2Icon, RefreshCwIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '../../../components/Layout/Main';
import { handoffApiUrl } from '../../../lib/api-path';
import type { Metadata, SectionLink } from '../../../components/util';
import { Button } from '../../../components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../../components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../../components/ui/tooltip';
import { GenerateComponentModal } from './GenerateComponentModal';

export type SavedDesignArtifactDetail = {
  id: string;
  title: string;
  description: string;
  status: string;
  userId: string;
  imageUrl: string;
  sourceImages: unknown;
  componentGuides: unknown;
  foundationContext: unknown;
  conversationHistory: unknown;
  metadata: unknown;
  assets?: { label: string; imageUrl: string; prompt?: string }[];
  assetsStatus?: string;
  publicAccess?: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

type Props = {
  config: ClientConfig;
  menu: SectionLink[];
  metadata: Metadata;
  artifactId: string;
  message?: string;
};

function formatDate(value: string | Date | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function lastUserPrompt(history: unknown): string | null {
  if (!Array.isArray(history)) return null;
  let last: string | null = null;
  for (const turn of history) {
    if (!turn || typeof turn !== 'object') continue;
    const o = turn as Record<string, unknown>;
    if (o.role === 'user' && typeof o.prompt === 'string' && o.prompt.trim()) last = o.prompt.trim();
  }
  return last;
}

function extractionErrorFromMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const e = (metadata as Record<string, unknown>).assetsExtractionError;
  return typeof e === 'string' && e.trim() ? e.trim() : null;
}

/** Normalize API row (camelCase or rare snake_case) for client state. */
function normalizeArtifactDetail(raw: SavedDesignArtifactDetail | Record<string, unknown>): SavedDesignArtifactDetail {
  const r = raw as Record<string, unknown>;
  const base = raw as SavedDesignArtifactDetail;
  const assetsStatusRaw = r.assetsStatus ?? r.assets_status;
  const publicRaw = r.publicAccess ?? r.public_access;
  const assetsRaw = r.assets;
  return {
    ...base,
    assetsStatus: typeof assetsStatusRaw === 'string' ? assetsStatusRaw : base.assetsStatus,
    publicAccess: typeof publicRaw === 'boolean' ? publicRaw : Boolean(publicRaw),
    assets: Array.isArray(assetsRaw) ? (assetsRaw as SavedDesignArtifactDetail['assets']) : base.assets,
  };
}

const POLL_MS = 5000;
const POLL_MAX = 48;

const GEN_POLL_MS = 4000;

export type ComponentGenerationJobRow = {
  id: number;
  artifactId: string;
  componentId: string;
  renderer: string;
  status: string;
  iteration: number | null;
  maxIterations: number | null;
  visualScore: string | number | null;
  error: string | null;
  generationLog?: unknown;
  validationResults?: unknown;
  createdAt?: string | Date | null;
  completedAt?: string | Date | null;
};

function isGenJobTerminal(status: string): boolean {
  return status === 'complete' || status === 'failed';
}

const STATUS_STYLES: Record<string, string> = {
  queued: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  generating: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  building: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300',
  validating: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  iterating: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300',
  complete: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300',
};

function GenStatusBadge({ status }: { status: string }) {
  const cls = STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

type LogEntry = { action?: string; iter?: number; error?: string; msg?: string; score?: number; differences?: string[]; a11yPassed?: boolean; buildJobId?: number; t?: string };

const ACTION_LABELS: Record<string, string> = {
  llm_generated: 'LLM generated component code',
  build_ok: 'Vite build succeeded',
  build_failed: 'Vite build failed',
  screenshot_failed: 'Preview screenshot failed',
  compare: 'Visual comparison',
};

function GenerationLog({ log, status }: { log?: unknown; status: string }) {
  const entries = Array.isArray(log) ? (log as LogEntry[]) : [];
  if (entries.length === 0 && isGenJobTerminal(status)) return null;

  return (
    <Collapsible defaultOpen={!isGenJobTerminal(status)} className="mt-2 rounded-md border">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/50">
        Build log ({entries.length} {entries.length === 1 ? 'step' : 'steps'})
        {!isGenJobTerminal(status) && entries.length > 0 ? <Loader2Icon className="h-3 w-3 animate-spin" /> : null}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="max-h-64 overflow-y-auto border-t px-3 py-2">
          {entries.length === 0 ? (
            <p className="py-2 text-xs text-muted-foreground">Waiting for first step…</p>
          ) : (
            <ol className="space-y-1.5">
              {entries.map((e, i) => (
                <li key={i} className="text-xs leading-relaxed">
                  <span className="font-mono text-muted-foreground">{e.iter ? `[${e.iter}]` : '   '}</span>{' '}
                  <span className={e.action === 'build_failed' || e.action === 'screenshot_failed' ? 'text-destructive' : ''}>
                    {ACTION_LABELS[e.action ?? ''] ?? e.action ?? 'step'}
                  </span>
                  {e.action === 'compare' && e.score != null ? (
                    <span className="ml-1 text-muted-foreground">
                      — score {e.score.toFixed(2)}{e.a11yPassed === false ? ', a11y issues' : ''}
                    </span>
                  ) : null}
                  {e.action === 'compare' && e.differences && e.differences.length > 0 ? (
                    <ul className="ml-6 mt-0.5 list-disc text-muted-foreground">
                      {e.differences.slice(0, 5).map((d, j) => <li key={j}>{d}</li>)}
                      {e.differences.length > 5 ? <li>…and {e.differences.length - 5} more</li> : null}
                    </ul>
                  ) : null}
                  {e.action === 'build_ok' && e.buildJobId ? (
                    <span className="ml-1 text-muted-foreground">— build #{e.buildJobId}</span>
                  ) : null}
                  {(e.error || e.msg) ? (
                    <span className="ml-1 text-destructive">— {e.error || e.msg}</span>
                  ) : null}
                  {e.t ? <span className="ml-2 text-muted-foreground/60">{new Date(e.t).toLocaleTimeString()}</span> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function assetsStatusOf(a: SavedDesignArtifactDetail | null): string {
  if (!a) return 'none';
  const r = a as Record<string, unknown>;
  const s = a.assetsStatus ?? r.assets_status;
  return typeof s === 'string' && s.trim() ? s.trim() : 'none';
}

export default function SavedDesignDetailClient({ config, menu, metadata, artifactId, message }: Props) {
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const [artifact, setArtifact] = useState<SavedDesignArtifactDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [reextractBusy, setReextractBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [extractionTimedOut, setExtractionTimedOut] = useState(false);
  const pollTicksRef = useRef(0);
  const [genModalOpen, setGenModalOpen] = useState(false);
  const [genJob, setGenJob] = useState<ComponentGenerationJobRow | null>(null);

  const fetchArtifact = useCallback(async () => {
    if (message || !artifactId) return null;
    const res = await fetch(handoffApiUrl(`/api/handoff/ai/design-artifact/${encodeURIComponent(artifactId)}`), {
      credentials: 'include',
    });
    const json = (await res.json().catch(() => ({}))) as { artifact?: SavedDesignArtifactDetail; error?: string };
    if (!res.ok) throw new Error(json.error || `Failed to load (${res.status})`);
    if (!json.artifact) throw new Error('Design not found.');
    return normalizeArtifactDetail(json.artifact as Record<string, unknown>);
  }, [artifactId, message]);

  useEffect(() => {
    if (message || !artifactId) {
      setLoaded(true);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    (async () => {
      setError(null);
      try {
        const a = await fetchArtifact();
        if (!cancelled) setArtifact(a);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [artifactId, message, fetchArtifact]);

  const fetchGenJob = useCallback(
    async (opts?: { jobId?: number }) => {
      if (message || !artifactId) return;
      const q =
        typeof opts?.jobId === 'number' && opts.jobId > 0
          ? `jobId=${encodeURIComponent(String(opts.jobId))}`
          : `artifactId=${encodeURIComponent(artifactId)}`;
      const res = await fetch(handoffApiUrl(`/api/handoff/ai/generate-component?${q}`), { credentials: 'include' });
      const json = (await res.json().catch(() => ({}))) as { job?: ComponentGenerationJobRow | null; error?: string };
      if (!res.ok) return;
      setGenJob(json.job ?? null);
    },
    [artifactId, message]
  );

  useEffect(() => {
    if (message || !artifactId) return;
    void fetchGenJob();
  }, [artifactId, message, fetchGenJob]);

  const genNeedsPoll = Boolean(genJob && !isGenJobTerminal(genJob.status));
  useEffect(() => {
    if (!genNeedsPoll) return;
    const id = window.setInterval(() => {
      void fetchGenJob({ jobId: genJob?.id });
    }, GEN_POLL_MS);
    return () => window.clearInterval(id);
  }, [genNeedsPoll, genJob?.id, fetchGenJob]);

  const assetsStatus = assetsStatusOf(artifact);
  const shouldPoll = Boolean(
    artifact && (assetsStatus === 'pending' || assetsStatus === 'extracting') && !extractionTimedOut
  );

  useEffect(() => {
    if (!shouldPoll) {
      pollTicksRef.current = 0;
      return;
    }
    const id = window.setInterval(() => {
      void (async () => {
        pollTicksRef.current += 1;
        if (pollTicksRef.current > POLL_MAX) {
          setExtractionTimedOut(true);
          return;
        }
        try {
          const a = await fetchArtifact();
          if (a) setArtifact(a);
        } catch {
          /* keep last artifact */
        }
      })();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [shouldPoll, fetchArtifact]);

  useEffect(() => {
    if (assetsStatus === 'done' || assetsStatus === 'failed' || assetsStatus === 'none') {
      setExtractionTimedOut(false);
      pollTicksRef.current = 0;
    }
  }, [assetsStatus]);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined' || !artifactId) return '';
    return `${window.location.origin}${basePath}/designs/${encodeURIComponent(artifactId)}/share`;
  }, [artifactId, basePath]);

  const handleShare = async () => {
    if (!artifactId) return;
    setNotice(null);
    setShareBusy(true);
    try {
      if (!artifact?.publicAccess) {
        const res = await fetch(handoffApiUrl('/api/handoff/ai/design-artifact'), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ id: artifactId, publicAccess: true }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error || 'Could not enable sharing.');
        setArtifact((prev) => (prev ? { ...prev, publicAccess: true } : prev));
      }
      const url = shareUrl || `${window.location.origin}${basePath}/designs/${encodeURIComponent(artifactId)}/share`;
      await navigator.clipboard.writeText(url);
      setNotice('Share link copied to clipboard.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not copy link.');
    } finally {
      setShareBusy(false);
    }
  };

  const handleRevokeShare = async () => {
    if (!artifactId) return;
    setNotice(null);
    setShareBusy(true);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/ai/design-artifact'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: artifactId, publicAccess: false }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not update sharing.');
      setArtifact((prev) => (prev ? { ...prev, publicAccess: false } : prev));
      setNotice('Public link disabled.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      setShareBusy(false);
    }
  };

  const handleRetryExtraction = async () => {
    if (!artifactId) return;
    setReextractBusy(true);
    setNotice(null);
    setExtractionTimedOut(false);
    pollTicksRef.current = 0;
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/ai/design-artifact'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: artifactId, extractAssets: true }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        extractionImmediate?: boolean;
        assets?: SavedDesignArtifactDetail['assets'];
        assetsStatus?: string;
      };
      if (!res.ok) throw new Error(json.error || 'Could not queue extraction.');
      if (json.extractionImmediate && Array.isArray(json.assets)) {
        setArtifact((prev) =>
          prev
            ? {
                ...prev,
                assetsStatus: typeof json.assetsStatus === 'string' ? json.assetsStatus : 'done',
                assets: json.assets,
              }
            : prev
        );
        setNotice('Asset extraction finished.');
      } else {
        setArtifact((prev) => (prev ? { ...prev, assetsStatus: 'pending', assets: [] } : prev));
        setNotice('Asset extraction queued. This page will update when ready.');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Retry failed.');
    } finally {
      setReextractBusy(false);
    }
  };

  const lastPrompt = artifact ? lastUserPrompt(artifact.conversationHistory) : null;
  const assets = Array.isArray(artifact?.assets) ? artifact!.assets! : [];
  const extractErr = artifact ? extractionErrorFromMetadata(artifact.metadata) : null;

  return (
    <TooltipProvider delayDuration={300}>
      <Layout config={config} menu={menu} current={null} metadata={{ metaTitle: metadata.metaTitle, metaDescription: metadata.metaDescription }}>
        <div className="mx-auto max-w-4xl space-y-6 pb-12">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" asChild>
              <Link href={`${basePath}/designs/`}>
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                All saved designs
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`${basePath}/design/`}>Workbench</Link>
            </Button>
          </div>

          {message ? <p className="text-sm text-amber-700 dark:text-amber-400">{message}</p> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {notice ? <p className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p> : null}

          {!message && !loaded ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : null}

          {loaded && !message && !error && !artifact ? (
            <p className="text-sm text-muted-foreground">This design could not be loaded.</p>
          ) : null}

          {artifact ? (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight">{artifact.title || 'Untitled'}</h1>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium uppercase text-muted-foreground">{artifact.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Updated {formatDate(artifact.updatedAt)} · Created {formatDate(artifact.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={shareBusy} onClick={() => void handleShare()}>
                    {shareBusy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <Link2Icon className="mr-1 h-4 w-4" />}
                    Share link
                  </Button>
                  {artifact.publicAccess ? (
                    <Button type="button" variant="ghost" size="sm" disabled={shareBusy} onClick={() => void handleRevokeShare()}>
                      Stop sharing
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`${basePath}/design?loadArtifact=${encodeURIComponent(artifact.id)}`}>
                      <ExternalLink className="mr-1 h-4 w-4" />
                      Open in workbench
                    </Link>
                  </Button>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setGenModalOpen(true)}>
                    Generate component
                  </Button>
                </div>
              </div>

              <GenerateComponentModal
                open={genModalOpen}
                onOpenChange={setGenModalOpen}
                artifactId={artifactId}
                hasExtractedAssets={assetsStatus === 'done' && assets.length > 0}
                onJobStarted={(jobId) => {
                  void fetchGenJob({ jobId });
                }}
              />

              {artifact.description ? (
                <div className="rounded-lg border bg-muted/30 px-4 py-3">
                  <p className="text-sm whitespace-pre-wrap text-foreground/90">{artifact.description}</p>
                </div>
              ) : null}

              {lastPrompt ? (
                <div className="rounded-lg border bg-background px-4 py-3">
                  <p className="text-xs font-medium uppercase text-muted-foreground">Last prompt</p>
                  <p className="mt-1 text-sm whitespace-pre-wrap text-foreground/90">{lastPrompt}</p>
                </div>
              ) : null}

              <div className="overflow-hidden rounded-xl border bg-muted/20">
                {artifact.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={artifact.imageUrl} alt={artifact.title || 'Design'} className="mx-auto max-h-[min(85vh,1200px)] w-full object-contain" />
                ) : (
                  <p className="p-8 text-center text-sm text-muted-foreground">No image stored.</p>
                )}
              </div>

              <section className="space-y-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Extracted assets</h2>
                  {assetsStatus === 'failed' || assetsStatus === 'none' || assetsStatus === 'done' || extractionTimedOut ? (
                    <Button type="button" variant="outline" size="sm" disabled={reextractBusy} onClick={() => void handleRetryExtraction()}>
                      {reextractBusy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <RefreshCwIcon className="mr-1 h-4 w-4" />}
                      {assetsStatus === 'none' ? 'Extract assets' : 'Retry extraction'}
                    </Button>
                  ) : null}
                </div>
                {assetsStatus === 'pending' || assetsStatus === 'extracting' ? (
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                      Extracting assets… This can take a minute.
                    </div>
                    {extractionTimedOut ? (
                      <p className="text-destructive">
                        Extraction is taking longer than expected. Click <strong>Retry extraction</strong> above, or save again from the workbench.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {assetsStatus === 'failed' ? (
                  <p className="text-sm text-destructive">{extractErr || 'Extraction failed.'}</p>
                ) : null}
                {assetsStatus === 'none' ? (
                  <p className="text-sm text-muted-foreground">No extraction has run for this design yet. Click the button above to extract background assets.</p>
                ) : null}
                {assetsStatus === 'done' && assets.length > 0 ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {assets.map((a, i) => (
                      <div key={`${a.label}-${i}`} className="overflow-hidden rounded-md border bg-card">
                        <p className="border-b px-3 py-2 text-xs font-medium">{a.label}</p>
                        <div className="bg-muted/20 p-2">
                          {a.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={a.imageUrl} alt={a.label} className="mx-auto max-h-72 w-full object-contain" />
                          ) : null}
                        </div>
                        {a.prompt ? (
                          <Collapsible className="border-t">
                            <CollapsibleTrigger className="w-full px-3 py-2 text-left text-xs text-muted-foreground hover:bg-muted/50">
                              Extraction prompt
                            </CollapsibleTrigger>
                            <CollapsibleContent className="px-3 pb-2">
                              <pre className="max-h-32 overflow-auto rounded bg-muted/50 p-2 text-[10px] leading-snug">{a.prompt}</pre>
                            </CollapsibleContent>
                          </Collapsible>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {assetsStatus === 'done' && assets.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No separate assets were returned.</p>
                ) : null}
              </section>

              <section className="space-y-2 rounded-lg border p-4">
                <h2 className="text-sm font-semibold">Component generation</h2>
                {!genJob ? (
                  <p className="text-sm text-muted-foreground">No generation job yet. Use Generate component above to create one.</p>
                ) : (
                  <div className="space-y-2 text-sm">
                    <p>
                      <span className="text-muted-foreground">Job</span> #{genJob.id} ·{' '}
                      <span className="font-mono">{genJob.componentId}</span> · {genJob.renderer}
                    </p>
                    <p>
                      <span className="text-muted-foreground">Status</span>{' '}
                      <GenStatusBadge status={genJob.status} />
                      {typeof genJob.iteration === 'number' ? ` · iteration ${genJob.iteration}/${genJob.maxIterations ?? 3}` : null}
                    </p>
                    {genJob.visualScore != null && genJob.visualScore !== '' ? (
                      <p>
                        <span className="text-muted-foreground">Visual score</span> {Number(genJob.visualScore).toFixed(2)}
                      </p>
                    ) : null}
                    {genJob.error ? (
                      <p className="text-destructive">
                        {genJob.status === 'complete' ? 'Note: ' : ''}
                        {genJob.error}
                      </p>
                    ) : null}
                    {genJob.status === 'complete' ? (
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`${basePath}/system/component/${encodeURIComponent(genJob.componentId)}/`}>Open component</Link>
                      </Button>
                    ) : null}
                    {!isGenJobTerminal(genJob.status) ? (
                      <p className="flex items-center gap-2 text-muted-foreground">
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                        Generation in progress…
                      </p>
                    ) : null}
                    <GenerationLog log={genJob.generationLog} status={genJob.status} />
                  </div>
                )}
              </section>

              <Collapsible className="rounded-lg border">
                <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-medium hover:bg-muted/50">
                  Saved context (JSON)
                </CollapsibleTrigger>
                <CollapsibleContent className="border-t px-4 py-3">
                  <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted/50 p-3 text-xs leading-relaxed">
                    {JSON.stringify(
                      {
                        componentGuides: artifact.componentGuides,
                        foundationContext: artifact.foundationContext,
                        conversationHistory: artifact.conversationHistory,
                        sourceImages: artifact.sourceImages,
                        metadata: artifact.metadata,
                        assets: artifact.assets,
                        assetsStatus: artifact.assetsStatus,
                        publicAccess: artifact.publicAccess,
                      },
                      null,
                      2
                    )}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            </>
          ) : null}
        </div>
      </Layout>
    </TooltipProvider>
  );
}
