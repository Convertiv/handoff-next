'use client';

import {
  AlertCircleIcon,
  ArrowUpIcon,
  ClipboardIcon,
  DownloadIcon,
  FileTextIcon,
  LayoutGridIcon,
  LibraryIcon,
  LightbulbIcon,
  Loader2Icon,
  PanelsTopLeftIcon,
  PaperclipIcon,
  RotateCcwIcon,
  WandSparklesIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import { PenNib } from '@phosphor-icons/react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import Layout from '../../components/Layout/Main';
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '../../components/ui/attachment';
import { Bubble, BubbleContent } from '../../components/ui/bubble';
import { Button } from '../../components/ui/button';
import { Marker, MarkerContent, MarkerIcon } from '../../components/ui/marker';
import { Message, MessageContent, MessageFooter } from '../../components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '../../components/ui/message-scroller';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import type { DocumentationProps } from '../../components/util';
import { handoffApiUrl } from '../../lib/api-path';
import { applyWorkspaceToState, fetchDesignWorkspace, readLocalStorageWorkspace } from '../../lib/design-workspace-client';
import { formatBrandVoiceForPrompt } from '../../lib/design-workspace-format';
import { LOGIN_TO_USE_TOOL_MESSAGE } from '../../lib/login-required-messages';
import type {
  DesignConversationTurn,
  DesignWorkbenchComponentGuide,
  DesignWorkbenchComponentRow,
  DesignWorkbenchFoundationContext,
  GeneratedImage,
} from './workbench-types';
import {
  clearWorkbenchSession,
  loadWorkbenchSession,
  saveWorkbenchSession,
  MAX_RECENT,
  type WorkbenchSession,
} from './workbench-session';
import { COMPONENT_REFERENCE_SETTINGS, CUSTOM_FOUNDATION_IMAGE_FILENAME } from './settings/settings-constants';

type LayoutWizardStatus = 'idle' | 'analyzing' | 'generating' | 'done';

type LayoutAnalysisResult = {
  description: string;
  wireframeImage: string;
};

type DesignClientProps = DocumentationProps & {
  isLoggedIn: boolean;
  serverAiAvailable: boolean;
  components: DesignWorkbenchComponentRow[];
  foundations: DesignWorkbenchFoundationContext;
  loadArtifactId?: string;
  /** Pre-select component IDs (from chat assistant hand-off) */
  initialComponentIds?: string[];
  /** Pre-fill the prompt textarea (from chat assistant hand-off) */
  initialPrompt?: string;
};

const IMAGE_QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;
type ImageQuality = (typeof IMAGE_QUALITY_OPTIONS)[number];
const EMPTY_FOUNDATIONS: DesignWorkbenchFoundationContext = { colors: [], typography: [], effects: [], spacing: [] };
const PROMPT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const CANVAS_WIDTH = 2048;
const CANVAS_HEIGHT = 1152;
const CANVAS_INITIAL_SCALE = 0.35;
const CANVAS_MIN_SCALE = 0.2;
const TRACKPAD_ZOOM_STEP = 0.01;
const LAYOUT_WIZARD_PROMPT = 'Make me a design using our design system based on this wireframe.';
const PROMPT_SUGGESTIONS = [
  'Design a modern SaaS landing page hero for a productivity app.',
  'Create a pricing section with three plans and a highlighted recommended tier.',
  'Make an onboarding screen that helps a new user set up their workspace.',
  'Design a dashboard overview with key metrics, recent activity, and quick actions.',
  'Create a mobile checkout flow for a boutique ecommerce store.',
  'Design a settings page for managing team members and permissions.',
  'Make a feature comparison section for a product marketing page.',
  'Create an empty state for a project dashboard with a clear next action.',
  'Design a calendar scheduling screen for booking customer calls.',
];
/** Curated block screenshots (under public/assets/design/blocks/) offered as prompt attachments. */
const BLOCK_LIBRARY = [
  { file: 'callout-cta.jpg', label: 'Callout CTA' },
  { file: 'carousel.png', label: 'Carousel' },
  { file: 'container.png', label: 'Container' },
  { file: 'customer-stories.jpg', label: 'Customer stories' },
  { file: 'faq.jpg', label: 'FAQ' },
  { file: 'features-comparison.jpg', label: 'Features comparison' },
  { file: 'table.jpg', label: 'Table' },
];
/** Shortcut prompts shown in the chat sidebar before the first message. */
const CHAT_EMPTY_SUGGESTIONS = [
  'Design a SaaS landing page hero',
  'Create a pricing table with three plans, middle one being recommended. Each plan has 4 bullets and button "Start Now" at the bottom.',
  'Design a dashboard overview with key metrics, recent activity and quick actions. Make it light on text and with decent amount of whitespace.',
];

function formatGenerationTimestamp(createdAt: string | undefined): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';

  const now = new Date();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  ) {
    return `Today, ${time}`;
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + `, ${time}`;
}

function safeFoundationContext(raw: unknown): DesignWorkbenchFoundationContext {
  if (!raw || typeof raw !== 'object') {
    return { colors: [], typography: [], effects: [], spacing: [] };
  }
  const o = raw as Record<string, unknown>;
  return {
    colors: Array.isArray(o.colors) ? (o.colors as DesignWorkbenchFoundationContext['colors']) : [],
    typography: Array.isArray(o.typography) ? (o.typography as DesignWorkbenchFoundationContext['typography']) : [],
    effects: Array.isArray(o.effects) ? (o.effects as DesignWorkbenchFoundationContext['effects']) : [],
    spacing: Array.isArray(o.spacing) ? (o.spacing as DesignWorkbenchFoundationContext['spacing']) : [],
  };
}

/**
 * Artifact images stream from a private Blob store via a root-relative proxy path, so the
 * deployment's base path has to be applied before they can be used as an <img src>. Data URLs
 * and absolute URLs (older rows) pass through unchanged.
 */
function resolveHistoryImageSrc(url: string): string {
  return /^(data:|blob:|https?:|\/\/)/i.test(url) || !url.startsWith('/') ? url : handoffApiUrl(url);
}

async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}

