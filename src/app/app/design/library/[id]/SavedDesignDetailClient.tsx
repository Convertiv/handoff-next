'use client';

import type { ClientConfig } from '@handoff/types/config';
import { ArrowLeft, ExternalLink, Link2Icon, Loader2Icon, RefreshCwIcon, SparklesIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Layout from '@/components/Layout/Main';
import { handoffApiUrl } from '@/lib/api-path';
import type { Metadata, SectionLink } from '@/components/util';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';

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
  assets?: { key?: string; label: string; imageUrl: string; prompt?: string }[];
  assetsStatus?: string;
  publicAccess?: boolean;
  componentSpec?: unknown;
  componentSpecMd?: string;
  specStatus?: string;
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

function normalizeArtifactDetail(raw: SavedDesignArtifactDetail | Record<string, unknown>): SavedDesignArtifactDetail {
  const r = raw as Record<string, unknown>;
  const base = raw as SavedDesignArtifactDetail;
  const assetsStatusRaw = r.assetsStatus ?? r.assets_status;
  const publicRaw = r.publicAccess ?? r.public_access;
  const assetsRaw = r.assets;
  const specStatusRaw = r.specStatus ?? r.spec_status;
  const componentSpecMdRaw = r.componentSpecMd ?? r.component_spec_md;
  const componentSpecRaw = r.componentSpec ?? r.component_spec;
  return {
    ...base,
    assetsStatus: typeof assetsStatusRaw === 'string' ? assetsStatusRaw : base.assetsStatus,
    publicAccess: typeof publicRaw === 'boolean' ? publicRaw : Boolean(publicRaw),
    assets: Array.isArray(assetsRaw) ? (assetsRaw as SavedDesignArtifactDetail['assets']) : base.assets,
    specStatus: typeof specStatusRaw === 'string' ? specStatusRaw : base.specStatus,
    componentSpecMd: typeof componentSpecMdRaw === 'string' ? componentSpecMdRaw : base.componentSpecMd,
    componentSpec: componentSpecRaw ?? base.componentSpec,
  };
}

type ComponentMatch = {
  componentId: string;
  componentTitle: string;
  matchLevel: string;
  confidence: number;
  recommendation: string;
  sampleConfig?: Record<string, unknown>;
};

function bestComponentMatch(spec: unknown): ComponentMatch | null {
  if (!spec || typeof spec !== 'object') return null;
  const s = spec as Record<string, unknown>;
  const impl = s.implementation as Record<string, unknown> | undefined;
  if (!impl) return null;
  const matches = impl.existingComponentMatches;
  if (!Array.isArray(matches) || matches.length === 0) return null;
  const sorted = [...matches].sort((a, b) => {
    const ca = typeof (a as Record<string, unknown>).confidence === 'number' ? (a as Record<string, unknown>).confidence as number : 0;
    const cb = typeof (b as Record<string, unknown>).confidence === 'number' ? (b as Record<string, unknown>).confidence as number : 0;
    return cb - ca;
  });
  const best = sorted[0] as Record<string, unknown>;
  const confidence = typeof best.confidence === 'number' ? best.confidence : 0;
  if (confidence < 0.5) return null;
  return {
    componentId: typeof best.componentId === 'string' ? best.componentId : '',
    componentTitle: typeof best.componentTitle === 'string' ? best.componentTitle : '',
    matchLevel: typeof best.matchLevel === 'string' ? best.matchLevel : '',
    confidence,
    recommendation: typeof best.recommendation === 'string' ? best.recommendation : '',
    sampleConfig: typeof best.sampleConfig === 'object' && best.sampleConfig !== null ? best.sampleConfig as Record<string, unknown> : undefined,
  };
}

function assetsStatusOf(a: SavedDesignArtifactDetail | null): string {
  if (!a) return 'none';
  const r = a as Record<string, unknown>;
  const s = a.assetsStatus ?? r.assets_status;
  return typeof s === 'string' && s.trim() ? s.trim() : 'none';
}

function specStatusOf(a: SavedDesignArtifactDetail | null): string {
  if (!a) return 'none';
  const r = a as Record<string, unknown>;
  const s = a.specStatus ?? r.spec_status;
  return typeof s === 'string' && s.trim() ? s.trim() : 'none';
}

const POLL_MS = 5000;
const POLL_MAX = 48;
const SPEC_POLL_MS = 4000;
const SPEC_POLL_MAX = 60;

type Tab = 'overview' | 'spec';

const MATCH_LEVEL_LABELS: Record<string, string> = {
  exact: 'Exact match',
  variation: 'Close variation',
  similar: 'Similar',
};

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
  const specPollTicksRef = useRef(0);

  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [specMd, setSpecMd] = useState('');
  const [specDirty, setSpecDirty] = useState(false);
  const [specSaving, setSpecSaving] = useState(false);
  const [specBusy, setSpecBusy] = useState(false);
  const [specTimedOut, setSpecTimedOut] = useState(false);

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
        if (!cancelled && a) {
          setArtifact(a);
          setSpecMd(a.componentSpecMd ?? '');
          setSpecDirty(false);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [artifactId, message, fetchArtifact]);

  // Assets extraction polling
  const assetsStatus = assetsStatusOf(artifact);
  const shouldPollAssets = Boolean(
    artifact && (assetsStatus === 'pending' || assetsStatus === 'extracting') && !extractionTimedOut
  );

  useEffect(() => {
    if (!shouldPollAssets) {
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
        } catch { /* keep last artifact */ }
      })();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [shouldPollAssets, fetchArtifact]);

  useEffect(() => {
    if (assetsStatus === 'done' || assetsStatus === 'failed' || assetsStatus === 'none') {
      setExtractionTimedOut(false);
      pollTicksRef.current = 0;
    }
  }, [assetsStatus]);

  // Spec generation polling
  const specStatus = specStatusOf(artifact);
  const shouldPollSpec = Boolean(
    artifact && (specStatus === 'pending' || specStatus === 'generating') && !specTimedOut
  );

  useEffect(() => {
    if (!shouldPollSpec) {
      specPollTicksRef.current = 0;
      return;
    }
    const id = window.setInterval(() => {
      void (async () => {
        specPollTicksRef.current += 1;
        if (specPollTicksRef.current > SPEC_POLL_MAX) {
          setSpecTimedOut(true);
          return;
        }
        try {
          const a = await fetchArtifact();
          if (a) {
            setArtifact(a);
            // Only update editor if the user hasn't made edits
            if (!specDirty) setSpecMd(a.componentSpecMd ?? '');
          }
        } catch { /* keep last */ }
      })();
    }, SPEC_POLL_MS);
    return () => window.clearInterval(id);
  }, [shouldPollSpec, fetchArtifact, specDirty]);

  useEffect(() => {
    if (specStatus === 'done' || specStatus === 'failed' || specStatus === 'none') {
      setSpecTimedOut(false);
      specPollTicksRef.current = 0;
    }
  }, [specStatus]);

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined' || !artifactId) return '';
    return `${window.location.origin}${basePath}/design/library/${encodeURIComponent(artifactId)}/share`;
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
      const url = shareUrl || `${window.location.origin}${basePath}/design/library/${encodeURIComponent(artifactId)}/share`;
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
          prev ? { ...prev, assetsStatus: typeof json.assetsStatus === 'string' ? json.assetsStatus : 'done', assets: json.assets } : prev
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

  const handleRegenerateSpec = async () => {
    if (!artifactId) return;
    setSpecBusy(true);
    setSpecTimedOut(false);
    specPollTicksRef.current = 0;
    setNotice(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/ai/design-artifact'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: artifactId, regenerateSpec: true }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; specQueued?: boolean };
      if (!res.ok) throw new Error(json.error || 'Could not queue spec generation.');
      setArtifact((prev) => (prev ? { ...prev, specStatus: 'pending' } : prev));
      setNotice('Spec generation queued. This tab will update when ready.');
      if (activeTab !== 'spec') setActiveTab('spec');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Spec generation failed.');
    } finally {
      setSpecBusy(false);
    }
  };

  const handleSaveSpec = async () => {
    if (!artifactId) return;
    setSpecSaving(true);
    setNotice(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/ai/design-artifact'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id: artifactId, componentSpecMd: specMd }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Could not save spec.');
      setArtifact((prev) => (prev ? { ...prev, componentSpecMd: specMd } : prev));
      setSpecDirty(false);
      setNotice('Spec saved.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSpecSaving(false);
    }
  };

  const lastPrompt = artifact ? lastUserPrompt(artifact.conversationHistory) : null;
  const assets = Array.isArray(artifact?.assets) ? artifact!.assets! : [];
  const extractErr = artifact ? extractionErrorFromMetadata(artifact.metadata) : null;
  const match = artifact ? bestComponentMatch(artifact.componentSpec) : null;

  return (
    <TooltipProvider delayDuration={300}>
      <Layout config={config} menu={menu} current={null} metadata={{ metaTitle: metadata.metaTitle, metaDescription: metadata.metaDescription }}>
        <div className="mx-auto max-w-4xl space-y-6 pb-12">
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" size="sm" asChild>
              <Link href={`${basePath}/design/library/`}>
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
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={specBusy || specStatus === 'pending' || specStatus === 'generating'}
                    onClick={() => void handleRegenerateSpec()}
                  >
                    {specBusy || specStatus === 'pending' || specStatus === 'generating' ? (
                      <Loader2Icon className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <SparklesIcon className="mr-1 h-4 w-4" />
                    )}
                    {specStatus === 'done' ? 'Regenerate spec' : 'Generate spec'}
                  </Button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-0 border-b">
                {(['overview', 'spec'] as Tab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 text-sm font-medium capitalize transition-colors ${
                      activeTab === tab
                        ? 'border-b-2 border-primary text-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab}
                    {tab === 'spec' && (specStatus === 'pending' || specStatus === 'generating') ? (
                      <Loader2Icon className="ml-1.5 inline h-3 w-3 animate-spin" />
                    ) : null}
                  </button>
                ))}
              </div>

              {/* Overview tab */}
              {activeTab === 'overview' ? (
                <div className="space-y-6">
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
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                        Extracting assets… This can take a minute.
                      </div>
                    ) : null}
                    {assetsStatus === 'failed' ? (
                      <p className="text-sm text-destructive">{extractErr || 'Extraction failed.'}</p>
                    ) : null}
                    {assetsStatus === 'none' ? (
                      <p className="text-sm text-muted-foreground">No extraction has run yet. Click Extract assets to start.</p>
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
                </div>
              ) : null}

              {/* Spec tab */}
              {activeTab === 'spec' ? (
                <div className="space-y-4">
                  {specStatus === 'pending' || specStatus === 'generating' ? (
                    <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                      {specStatus === 'generating' ? 'Generating component spec…' : 'Spec generation queued…'}
                    </div>
                  ) : null}

                  {specStatus === 'failed' ? (
                    <p className="rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                      Spec generation failed. Click <strong>Regenerate spec</strong> to try again.
                    </p>
                  ) : null}

                  {specStatus === 'none' && !specMd ? (
                    <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                      <SparklesIcon className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      <p>No spec yet. Click <strong>Generate spec</strong> to create one from the design image.</p>
                    </div>
                  ) : null}

                  {match ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
                            {MATCH_LEVEL_LABELS[match.matchLevel] ?? match.matchLevel} · {Math.round(match.confidence * 100)}% confidence
                          </p>
                          <p className="mt-1 text-sm font-medium text-emerald-900 dark:text-emerald-100">{match.componentTitle}</p>
                          <p className="mt-0.5 text-sm text-emerald-800 dark:text-emerald-200">{match.recommendation}</p>
                        </div>
                        {match.componentId ? (
                          <Button variant="outline" size="sm" className="border-emerald-300 dark:border-emerald-700" asChild>
                            <Link href={`${basePath}/system/component/${encodeURIComponent(match.componentId)}/`}>
                              View component
                            </Link>
                          </Button>
                        ) : null}
                      </div>
                      {match.sampleConfig && Object.keys(match.sampleConfig).length > 0 ? (
                        <Collapsible className="mt-3">
                          <CollapsibleTrigger className="text-xs text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                            Sample config
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <pre className="mt-2 rounded bg-emerald-100 p-2 text-[11px] leading-snug dark:bg-emerald-900">
                              {JSON.stringify(match.sampleConfig, null, 2)}
                            </pre>
                          </CollapsibleContent>
                        </Collapsible>
                      ) : null}
                    </div>
                  ) : null}

                  {specMd || specStatus === 'done' ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">Component spec (editable)</p>
                        {specDirty ? (
                          <Button size="sm" variant="default" disabled={specSaving} onClick={() => void handleSaveSpec()}>
                            {specSaving ? <Loader2Icon className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                            Save
                          </Button>
                        ) : null}
                      </div>
                      <Textarea
                        value={specMd}
                        onChange={(e) => {
                          setSpecMd(e.target.value);
                          setSpecDirty(e.target.value !== (artifact.componentSpecMd ?? ''));
                        }}
                        className="min-h-[60vh] font-mono text-xs leading-relaxed"
                        spellCheck={false}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </Layout>
    </TooltipProvider>
  );
}
