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
import { LifecycleBadge, OwnerAttribution, VisibilityBadge } from '@/components/library';
import {
  AssetsSection,
  DevHandoffPanel,
  DevHandoffProgress,
  type AssetView,
  type DevHandoffSpecView,
  type DevHandoffStatusView,
} from '@/components/Design/DevHandoffPanel';
import type { Lifecycle, Visibility } from '@/lib/authz/vocab';

/** Owner shape returned alongside the artifact by the detail route. */
type ArtifactOwner = { id: string; name?: string | null; image?: string | null } | null;

const LIFECYCLE_SET = new Set<Lifecycle>(['prototype', 'draft', 'review', 'approved', 'archived']);
const VISIBILITY_SET = new Set<Visibility>(['private', 'shared', 'team', 'public']);

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
  visibility?: string;
  componentSpec?: unknown;
  componentSpecMd?: string;
  specStatus?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
};

/** Light status-only shape returned by the `[id]/status` subroute. */
type ArtifactStatus = {
  id: string;
  status: string;
  assetsStatus?: string;
  specStatus?: string;
  assetsExtractionError?: string | null;
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

/**
 * Resolve a stored artifact image for use in `<img src>`.
 *
 * Artifact images live in a private Blob store and are persisted as the root-relative proxy path
 * `/api/handoff/artifact-asset?p=…`. The base path is deliberately NOT baked into the stored value
 * (it can change per deployment), so it has to be applied at render time. Data URLs and absolute
 * URLs — older rows, and anything not offloaded — pass through untouched.
 */
function assetSrc(url: string | undefined | null): string {
  const u = (url ?? '').trim();
  if (!u || /^(data:|blob:|https?:|\/\/)/i.test(u)) return u;
  return u.startsWith('/') ? handoffApiUrl(u) : u;
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
  const [owner, setOwner] = useState<ArtifactOwner>(null);
  const [isMe, setIsMe] = useState(false);
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
    const json = (await res.json().catch(() => ({}))) as {
      artifact?: SavedDesignArtifactDetail;
      owner?: ArtifactOwner;
      isMe?: boolean;
      error?: string;
    };
    if (!res.ok) throw new Error(json.error || `Failed to load (${res.status})`);
    if (!json.artifact) throw new Error('Design not found.');
    setOwner(json.owner ?? null);
    setIsMe(Boolean(json.isMe));
    return normalizeArtifactDetail(json.artifact as Record<string, unknown>);
  }, [artifactId, message]);

  // Light status-only poll — hits the `/status` subroute (no JSONB blobs) so the
  // 4–5s polls don't re-download the whole multi-MB artifact on every tick.
  const fetchStatus = useCallback(async (): Promise<ArtifactStatus | null> => {
    if (message || !artifactId) return null;
    const res = await fetch(
      handoffApiUrl(`/api/handoff/ai/design-artifact/${encodeURIComponent(artifactId)}/status`),
      { credentials: 'include' }
    );
    const json = (await res.json().catch(() => ({}))) as ArtifactStatus & { error?: string };
    if (!res.ok) throw new Error(json.error || `Failed to load (${res.status})`);
    return json;
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
          const s = await fetchStatus();
          const next = s?.assetsStatus;
          // Only pull the full artifact once, when extraction reaches a terminal state.
          if (next && next !== 'pending' && next !== 'extracting') {
            const a = await fetchArtifact();
            if (a) setArtifact(a);
          }
        } catch { /* keep last artifact */ }
      })();
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [shouldPollAssets, fetchStatus, fetchArtifact]);

  useEffect(() => {
    if (assetsStatus === 'done' || assetsStatus === 'failed' || assetsStatus === 'none') {
      setExtractionTimedOut(false);
      pollTicksRef.current = 0;
    }
  }, [assetsStatus]);

  // Spec generation polling
  const specStatus = specStatusOf(artifact);

  /**
   * The unified dev-handoff view of the two statuses. Mirrors `deriveDevHandoffStatus` on the
   * server — duplicated rather than imported because that module is `server-only`. Kept in sync
   * by the shared stage vocabulary; the server value is authoritative wherever both are present.
   */
  const devHandoff = useMemo<DevHandoffStatusView | null>(() => {
    if (!artifact) return null;
    const meta = (artifact.metadata ?? {}) as Record<string, unknown>;
    const assetsErr = typeof meta.assetsExtractionError === 'string' ? meta.assetsExtractionError : null;
    const specErr = typeof meta.specError === 'string' ? meta.specError : null;

    if (assetsStatus === 'pending' || assetsStatus === 'extracting') {
      return {
        stage: 'extracting_assets',
        running: true,
        progress: assetsStatus === 'pending' ? 0.1 : 0.35,
        label: 'Extracting assets',
        error: null,
        warning: null,
      };
    }
    if (specStatus === 'pending' || specStatus === 'generating') {
      return {
        stage: 'generating_spec',
        running: true,
        progress: specStatus === 'pending' ? 0.55 : 0.75,
        label: 'Generating specification',
        error: null,
        warning: assetsStatus === 'failed' ? assetsErr ?? 'Asset extraction failed; specifying from the original image.' : null,
      };
    }
    if (specStatus === 'done') {
      return {
        stage: 'ready',
        running: false,
        progress: 1,
        label: 'Ready for dev',
        error: null,
        warning: assetsStatus === 'failed' ? assetsErr ?? 'Asset extraction failed — spec generated from the original image.' : null,
      };
    }
    if (specStatus === 'failed' || assetsStatus === 'failed') {
      return {
        stage: 'failed',
        running: false,
        progress: 0,
        label: 'Failed',
        error: specErr ?? assetsErr ?? 'The dev handoff failed without recording a reason.',
        warning: null,
      };
    }
    return { stage: 'not_started', running: false, progress: 0, label: 'Not started', error: null, warning: null };
  }, [artifact, assetsStatus, specStatus]);
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
          const s = await fetchStatus();
          const next = s?.specStatus;
          // Only pull the full artifact once, when spec generation reaches a terminal state.
          if (next && next !== 'pending' && next !== 'generating') {
            const a = await fetchArtifact();
            if (a) {
              setArtifact(a);
              // Only update editor if the user hasn't made edits
              if (!specDirty) setSpecMd(a.componentSpecMd ?? '');
            }
          }
        } catch { /* keep last */ }
      })();
    }, SPEC_POLL_MS);
    return () => window.clearInterval(id);
  }, [shouldPollSpec, fetchStatus, fetchArtifact, specDirty]);

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

  /**
   * Start "Transition to dev".
   *
   * Named for extraction historically, but the PATCH it sends queues the whole handoff — assets, then
   * the specification — which is why both statuses are advanced below. The old name made the button and
   * the handler look like they did different things.
   */
  const handleTransitionToDev = async () => {
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
        // Both statuses move together — the server queues the full handoff (assets, then
        // specification), so reflecting only assetsStatus here would make the progress
        // indicator stall at the first stage until the next poll.
        setArtifact((prev) => (prev ? { ...prev, assetsStatus: 'pending', specStatus: 'pending', assets: [] } : prev));
        setSpecTimedOut(false);
        specPollTicksRef.current = 0;
        setNotice('Transitioning to dev — extracting assets, then writing the specification.');
        if (activeTab !== 'spec') setActiveTab('spec');
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not start the transition to dev.');
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

  // ── Asset-first pipeline ────────────────────────────────────────────────────
  // Generating assets separately is a multi-stage pipeline drained by the design-jobs cron (each
  // stage takes 1-2 minutes), so this starts it and then polls. It is NOT awaited in a request.
  const [pipelineBusy, setPipelineBusy] = useState(false);
  const [pipeline, setPipeline] = useState<{
    finished: boolean;
    current: string | null;
    progress: number;
    stages: { stage: string; status: string; attempts: number; error: string | null }[];
  } | null>(null);

  const declaresImagery = Array.isArray(
    (artifact?.componentSpec as { assetRequirements?: unknown[] } | undefined)?.assetRequirements
  )
    ? ((artifact!.componentSpec as { assetRequirements: unknown[] }).assetRequirements.length > 0)
    : false;

  const fetchPipeline = useCallback(async () => {
    if (!artifactId) return;
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/ai/design-artifact/${encodeURIComponent(artifactId)}/pipeline`), {
        credentials: 'include',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { pipeline?: typeof pipeline };
      setPipeline(json.pipeline ?? null);
    } catch {
      /* transient — the next poll retries */
    }
  }, [artifactId]);

  useEffect(() => {
    void fetchPipeline();
  }, [fetchPipeline]);

  // Poll only while something is actually in flight, so an idle tab isn't hitting the server forever.
  useEffect(() => {
    if (!pipeline || pipeline.finished) return;
    const t = setInterval(() => void fetchPipeline(), 8000);
    return () => clearInterval(t);
  }, [pipeline, fetchPipeline]);

  // Refresh the artifact once the pipeline finishes so the new assets appear without a manual reload.
  const pipelineFinished = pipeline?.finished ?? null;
  useEffect(() => {
    if (pipelineFinished === true) void fetchArtifact();
  }, [pipelineFinished, fetchArtifact]);

  const handleGenerateAssets = async () => {
    if (!artifactId) return;
    setPipelineBusy(true);
    setNotice(null);
    try {
      const res = await fetch(handoffApiUrl(`/api/handoff/ai/design-artifact/${encodeURIComponent(artifactId)}/pipeline`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        // assets-only: non-destructive. Recomposing the image would replace the current one.
        body: JSON.stringify({ intent: 'assets-only' }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; stages?: string[] };
      if (!res.ok) throw new Error(json.error || 'Could not start asset generation.');
      setNotice(`Generating assets (${(json.stages ?? []).join(' → ')}). Each stage takes a minute or two.`);
      await fetchPipeline();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not start asset generation.');
    } finally {
      setPipelineBusy(false);
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
  const match = artifact ? bestComponentMatch(artifact.componentSpec) : null;
  const statusLc: Lifecycle | null =
    artifact && LIFECYCLE_SET.has(artifact.status as Lifecycle) ? (artifact.status as Lifecycle) : null;
  const visibilityV: Visibility | null =
    artifact && artifact.visibility && VISIBILITY_SET.has(artifact.visibility as Visibility)
      ? (artifact.visibility as Visibility)
      : null;

  return (
    <TooltipProvider delayDuration={300}>
      <Layout
        config={config}
        menu={menu}
        current={null}
        metadata={{ metaTitle: metadata.metaTitle, metaDescription: metadata.metaDescription }}
        fullBleed
      >
        <div className="flex h-full min-h-0 overflow-hidden bg-background">
          {/* Left sidebar — metadata + actions (mirrors the builder shells). */}
          <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r bg-background">
            <div className="border-b p-3">
              <Button variant="ghost" size="sm" className="mb-2 h-8 w-full justify-start gap-1.5 px-2" asChild>
                <Link href={`${basePath}/library`}>
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to library
                </Link>
              </Button>
              {artifact ? (
                <>
                  <h1 className="text-sm font-semibold leading-tight tracking-tight">{artifact.title || 'Untitled'}</h1>
                  <p className="mt-1 text-xs text-muted-foreground">Updated {formatDate(artifact.updatedAt)}</p>
                </>
              ) : null}
            </div>

            {artifact ? (
              <>
                {/* Status */}
                <div className="flex flex-col gap-2 border-b p-3">
                  <p className="text-xs font-medium text-muted-foreground">Status</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {statusLc ? (
                      <LifecycleBadge status={statusLc} />
                    ) : (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium uppercase text-muted-foreground">{artifact.status}</span>
                    )}
                    {visibilityV ? <VisibilityBadge visibility={visibilityV} /> : null}
                  </div>
                  <OwnerAttribution owner={owner} isMe={isMe} />
                  <p className="text-xs text-muted-foreground">Created {formatDate(artifact.createdAt)}</p>
                </div>

                {/* Sharing */}
                <div className="flex flex-col gap-2 border-b p-3">
                  <p className="text-xs font-medium text-muted-foreground">Sharing</p>
                  <Button type="button" variant="outline" size="sm" className="w-full justify-start gap-1.5" disabled={shareBusy} onClick={() => void handleShare()}>
                    {shareBusy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <Link2Icon className="h-4 w-4" />}
                    Share link
                  </Button>
                  {artifact.publicAccess ? (
                    <Button type="button" variant="ghost" size="sm" className="w-full justify-start" disabled={shareBusy} onClick={() => void handleRevokeShare()}>
                      Stop sharing
                    </Button>
                  ) : null}
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-2 p-3">
                  <p className="text-xs font-medium text-muted-foreground">Actions</p>
                  <Button variant="outline" size="sm" className="w-full justify-start gap-1.5" asChild>
                    <Link href={`${basePath}/design?loadArtifact=${encodeURIComponent(artifact.id)}`}>
                      <ExternalLink className="h-4 w-4" />
                      Open in workbench
                    </Link>
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
                    <Link href={`${basePath}/design/`}>Workbench</Link>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full justify-start gap-1.5"
                    disabled={reextractBusy || Boolean(devHandoff?.running)}
                    onClick={() => void handleTransitionToDev()}
                  >
                    {reextractBusy || devHandoff?.running ? (
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                    ) : (
                      <SparklesIcon className="h-4 w-4" />
                    )}
                    {devHandoff?.stage === 'ready' ? 'Re-run dev handoff' : 'Transition to dev'}
                  </Button>
                  {declaresImagery ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-start gap-1.5"
                      disabled={pipelineBusy || Boolean(pipeline && !pipeline.finished)}
                      onClick={() => void handleGenerateAssets()}
                      title="Generate each image the spec declares as a separate, web-ready asset"
                    >
                      {pipelineBusy || (pipeline && !pipeline.finished) ? (
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                      ) : (
                        <SparklesIcon className="h-4 w-4" />
                      )}
                      Generate assets
                    </Button>
                  ) : null}
                </div>
              </>
            ) : null}
          </aside>

          {/* Main — slim top bar + scrolling content. */}
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Slim top bar with the tab strip */}
            <div className="flex shrink-0 items-center gap-0 border-b px-2">
              {artifact ? (
                (['overview', 'spec'] as Tab[]).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-3 text-sm font-medium capitalize transition-colors ${
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
                ))
              ) : (
                <span className="px-4 py-3 text-sm font-semibold tracking-tight">Saved design</span>
              )}
            </div>

            {/* Scroll region */}
            <div className="flex-1 overflow-y-auto p-4">
              {message ? <p className="mb-3 text-sm text-amber-700 dark:text-amber-400">{message}</p> : null}
              {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
              {notice ? <p className="mb-3 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p> : null}

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
                <div className="mx-auto max-w-4xl space-y-6 pb-12">
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
                      <img src={assetSrc(artifact.imageUrl)} alt={artifact.title || 'Design'} className="mx-auto max-h-[min(85vh,1200px)] w-full object-contain" />
                    ) : (
                      <p className="p-8 text-center text-sm text-muted-foreground">No image stored.</p>
                    )}
                  </div>

                  {/* Assets. The old "Extracted assets" section lived here with a re-extract button —
                      removed because extraction is retired: it re-generated crops via an image model at a
                      forced 1024x1024 rather than extracting anything. Assets now come from the spec's
                      declared requirements, so this shows them with the provenance that makes them
                      web-ready, using the same component as the Spec tab. */}
                  {assets.length > 0 ? (
                    <AssetsSection assets={assets as AssetView[]} basePath={basePath} />
                  ) : declaresImagery ? (
                    <section className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                      This design needs{' '}
                      {(artifact.componentSpec as { assetRequirements?: unknown[] } | undefined)?.assetRequirements?.length ?? 0}{' '}
                      image asset(s). Use <strong>Generate assets</strong> to produce them at the right size.
                    </section>
                  ) : null}

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
                  {/* One unified stage indicator across extraction + specification, rather than
                      two independent banners that could disagree. */}
                  {devHandoff && devHandoff.stage !== 'not_started' ? <DevHandoffProgress status={devHandoff} /> : null}

                  {devHandoff?.stage === 'not_started' && !specMd ? (
                    <div className="rounded-md border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                      <SparklesIcon className="mx-auto mb-2 h-8 w-8 opacity-40" />
                      <p>
                        Not yet handed off. Click <strong>Transition to dev</strong> to extract the assets and generate the
                        specification.
                      </p>
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
                    <DevHandoffPanel
                      spec={(artifact.componentSpec as DevHandoffSpecView | null) ?? null}
                      assets={(artifact.assets ?? []) as AssetView[]}
                      basePath={basePath}
                      artifactId={artifactId}
                      // Enforced server-side (the route 404s without canEdit), matching the other edit
                      // affordances on this page — the UI has no permission signal threaded in yet.
                      canRevise
                      onRevised={() => void fetchArtifact()}
                      rawMarkdownSlot={
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
                            className="min-h-[50vh] font-mono text-xs leading-relaxed"
                            spellCheck={false}
                          />
                        </div>
                      }
                    />
                  ) : null}
                </div>
              ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Layout>
    </TooltipProvider>
  );
}