const DesignWorkbenchPage = ({
  menu,
  metadata,
  current,
  config,
  isLoggedIn,
  serverAiAvailable,
  foundations,
  loadArtifactId,
  initialComponentIds,
  initialPrompt,
}: DesignClientProps) => {
  const router = useRouter();
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const promptImageInputRef = useRef<HTMLInputElement>(null);
  const layoutGuideInputRef = useRef<HTMLInputElement>(null);
  const chatPromptRef = useRef<HTMLTextAreaElement>(null);
  const selectedGeneratedImageIdRef = useRef<string | null>(null);
  const draftArtifactIdRef = useRef<string | null>(null);
  const layoutWizardRunIdRef = useRef(0);
  const layoutWizardTransitionTimerRef = useRef<number | null>(null);
  /** True when the page was opened from the chat assistant with a pre-built prompt. Reset after first fire. */
  const autoGenerateRef = useRef(Boolean(initialPrompt));

  const [promptImages, setPromptImages] = useState<File[]>([]);
  const [promptImagePreviewUrls, setPromptImagePreviewUrls] = useState<string[]>([]);
  const [layoutGuideImage, setLayoutGuideImage] = useState<File | null>(null);
  const [layoutGuidePreviewUrl, setLayoutGuidePreviewUrl] = useState('');
  const [layoutGuideDescription, setLayoutGuideDescription] = useState('');
  const [layoutGuideWireframeUrl, setLayoutGuideWireframeUrl] = useState('');
  const [isAnalyzingLayoutGuide, setIsAnalyzingLayoutGuide] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [promptSuggestionsOpen, setPromptSuggestionsOpen] = useState(false);
  const [chatSuggestionsOpen, setChatSuggestionsOpen] = useState(false);
  const [blocksOpen, setBlocksOpen] = useState(false);
  const [imageQuality, setImageQuality] = useState<ImageQuality>('low');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [conversationHistory, setConversationHistory] = useState<DesignConversationTurn[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [selectedGeneratedImageId, setSelectedGeneratedImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeFoundations, setIncludeFoundations] = useState(true);
  const [customFoundationImageDataUrl, setCustomFoundationImageDataUrl] = useState('');
  const [componentReferenceDataUrls, setComponentReferenceDataUrls] = useState<Record<string, string>>({});
  const [designMd, setDesignMd] = useState('');
  const [brandVoice, setBrandVoice] = useState<Record<string, string>>({});
  const [effectiveFoundations, setEffectiveFoundations] = useState<DesignWorkbenchFoundationContext>(foundations);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDefaultTitle, setSaveDefaultTitle] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveImageSrc, setSaveImageSrc] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [layoutWizardOpen, setLayoutWizardOpen] = useState(false);
  const [layoutWizardTransitioning, setLayoutWizardTransitioning] = useState(false);
  const [layoutWizardClosing, setLayoutWizardClosing] = useState(false);
  const [layoutWizardStatus, setLayoutWizardStatus] = useState<LayoutWizardStatus>('idle');
  const [layoutWizardDisplayWireframeUrl, setLayoutWizardDisplayWireframeUrl] = useState('');
  const [layoutWizardDisplayDescription, setLayoutWizardDisplayDescription] = useState('');
  const [draftArtifactId, setDraftArtifactId] = useState<string | null>(null);
  const [resumeSession, setResumeSession] = useState<WorkbenchSession | null>(null);

  useEffect(() => {
    selectedGeneratedImageIdRef.current = selectedGeneratedImageId;
  }, [selectedGeneratedImageId]);

  useEffect(() => {
    draftArtifactIdRef.current = draftArtifactId;
  }, [draftArtifactId]);

  useEffect(() => {
    if (loadArtifactId?.trim()) return;
    const saved = loadWorkbenchSession();
    if (!saved) return;
    // Only offer to restore a session with genuine unsaved work — an active
    // canvas image or an in-progress conversation thread. Bare generation
    // thumbnails are re-hydrated from the jobs API, so a session containing
    // only those (or nothing) shouldn't trigger the restore prompt.
    const hasMeaningfulWork = Boolean(saved.imageSrc) || (saved.conversationHistory?.length ?? 0) > 0;
    if (!hasMeaningfulWork) return;
    setResumeSession(saved);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(handoffApiUrl('/api/handoff/ai/design-generation-jobs'), { credentials: 'include' });
        if (!res.ok || cancelled) return;
        const json = (await res.json().catch(() => ({}))) as {
          jobs?: { id: number; status: string; stage: string; imageUrl?: string; error?: string; artifactId?: string; createdAt?: string }[];
        };
        if (cancelled) return;
        const jobs = json.jobs ?? [];
        if (jobs.length === 0) return;
        setGeneratedImages((current) => {
          const existingJobIds = new Set(current.map((img) => img.jobId).filter(Boolean));
          const toAdd: GeneratedImage[] = jobs
            .filter((j) => !existingJobIds.has(j.id))
            .map((j) => ({
              id: `job-${j.id}`,
              prompt: '(in-progress from previous session)',
              status: j.status === 'done' ? 'completed' : j.status === 'failed' ? 'error' : 'pending',
              src: j.imageUrl ?? undefined,
              stage: j.stage,
              jobId: j.id,
              artifactId: j.artifactId ?? undefined,
              createdAt: j.createdAt,
              ts: j.createdAt,
            }));
          if (toAdd.length === 0) return current;
          return [...toAdd, ...current];
        });
        for (const j of jobs.filter((j) => j.status === 'pending' || j.status === 'running')) {
          void pollJobUntilDone(j.id);
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  useEffect(() => {
    const recentImages = generatedImages
      .filter((img) => img.status === 'completed' && img.src)
      .slice(0, MAX_RECENT)
      .map((img) => ({ id: img.id, src: img.src!, prompt: img.prompt, ts: img.createdAt ?? img.ts ?? '' }));
    saveWorkbenchSession({
      draftArtifactId: draftArtifactIdRef.current,
      imageSrc,
      selectedIds: [],
      conversationHistory,
      recentImages,
      activeJobIds: generatedImages.filter((img) => img.status === 'pending' && img.jobId).map((img) => img.jobId!),
    });
  }, [generatedImages, conversationHistory, imageSrc]);

  useEffect(() => {
    if (!initialComponentIds?.length && !initialPrompt) return;
    if (initialPrompt) setPrompt(initialPrompt);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!autoGenerateRef.current || !prompt) return;
    autoGenerateRef.current = false;
    void handleGenerate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt]);

  useEffect(() => {
    setEffectiveFoundations(foundations);
  }, [foundations]);

  useEffect(() => {
    const readSetting = async () => {
      const ws = await fetchDesignWorkspace();
      if (ws) {
        const state = applyWorkspaceToState(ws);
        setIncludeFoundations(state.includeFoundations);
        setCustomFoundationImageDataUrl(state.customFoundationImageUrl);
        setComponentReferenceDataUrls(state.componentReferences);
        setDesignMd(state.designMd);
        setBrandVoice(state.brandVoice);
        return;
      }
      const local = readLocalStorageWorkspace();
      setIncludeFoundations(local.includeFoundations);
      setCustomFoundationImageDataUrl(local.customFoundationImageUrl);
      setComponentReferenceDataUrls(Object.fromEntries(Object.entries(local.componentReferences).map(([k, v]) => [k, v.imageUrl])));
      setDesignMd(local.designMd);
      setBrandVoice(local.brandVoice);
    };
    const handleFocus = () => void readSetting();
    void readSetting();
    window.addEventListener('focus', handleFocus);
    return () => {
      window.removeEventListener('focus', handleFocus);
    };
  }, []);

  useEffect(() => {
    if (!loadArtifactId?.trim()) return;
    const id = loadArtifactId.trim();
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/ai/design-artifact/${encodeURIComponent(id)}`), {
          credentials: 'include',
        });
        const json = (await res.json().catch(() => ({}))) as {
          artifact?: {
            imageUrl?: string;
            conversationHistory?: DesignConversationTurn[];
            foundationContext?: unknown;
          };
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || `Could not load design (${res.status})`);
        const artifact = json.artifact;
        if (!artifact?.imageUrl) throw new Error('Saved design has no image to continue from.');
        if (cancelled) return;
        setImageSrc(resolveHistoryImageSrc(artifact.imageUrl));
        selectedGeneratedImageIdRef.current = null;
        setSelectedGeneratedImageId(null);
        if (Array.isArray(artifact.conversationHistory)) setConversationHistory(artifact.conversationHistory);
        setEffectiveFoundations(safeFoundationContext(artifact.foundationContext));
        router.replace(`${basePath}/design`);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not open saved design in workbench.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadArtifactId, router, basePath]);

  useEffect(() => {
    const urls = promptImages.map((f) => URL.createObjectURL(f));
    setPromptImagePreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [promptImages]);

  useEffect(() => {
    if (!layoutGuideImage) {
      setLayoutGuidePreviewUrl('');
      return;
    }
    const url = URL.createObjectURL(layoutGuideImage);
    setLayoutGuidePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [layoutGuideImage]);

  useEffect(() => {
    return () => {
      if (layoutWizardTransitionTimerRef.current) {
        window.clearTimeout(layoutWizardTransitionTimerRef.current);
      }
    };
  }, []);

  // Auto-grow fallback for browsers without CSS `field-sizing: content` (Firefox).
  // Chromium/Safari handle growth natively, so this effect stays inert there.
  useEffect(() => {
    const ta = chatPromptRef.current;
    if (!ta) return;
    if (typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content')) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`; // cap matches max-h-40
  }, [prompt]);

  const promptedFoundations = includeFoundations ? effectiveFoundations : EMPTY_FOUNDATIONS;
  const customFoundationImage = !includeFoundations ? customFoundationImageDataUrl : '';
  const brandVoiceGuidelines = useMemo(() => formatBrandVoiceForPrompt(brandVoice), [brandVoice]);
  const selectedGuides = useMemo<DesignWorkbenchComponentGuide[]>(() => [], []);
  const activeGeneration = generatedImages.find((image) => image.id === selectedGeneratedImageIdRef.current);
  const isGenerating = activeGeneration?.status === 'pending';
  // Empty chat = no conversation yet, nothing running, nothing to report.
  const chatEmpty = conversationHistory.length === 0 && !isGenerating && !error;

  const hasFoundationsForRaster = useMemo(
    () =>
      promptedFoundations.colors.length > 0 ||
      promptedFoundations.typography.length > 0 ||
      (promptedFoundations.spacing?.length ?? 0) > 0 ||
      (promptedFoundations.effects?.length ?? 0) > 0,
    [promptedFoundations]
  );

  const addPromptImageFiles = useCallback((files: ArrayLike<File> | Iterable<File> | null) => {
    if (!files) return;
    const next = Array.from(files).filter((f) => PROMPT_IMAGE_TYPES.includes(f.type));
    if (!next.length) return;
    setPromptImages((current) => [...current, ...next]);
    if (promptImageInputRef.current) promptImageInputRef.current.value = '';
  }, []);

  const setLayoutGuideFile = useCallback((file: File | null) => {
    if (file && !PROMPT_IMAGE_TYPES.includes(file.type)) {
      setError('Layout Guide supports PNG, JPEG, or WebP images.');
      return;
    }
    setLayoutGuideImage(file);
    setLayoutGuideDescription('');
    setLayoutGuideWireframeUrl('');
    setLayoutWizardStatus('idle');
    setError(null);
    if (layoutGuideInputRef.current) layoutGuideInputRef.current.value = '';
  }, []);

  const handleLayoutGuideUpload = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return;
      const image = Array.from(files).find((file) => PROMPT_IMAGE_TYPES.includes(file.type));
      if (!image) {
        setError('Layout Guide supports PNG, JPEG, or WebP images.');
        return;
      }
      setLayoutGuideFile(image);
    },
    [setLayoutGuideFile]
  );

  const handlePasteLayoutGuide = useCallback(async () => {
    if (!navigator.clipboard?.read) {
      setError('Clipboard image paste is not supported in this browser.');
      return;
    }

    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => PROMPT_IMAGE_TYPES.includes(type));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        setLayoutGuideFile(new File([blob], 'layout-guide-image', { type: imageType }));
        return;
      }
      setError('No image found in clipboard.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read image from clipboard.');
    }
  }, [setLayoutGuideFile]);

  const analyzeLayoutGuideImage = useCallback(async (image: File): Promise<LayoutAnalysisResult> => {
    const formData = new FormData();
    formData.append('image', image);
    const res = await fetch(handoffApiUrl('/api/handoff/ai/analyze-layout-guide'), {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    const json = (await res.json().catch(() => ({}))) as { description?: string; wireframeImage?: string; error?: string };
    if (!res.ok) throw new Error(json.error || 'Layout analysis failed.');
    if (!json.description?.trim()) throw new Error('Layout analysis returned no description.');
    return {
      description: json.description.trim(),
      wireframeImage: json.wireframeImage?.trim() ?? '',
    };
  }, []);

  const handleUseLayoutGuide = useCallback(async () => {
    if (!layoutGuideImage) return;
    setIsAnalyzingLayoutGuide(true);
    setError(null);

    try {
      const analysis = await analyzeLayoutGuideImage(layoutGuideImage);
      setLayoutGuideDescription(analysis.description);
      setLayoutGuideWireframeUrl(analysis.wireframeImage);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Layout analysis failed.');
    } finally {
      setIsAnalyzingLayoutGuide(false);
    }
  }, [analyzeLayoutGuideImage, layoutGuideImage]);

  const handlePromptPaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const clipboardFiles = Array.from(event.clipboardData.files);
      const itemFiles = Array.from(event.clipboardData.items)
        .filter((item) => item.kind === 'file')
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file));
      const pastedFiles = clipboardFiles.length > 0 ? clipboardFiles : itemFiles;
      const pastedImages = pastedFiles.filter((file) => PROMPT_IMAGE_TYPES.includes(file.type));

      if (!pastedImages.length) return;

      event.preventDefault();
      addPromptImageFiles(pastedImages);
    },
    [addPromptImageFiles]
  );

  const pollJobUntilDone = async (jobId: number) => {
    const POLL_MS = 2000;
    const TIMEOUT_MS = 300_000;
    const start = Date.now();
    while (Date.now() - start < TIMEOUT_MS) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      try {
        const res = await fetch(handoffApiUrl(`/api/handoff/ai/design-generation-job/${jobId}`), { credentials: 'include' });
        if (!res.ok) break;
        const json = (await res.json()) as {
          job?: { id: number; status: string; stage: string; imageUrl?: string; error?: string; artifactId?: string };
        };
        const job = json.job;
        if (!job) break;
        setGeneratedImages((current) =>
          current.map((img) =>
            img.jobId === jobId
              ? {
                  ...img,
                  stage: job.stage,
                  status: job.status === 'done' ? 'completed' : job.status === 'failed' ? 'error' : 'pending',
                  src: job.imageUrl ?? img.src,
                  artifactId: job.artifactId ?? img.artifactId,
                  error: job.status === 'failed' ? (job.error ?? 'Generation failed.') : img.error,
                }
              : img
          )
        );
        if (job.status === 'done' || job.status === 'failed') break;
      } catch { /* ignore poll errors */ }
    }
  };

  const generateDesignImage = async ({
    submittedPrompt,
    submittedPromptImages,
    submittedLayoutGuideImage,
    submittedLayoutGuideWireframeUrl,
    submittedLayoutGuideDescription,
    clearPromptAfterSubmit,
    clearPromptImagesAfterSubmit,
  }: {
    submittedPrompt: string;
    submittedPromptImages: File[];
    submittedLayoutGuideImage: File | null;
    submittedLayoutGuideWireframeUrl: string;
    submittedLayoutGuideDescription: string;
    clearPromptAfterSubmit: boolean;
    clearPromptImagesAfterSubmit: boolean;
  }): Promise<string> => {
    setError(null);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const submittedAt = new Date().toISOString();
    const refining = Boolean(imageSrc);

    selectedGeneratedImageIdRef.current = requestId;
    setSelectedGeneratedImageId(requestId);
    setImageSrc(null);
    setGeneratedImages((current) => [{ id: requestId, prompt: submittedPrompt, status: 'pending', createdAt: submittedAt }, ...current]);
    if (clearPromptAfterSubmit) setPrompt('');
    if (clearPromptImagesAfterSubmit) {
      setPromptImages([]);
      if (promptImageInputRef.current) promptImageInputRef.current.value = '';
    }

    try {
      const formData = new FormData();
      const attachedImageLabels: string[] = [];
      formData.append('prompt', submittedPrompt);
      formData.append('foundationContext', JSON.stringify(promptedFoundations));
      formData.append('componentGuides', JSON.stringify(selectedGuides.map((guide) => ({ ...guide, previewUrl: null }))));
      formData.append('designGuidelines', designMd);
      formData.append('brandVoiceGuidelines', brandVoiceGuidelines);
      formData.append('quality', imageQuality);
      formData.append('promptImageCount', String(submittedPromptImages.length));
      formData.append('layoutGuideDescription', submittedLayoutGuideDescription);
      formData.append('conversationHistory', JSON.stringify(conversationHistory));
      if (draftArtifactIdRef.current) formData.append('artifactId', draftArtifactIdRef.current);

      if (refining && imageSrc) {
        formData.append('image[]', await dataUrlToFile(imageSrc, 'current-canvas.png'));
        attachedImageLabels.push('Main canvas image the user is referring to for this request.');
      }

      if (customFoundationImage) {
        formData.append('customFoundationImage', await dataUrlToFile(customFoundationImage, CUSTOM_FOUNDATION_IMAGE_FILENAME));
      }
      for (const setting of COMPONENT_REFERENCE_SETTINGS) {
        const dataUrl = componentReferenceDataUrls[setting.id];
        if (dataUrl) {
          formData.append('image[]', await dataUrlToFile(dataUrl, setting.filename));
          attachedImageLabels.push(`${setting.filename}: saved ${setting.label.toLowerCase()} style reference from settings.`);
        }
      }
      if (submittedLayoutGuideWireframeUrl) {
        formData.append('image[]', await dataUrlToFile(submittedLayoutGuideWireframeUrl, 'layout-guide-wireframe.png'));
        formData.append('layoutGuideImageIncluded', 'true');
        attachedImageLabels.push(
          'layout-guide-wireframe.png: Layout Guide wireframe reference. Follow its structure only; ignore styling and exact copy.'
        );
      } else if (submittedLayoutGuideImage) {
        formData.append('image[]', submittedLayoutGuideImage);
        formData.append('layoutGuideImageIncluded', 'true');
        attachedImageLabels.push(
          `Layout Guide screenshot${submittedLayoutGuideImage.name ? ` (${submittedLayoutGuideImage.name})` : ''}: follow layout structure only; ignore styling and exact copy.`
        );
      } else {
        formData.append('layoutGuideImageIncluded', 'false');
      }
      submittedPromptImages.forEach((file, index) => {
        formData.append('image[]', file);
        attachedImageLabels.push(
          `User-attached prompt image ${index + 1}${file.name ? ` (${file.name})` : ''}: request-specific visual reference.`
        );
      });
      formData.append('attachedImageLabels', JSON.stringify(attachedImageLabels));

      const response = await fetch(handoffApiUrl('/api/handoff/ai/generate-design'), {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });

      if (!response.ok || response.headers.get('content-type')?.includes('application/json')) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || `Design API error (${response.status})`);
      }

      if (!response.body) throw new Error('No response body.');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let imageUrl: string | null = null;
      let doneJobId: number | undefined;
      let doneArtifactId: string | undefined;

      outer: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data:\s*/, '').trim();
          if (!line) continue;
          try {
            const evt = JSON.parse(line) as { stage?: string; imageUrl?: string; error?: string; jobId?: number; artifactId?: string };
            const stage = evt.stage ?? '';
            if (stage === 'error') throw new Error(evt.error || 'Generation failed.');
            if (stage === 'done') {
              imageUrl = evt.imageUrl ?? null;
              doneJobId = evt.jobId;
              doneArtifactId = evt.artifactId;
              break outer;
            }
            setGeneratedImages((current) =>
              current.map((img) => (img.id === requestId ? { ...img, stage } : img))
            );
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      if (!imageUrl) throw new Error('No image returned.');

      if (doneArtifactId) {
        setDraftArtifactId(doneArtifactId);
        draftArtifactIdRef.current = doneArtifactId;
      }

      const now = new Date().toISOString();
      setConversationHistory((h) => [
        ...h,
        { role: 'user', prompt: submittedPrompt, timestamp: now },
        { role: 'assistant', prompt: 'Generated image', imageUrl, timestamp: now },
      ]);

      if (selectedGeneratedImageIdRef.current === requestId) {
        setImageSrc(imageUrl);
      }
      setGeneratedImages((current) =>
        current.map((image) =>
          image.id === requestId
            ? {
                ...image,
                src: imageUrl!,
                status: 'completed',
                stage: undefined,
                createdAt: submittedAt,
                ts: submittedAt,
                jobId: doneJobId,
                artifactId: doneArtifactId,
              }
            : image
        )
      );
      return imageUrl;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to generate.';
      setError(message);
      setGeneratedImages((current) =>
        current.map((image) => (image.id === requestId ? { ...image, status: 'error', error: message, stage: undefined } : image))
      );
      throw e;
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (!isLoggedIn) {
      setError(LOGIN_TO_USE_TOOL_MESSAGE);
      return;
    }
    if (!serverAiAvailable) {
      setError(
        'Design generation needs server AI: set HANDOFF_AI_API_KEY, or HANDOFF_CLOUD_URL + HANDOFF_CLOUD_TOKEN to use your team cloud. Configure in Integrations / .env.'
      );
      return;
    }

    const refining = Boolean(imageSrc);
    const hasPromptImage = promptImages.length > 0;
    const hasCustomFoundationImage = Boolean(customFoundationImage);
    const hasSavedComponentReferences = Object.values(componentReferenceDataUrls).some(Boolean);
    const hasLayoutGuideReference = Boolean(layoutGuideImage || layoutGuideWireframeUrl);
    if (
      !refining &&
      !hasPromptImage &&
      !hasFoundationsForRaster &&
      !hasCustomFoundationImage &&
      !hasSavedComponentReferences &&
      !hasLayoutGuideReference
    ) {
      setError(
        'Attach a prompt image, add a Layout Guide, save component references in settings, use foundations, or add a custom foundation image in settings.'
      );
      return;
    }

    try {
      await generateDesignImage({
        submittedPrompt: prompt.trim(),
        submittedPromptImages: promptImages,
        submittedLayoutGuideImage: layoutGuideImage,
        submittedLayoutGuideWireframeUrl: layoutGuideWireframeUrl,
        submittedLayoutGuideDescription: layoutGuideDescription.trim(),
        clearPromptAfterSubmit: true,
        clearPromptImagesAfterSubmit: true,
      });
    } catch {
      // generateDesignImage already records the error in UI state.
    }
  };

  const handleOpenLayoutWizard = () => {
    if (layoutWizardOpen || layoutWizardTransitioning || layoutWizardClosing) return;
    if (layoutWizardTransitionTimerRef.current) {
      window.clearTimeout(layoutWizardTransitionTimerRef.current);
    }
    setLayoutWizardStatus('idle');
    setLayoutWizardDisplayWireframeUrl('');
    setLayoutWizardDisplayDescription('');
    setPromptSuggestionsOpen(false);
    setError(null);
    setLayoutWizardClosing(false);
    setLayoutWizardTransitioning(true);
    layoutWizardTransitionTimerRef.current = window.setTimeout(() => {
      setLayoutWizardOpen(true);
      setLayoutWizardTransitioning(false);
      layoutWizardTransitionTimerRef.current = null;
    }, 190);
  };

  const handleCloseLayoutWizard = () => {
    if (layoutWizardTransitionTimerRef.current) {
      window.clearTimeout(layoutWizardTransitionTimerRef.current);
      layoutWizardTransitionTimerRef.current = null;
    }
    layoutWizardRunIdRef.current += 1;
    setLayoutWizardTransitioning(false);
    setError(null);
    if (!layoutWizardOpen) {
      setLayoutWizardOpen(false);
      setLayoutWizardClosing(false);
      setLayoutGuideFile(null);
      return;
    }
    setLayoutWizardClosing(true);
    layoutWizardTransitionTimerRef.current = window.setTimeout(() => {
      setLayoutWizardOpen(false);
      setLayoutWizardClosing(false);
      setLayoutGuideFile(null);
      layoutWizardTransitionTimerRef.current = null;
    }, 190);
  };

  const handleGenerateLayoutWizard = async () => {
    if (!layoutGuideImage) {
      setError('Upload or paste a layout image first.');
      return;
    }
    if (!isLoggedIn) {
      setError(LOGIN_TO_USE_TOOL_MESSAGE);
      return;
    }
    if (!serverAiAvailable) {
      setError(
        'Design generation needs server AI: set HANDOFF_AI_API_KEY, or HANDOFF_CLOUD_URL + HANDOFF_CLOUD_TOKEN to use your team cloud. Configure in Integrations / .env.'
      );
      return;
    }

    setError(null);
    const runId = (layoutWizardRunIdRef.current += 1);
    try {
      setLayoutWizardStatus('analyzing');
      const analysis = await analyzeLayoutGuideImage(layoutGuideImage);
      if (runId !== layoutWizardRunIdRef.current) return;
      setLayoutGuideDescription(analysis.description);
      setLayoutGuideWireframeUrl(analysis.wireframeImage);
      setLayoutWizardDisplayDescription(analysis.description);
      setLayoutWizardDisplayWireframeUrl(analysis.wireframeImage);

      setLayoutWizardStatus('generating');
      await generateDesignImage({
        submittedPrompt: LAYOUT_WIZARD_PROMPT,
        submittedPromptImages: [],
        submittedLayoutGuideImage: layoutGuideImage,
        submittedLayoutGuideWireframeUrl: analysis.wireframeImage,
        submittedLayoutGuideDescription: analysis.description,
        clearPromptAfterSubmit: false,
        clearPromptImagesAfterSubmit: false,
      });
      if (runId !== layoutWizardRunIdRef.current) return;
      setLayoutWizardStatus('done');
      setLayoutWizardOpen(false);
      setLayoutGuideFile(null);
    } catch (e) {
      if (runId !== layoutWizardRunIdRef.current) return;
      setLayoutWizardStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not generate a design from this layout.');
    }
  };

  const handleStartFresh = () => {
    // Clear both the persisted session AND the in-memory state that feeds the
    // auto-save effect. Without clearing state, the effect would immediately
    // re-persist imageSrc/conversationHistory and the restore bar would return
    // on the next visit. Generation thumbnails are left alone (jobs API-backed).
    clearWorkbenchSession();
    setResumeSession(null);
    setImageSrc(null);
    setConversationHistory([]);
    setDraftArtifactId(null);
    draftArtifactIdRef.current = null;
    selectedGeneratedImageIdRef.current = null;
    setSelectedGeneratedImageId(null);
    setLayoutWizardDisplayWireframeUrl('');
    setLayoutWizardDisplayDescription('');
  };

  // Clicking an assistant thumbnail in the chat puts that generation back on the canvas.
  const handleSelectHistoryImage = (url: string) => {
    // Preview only: while a generation is in flight, keep its selection intact —
    // clearing it would drop the chat's loading indicator and stop the finished
    // image from landing on the canvas.
    if (!isGenerating) {
      selectedGeneratedImageIdRef.current = null;
      setSelectedGeneratedImageId(null);
    }
    setImageSrc(resolveHistoryImageSrc(url));
  };

  // Attach a curated block screenshot as a prompt image, same as a manual upload.
  const handleAttachBlock = async (block: { file: string; label: string }) => {
    try {
      const res = await fetch(`${basePath}/assets/design/blocks/${block.file}`);
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      addPromptImageFiles([new File([blob], block.file, { type: blob.type || 'image/jpeg' })]);
      setBlocksOpen(false);
    } catch {
      setError(`Could not load the "${block.label}" block image.`);
    }
  };

  const handleDownloadImage = (imageUrl: string, generationNumber: number) => {
    const link = document.createElement('a');
    link.href = resolveHistoryImageSrc(imageUrl);
    link.download = `handoff-generation-${generationNumber}.png`;
    link.click();
  };

  const handleOpenSaveFromChat = (imageUrl: string, generationNumber: number) => {
    const defaultTitle = `Generation ${generationNumber}`;
    setSaveImageSrc(resolveHistoryImageSrc(imageUrl));
    setSaveDefaultTitle(defaultTitle);
    setSaveTitle(defaultTitle);
    setSaveDescription('');
    setSaveError(null);
    setSaveOpen(true);
  };

  const handleSaveArtifact = async () => {
    const title = (saveTitle.trim() || saveDefaultTitle.trim()).trim();
    if (!title) {
      setSaveError('Title is required.');
      return;
    }
    if (!saveImageSrc) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/ai/design-artifact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          description: saveDescription.trim(),
          status: 'review',
          imageUrl: saveImageSrc,
          sourceImages: [],
          componentGuides: selectedGuides,
          foundationContext: promptedFoundations,
          conversationHistory,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) throw new Error(json.error || 'Save failed');
      setSaveOpen(false);
      setSaveTitle('');
      setSaveDefaultTitle('');
      setSaveDescription('');
      setSaveImageSrc(null);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const isLayoutWizardRunning = layoutWizardStatus === 'analyzing' || layoutWizardStatus === 'generating';

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata} fullBleed>
      <>
      {resumeSession ? (
        <div className="flex shrink-0 items-center justify-between border-b bg-amber-50 px-4 py-2 text-sm dark:bg-amber-950/30">
          <span className="text-amber-800 dark:text-amber-300">
            You have an unsaved session from {new Date(resumeSession.savedAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })} — restore it?
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => {
                if (resumeSession.imageSrc) setImageSrc(resumeSession.imageSrc);
                if (resumeSession.conversationHistory.length) {
                  setConversationHistory(resumeSession.conversationHistory as DesignConversationTurn[]);
                }
                if (resumeSession.draftArtifactId) {
                  setDraftArtifactId(resumeSession.draftArtifactId);
                  draftArtifactIdRef.current = resumeSession.draftArtifactId;
                }
                const restored: GeneratedImage[] = resumeSession.recentImages.map((r) => ({
                  id: r.id,
                  src: r.src,
                  prompt: r.prompt,
                  status: 'completed' as const,
                  createdAt: r.ts,
                  ts: r.ts,
                }));
                if (restored.length) setGeneratedImages(restored);
                setResumeSession(null);
              }}
            >
              Restore
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={handleStartFresh}
            >
              Start fresh
            </Button>
          </div>
        </div>
      ) : null}
      <div className="relative flex h-full min-h-0 overflow-hidden bg-background">
        {!serverAiAvailable ? (
          <p className="absolute left-1/2 top-4 z-20 w-[min(44rem,calc(100%-2rem))] -translate-x-1/2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            Design workbench needs server AI: <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_AI_API_KEY</code> or{' '}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_CLOUD_URL</code> +{' '}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_CLOUD_TOKEN</code>.
          </p>
        ) : null}
        <input
          ref={layoutGuideInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => handleLayoutGuideUpload(e.target.files)}
        />
        <input
          ref={promptImageInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => addPromptImageFiles(e.target.files)}
        />

        <div
          className="relative min-h-0 flex-1 overflow-hidden bg-gray-50"
          style={{
            backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        >
          <div className="absolute inset-0">
            <TransformWrapper
              initialScale={CANVAS_INITIAL_SCALE}
              minScale={CANVAS_MIN_SCALE}
              maxScale={4}
              centerOnInit
              centerZoomedOut
              disablePadding
              wheel={{ step: TRACKPAD_ZOOM_STEP }}
              doubleClick={{ mode: 'reset' }}
            >
              {({ zoomIn, zoomOut, resetTransform }) => (
                <>
                  <TooltipProvider delayDuration={200}>
                    <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
                      {imageSrc && (layoutWizardDisplayWireframeUrl || layoutWizardDisplayDescription) ? (
                        <div className="flex items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
                          {layoutWizardDisplayWireframeUrl ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 px-0" aria-label="Show layout wireframe">
                                  <LayoutGridIcon className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="top" align="end" sideOffset={8} className="border bg-background p-2 text-foreground shadow-md">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={layoutWizardDisplayWireframeUrl}
                                  alt="Layout wireframe"
                                  className="max-h-64 w-auto max-w-sm object-contain"
                                />
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                          {layoutWizardDisplayDescription ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 px-0" aria-label="Show layout description">
                                  <FileTextIcon className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent
                                side="top"
                                align="end"
                                sideOffset={8}
                                className="max-h-64 max-w-sm overflow-y-auto border bg-background px-3 py-2 text-left text-xs leading-relaxed text-foreground shadow-md"
                              >
                                {layoutWizardDisplayDescription}
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="flex items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
                        <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={() => zoomOut()} aria-label="Zoom out">
                          <ZoomOutIcon className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={() => resetTransform()} aria-label="Reset zoom">
                          <RotateCcwIcon className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={() => zoomIn()} aria-label="Zoom in">
                          <ZoomInIcon className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </TooltipProvider>

                  <TransformComponent wrapperClass="!h-full !w-full cursor-grab active:cursor-grabbing" contentClass="!h-fit !w-fit">
                    <div className="relative flex h-[1152px] w-[2048px] items-center justify-center">
                      {imageSrc ? (
                        <Image
                          src={imageSrc}
                          alt={prompt || 'Generated design'}
                          width={CANVAS_WIDTH}
                          height={CANVAS_HEIGHT}
                          unoptimized
                          className="h-auto max-h-[calc(100%-160px)] w-auto max-w-[calc(100%-160px)] rounded-md bg-background object-contain shadow-lg"
                        />
                      ) : (
                        <div className="h-full w-full bg-gray-50" aria-hidden="true" />
                      )}
                    </div>
                  </TransformComponent>
                </>
              )}
            </TransformWrapper>
          </div>

          {!imageSrc ? (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-gray-50 px-6 text-center">
              {layoutWizardOpen ? (
                <div
                  className={`relative w-full max-w-3xl space-y-5 transition-all duration-200 ease-out ${
                    layoutWizardClosing
                      ? 'scale-95 opacity-0 blur-md'
                      : 'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-300 scale-100 opacity-100 blur-0'
                  }`}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-0 h-9 w-9 rounded-full p-0 text-gray-500 hover:bg-white hover:text-gray-900"
                    onClick={handleCloseLayoutWizard}
                    disabled={isLayoutWizardRunning}
                    aria-label="Close layout wizard"
                  >
                    <XIcon className="h-4 w-4" />
                  </Button>
                  <p className="px-10 text-sm text-gray-500">Upload or paste a screenshot, wireframe, or sketch.</p>
                  {layoutGuidePreviewUrl ? (
                    <div className="mx-auto max-w-2xl overflow-hidden rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={layoutGuidePreviewUrl} alt="Layout guide" className="max-h-[42vh] w-full rounded-lg bg-gray-50 object-contain" />
                    </div>
                  ) : (
                    <div className="mx-auto flex h-44 max-w-2xl items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white/70">
                      <WandSparklesIcon className="h-10 w-10 text-gray-300" />
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {!layoutGuideImage ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="rounded-full px-5"
                          onClick={() => layoutGuideInputRef.current?.click()}
                          disabled={isLayoutWizardRunning}
                        >
                          Browse
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-full px-5"
                          onClick={() => void handlePasteLayoutGuide()}
                          disabled={isLayoutWizardRunning}
                        >
                          <ClipboardIcon className="mr-2 h-3.5 w-3.5" />
                          Paste
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="rounded-full px-5"
                        onClick={() => void handleGenerateLayoutWizard()}
                        disabled={!serverAiAvailable || !isLoggedIn || isLayoutWizardRunning}
                        title={
                          !isLoggedIn
                            ? LOGIN_TO_USE_TOOL_MESSAGE
                            : !serverAiAvailable
                              ? 'Configure server AI in Integrations or .env'
                              : undefined
                        }
                      >
                        {isLayoutWizardRunning ? (
                          <>
                            <Loader2Icon className="mr-2 h-3.5 w-3.5 animate-spin" />
                            {layoutWizardStatus === 'analyzing' ? 'Analyzing...' : 'Generating...'}
                          </>
                        ) : (
                          'Generate design'
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  className={`space-y-5 transition-all duration-200 ease-out ${
                    layoutWizardTransitioning
                      ? 'scale-95 opacity-0 blur-md'
                      : 'animate-in fade-in-0 zoom-in-95 duration-300 scale-100 opacity-100 blur-0'
                  }`}
                >
                  <p className="text-xl font-regular text-foreground">{isGenerating ? 'Generating design...' : 'What are we designing today?'}</p>
                  {!isGenerating ? (
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="[&_svg]:size-3 rounded-full bg-transparent px-5 h-10 font-normal shadow-none"
                        onClick={handleOpenLayoutWizard}
                      >
                        <WandSparklesIcon className="h-2.5 w-2.5" />
                        Layout wizard
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="[&_svg]:size-3 rounded-full bg-transparent px-5 h-10 font-normal shadow-none"
                        onClick={() => setPromptSuggestionsOpen((open) => !open)}
                        aria-expanded={promptSuggestionsOpen}
                      >
                        <LightbulbIcon className="h-2.5 w-2.5" />
                        Try a prompt
                      </Button>
                    </div>
                  ) : null}
                  {!isGenerating && promptSuggestionsOpen ? (
                    <div className="mx-auto w-full max-w-md animate-in fade-in-0 slide-in-from-bottom-2 duration-200 rounded-2xl border border-gray-200 bg-white p-2 text-left shadow-lg">
                      <div className="flex items-center justify-between px-3 py-2">
                        <p className="text-xs font-medium text-gray-500">Prompt suggestions</p>
                        <button
                          type="button"
                          className="text-xs font-medium text-gray-500 transition hover:text-gray-900"
                          onClick={() => setPromptSuggestionsOpen(false)}
                        >
                          Close
                        </button>
                      </div>
                      <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                        {PROMPT_SUGGESTIONS.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            className="block w-full rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 hover:text-gray-900"
                            onClick={() => {
                              setPrompt(suggestion);
                              setPromptSuggestionsOpen(false);
                            }}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}

        </div>

        <aside className="flex w-80 shrink-0 flex-col border-l bg-background">
          {chatEmpty ? (
            <div className="flex min-h-0 flex-1 flex-col justify-end gap-3 overflow-y-auto p-4">
              <div className="mb-1 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
                <PenNib className="h-6 w-6 text-muted-foreground" aria-hidden />
              </div>
              <p className="text-sm font-semibold">Design, refine, and iterate with your design system</p>
              <div className="space-y-0.5">
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  onClick={handleOpenLayoutWizard}
                >
                  <WandSparklesIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">Design from existing block...</span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-muted-foreground transition hover:bg-muted hover:text-foreground"
                  onClick={() => setChatSuggestionsOpen((open) => !open)}
                  aria-expanded={chatSuggestionsOpen}
                >
                  <LightbulbIcon className="h-4 w-4 shrink-0" />
                  <span className="truncate">Try a prompt...</span>
                </button>
                {chatSuggestionsOpen ? (
                  <div className="space-y-2 pt-1">
                    {CHAT_EMPTY_SUGGESTIONS.map((text) => (
                      <button
                        key={text}
                        type="button"
                        className="block w-full rounded-lg bg-gray-100/60 px-2 py-2 text-left text-xs leading-snug text-muted-foreground transition hover:bg-gray-100 hover:text-foreground"
                        onClick={() => setPrompt(text)}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <MessageScrollerProvider>
              <MessageScroller className="min-h-0 flex-1">
                <MessageScrollerViewport className="px-3">
                  <MessageScrollerContent className="gap-4 py-4">
                    {conversationHistory.map((turn, index) => {
                      if (turn.role === 'user') {
                        return (
                          <MessageScrollerItem key={`turn-${index}`} messageId={`turn-${index}`} scrollAnchor>
                            <Message align="end">
                              <MessageContent>
                                <Bubble align="end">
                                  <BubbleContent>{turn.prompt}</BubbleContent>
                                </Bubble>
                              </MessageContent>
                            </Message>
                          </MessageScrollerItem>
                        );
                      }
                      const generationNumber = conversationHistory
                        .slice(0, index + 1)
                        .filter((t) => t.role === 'assistant').length;
                      return (
                        <MessageScrollerItem key={`turn-${index}`} messageId={`turn-${index}`}>
                          <Message>
                            <MessageContent>
                              <Bubble variant="outline">
                                <BubbleContent asChild className="p-1">
                                  <button
                                    type="button"
                                    onClick={() => turn.imageUrl && handleSelectHistoryImage(turn.imageUrl)}
                                    title="Show on canvas"
                                  >
                                    {turn.imageUrl ? (
                                      <Image
                                        src={resolveHistoryImageSrc(turn.imageUrl)}
                                        alt={turn.prompt || 'Generated design'}
                                        width={192}
                                        height={108}
                                        unoptimized
                                        className="h-28 w-52 rounded-lg object-cover"
                                      />
                                    ) : (
                                      <span className="px-2 py-1 text-xs text-muted-foreground">{turn.prompt}</span>
                                    )}
                                  </button>
                                </BubbleContent>
                              </Bubble>
                              <MessageFooter className="gap-0.5">
                                {turn.timestamp ? <span className="mr-1">{formatGenerationTimestamp(turn.timestamp)}</span> : null}
                                {turn.imageUrl ? (
                                  <>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      className="text-muted-foreground hover:text-foreground"
                                      onClick={() => handleOpenSaveFromChat(turn.imageUrl!, generationNumber)}
                                      aria-label="Add to Library"
                                      title="Add to Library"
                                    >
                                      <LibraryIcon className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-xs"
                                      className="text-muted-foreground hover:text-foreground"
                                      onClick={() => handleDownloadImage(turn.imageUrl!, generationNumber)}
                                      aria-label="Download PNG"
                                      title="Download PNG"
                                    >
                                      <DownloadIcon className="h-3.5 w-3.5" />
                                    </Button>
                                  </>
                                ) : null}
                              </MessageFooter>
                            </MessageContent>
                          </Message>
                        </MessageScrollerItem>
                      );
                    })}
                    {isGenerating && activeGeneration ? (
                      <>
                        <MessageScrollerItem messageId="pending-user" scrollAnchor>
                          <Message align="end">
                            <MessageContent>
                              <Bubble align="end">
                                <BubbleContent>{activeGeneration.prompt}</BubbleContent>
                              </Bubble>
                            </MessageContent>
                          </Message>
                        </MessageScrollerItem>
                        <MessageScrollerItem messageId="pending-status">
                          <Marker>
                            <MarkerIcon>
                              <Loader2Icon className="animate-spin" />
                            </MarkerIcon>
                            <MarkerContent>Making the design...</MarkerContent>
                          </Marker>
                        </MessageScrollerItem>
                      </>
                    ) : null}
                    {error ? (
                      <MessageScrollerItem messageId="chat-error">
                        <Marker>
                          <MarkerIcon>
                            <AlertCircleIcon className="text-destructive" />
                          </MarkerIcon>
                          <MarkerContent className="text-destructive">{error}</MarkerContent>
                        </Marker>
                      </MessageScrollerItem>
                    ) : null}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          )}
            <div className="border-t p-3">
              {promptImages.length > 0 ? (
                <AttachmentGroup className="mb-2">
                  {promptImages.map((file, i) => (
                    <Attachment key={`${file.name}-${file.lastModified}-${i}`} size="sm">
                      <AttachmentMedia variant="image">
                        {promptImagePreviewUrls[i] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={promptImagePreviewUrls[i]} alt="" />
                        ) : null}
                      </AttachmentMedia>
                      <AttachmentContent>
                        <AttachmentTitle>{file.name || 'Pasted image'}</AttachmentTitle>
                      </AttachmentContent>
                      <AttachmentActions>
                        <AttachmentAction
                          aria-label={`Remove ${file.name || 'attached image'}`}
                          onClick={() => {
                            setPromptImages((current) => current.filter((_, idx) => idx !== i));
                            if (promptImageInputRef.current) promptImageInputRef.current.value = '';
                          }}
                        >
                          <XIcon />
                        </AttachmentAction>
                      </AttachmentActions>
                    </Attachment>
                  ))}
                </AttachmentGroup>
              ) : null}
              <div>
                <Label htmlFor="design-chat-prompt" className="sr-only">
                  {imageSrc ? 'Refine' : 'Prompt'}
                </Label>
                <div className="px-1 pt-1.5">
                  <textarea
                    id="design-chat-prompt"
                    data-design-prompt
                    ref={chatPromptRef}
                    rows={1}
                    className="max-h-40 w-full resize-none border-0 bg-transparent p-0 text-sm leading-6 field-sizing-content placeholder:text-muted-foreground focus:outline-none focus:ring-0"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onPaste={handlePromptPaste}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        if (!isGenerating) void handleGenerate();
                      }
                    }}
                    placeholder={imageSrc ? 'Describe a change to this design...' : 'Describe the design you want...'}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-2">
                  <div className="flex items-center">
                    <Select value={imageQuality} onValueChange={(value) => setImageQuality(value as ImageQuality)}>
                      <SelectTrigger
                        className="h-8 w-auto gap-1 border-0 px-2 text-xs font-medium text-muted-foreground shadow-none hover:bg-muted hover:text-foreground focus:ring-0"
                        aria-label="Image quality"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="start">
                        {IMAGE_QUALITY_OPTIONS.map((quality) => (
                          <SelectItem key={quality} value={quality}>
                            {quality[0].toUpperCase()}
                            {quality.slice(1)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      onClick={() => setBlocksOpen(true)}
                      aria-label="Attach a block from the library"
                      title="Attach a block from the library"
                    >
                      <PanelsTopLeftIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground"
                      onClick={() => promptImageInputRef.current?.click()}
                      aria-label="Attach image to this prompt"
                    >
                      <PaperclipIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      className="rounded-full"
                      onClick={() => void handleGenerate()}
                      disabled={!prompt.trim() || !serverAiAvailable || !isLoggedIn || isGenerating}
                      title={
                        !isLoggedIn
                          ? LOGIN_TO_USE_TOOL_MESSAGE
                          : !serverAiAvailable
                            ? 'Configure server AI in Integrations or .env'
                            : undefined
                      }
                      aria-label={imageSrc ? 'Refine design' : 'Generate design'}
                    >
                      {isGenerating ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <ArrowUpIcon className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
        </aside>
      </div>
      <Dialog open={blocksOpen} onOpenChange={setBlocksOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Attach a block</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Pick a block from the library to attach it to your prompt as a reference.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {BLOCK_LIBRARY.map((block) => (
              <button
                key={block.file}
                type="button"
                className="group overflow-hidden rounded-lg border bg-muted/20 text-left transition hover:border-primary"
                onClick={() => void handleAttachBlock(block)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${basePath}/assets/design/blocks/${block.file}`}
                  alt={block.label}
                  className="aspect-video w-full bg-white object-cover"
                />
                <p className="px-2 py-1.5 text-xs font-medium">{block.label}</p>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Save design for review</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {saveImageSrc ? (
              <div className="relative mx-auto aspect-video w-full overflow-hidden rounded-md">
                <Image src={saveImageSrc} alt="Preview" fill className="object-contain" unoptimized />
              </div>
            ) : null}
            <div className="space-y-1">
              <Label htmlFor="artifact-title">Title</Label>
              <Input
                id="artifact-title"
                value={saveTitle}
                onChange={(e) => {
                  setSaveTitle(e.target.value);
                  setSaveError(null);
                }}
                placeholder="e.g. Hero - pricing page"
              />
              {saveError ? <p className="text-xs text-destructive">{saveError}</p> : null}
            </div>
            <div className="space-y-1">
              <Label htmlFor="artifact-desc">Description and assets</Label>
              <Textarea
                id="artifact-desc"
                value={saveDescription}
                onChange={(e) => setSaveDescription(e.target.value)}
                rows={5}
                placeholder="What this design is for, copy notes, and image assets needed to build the component..."
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Saves with status <strong>review</strong>. {conversationHistory.length} conversation step(s).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveArtifact()} disabled={!(saveTitle.trim() || saveDefaultTitle.trim()) || isSaving}>
              {isSaving ? <Loader2Icon className="h-4 w-4 animate-spin" /> : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </>
    </Layout>
  );
};

export default DesignWorkbenchPage;
