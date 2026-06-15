'use client';

import {
  ArrowUpIcon,
  ClipboardIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  EyeOffIcon,
  FileTextIcon,
  LayoutGridIcon,
  LibraryIcon,
  LightbulbIcon,
  Loader2Icon,
  MoreHorizontalIcon,
  PaperclipIcon,
  RotateCcwIcon,
  SettingsIcon,
  Trash2Icon,
  WandSparklesIcon,
  XIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import Layout from '../../components/Layout/Main';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs';
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
} from './workbench-types';
import { COMPONENT_REFERENCE_SETTINGS, CUSTOM_FOUNDATION_IMAGE_FILENAME } from './settings/settings-constants';

type GeneratedImage = {
  id: string;
  src?: string;
  prompt: string;
  status: 'pending' | 'completed' | 'error';
  createdAt: string;
  error?: string;
};

type LayoutWizardStatus = 'idle' | 'analyzing' | 'generating' | 'done';
type SidebarTab = 'session' | 'layout' | 'library';

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
};

const IMAGE_QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;
type ImageQuality = (typeof IMAGE_QUALITY_OPTIONS)[number];
const EMPTY_FOUNDATIONS: DesignWorkbenchFoundationContext = { colors: [], typography: [], effects: [], spacing: [] };
const PROMPT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const CANVAS_WIDTH = 2048;
const CANVAS_HEIGHT = 1152;
const CANVAS_INITIAL_SCALE = 0.35;
const CANVAS_MIN_SCALE = 0.2;
const CANVAS_PROMPT_SAFE_AREA = 144;
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

function formatGenerationTimestamp(createdAt: string): string {
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

async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
}

const NewDesignClient = ({
  menu,
  metadata,
  current,
  config,
  isLoggedIn,
  serverAiAvailable,
  foundations,
  loadArtifactId,
}: DesignClientProps) => {
  const router = useRouter();
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const promptImageInputRef = useRef<HTMLInputElement>(null);
  const layoutGuideInputRef = useRef<HTMLInputElement>(null);
  const selectedGeneratedImageIdRef = useRef<string | null>(null);
  const layoutWizardRunIdRef = useRef(0);

  const [promptImages, setPromptImages] = useState<File[]>([]);
  const [promptImagePreviewUrls, setPromptImagePreviewUrls] = useState<string[]>([]);
  const [layoutGuideImage, setLayoutGuideImage] = useState<File | null>(null);
  const [layoutGuidePreviewUrl, setLayoutGuidePreviewUrl] = useState('');
  const [layoutGuideDescription, setLayoutGuideDescription] = useState('');
  const [layoutGuideWireframeUrl, setLayoutGuideWireframeUrl] = useState('');
  const [isAnalyzingLayoutGuide, setIsAnalyzingLayoutGuide] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [promptSuggestionsOpen, setPromptSuggestionsOpen] = useState(false);
  const [imageQuality, setImageQuality] = useState<ImageQuality>('auto');
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
  const [isSaving, setIsSaving] = useState(false);
  const [layoutWizardOpen, setLayoutWizardOpen] = useState(false);
  const [layoutWizardStatus, setLayoutWizardStatus] = useState<LayoutWizardStatus>('idle');
  const [layoutWizardResultUrl, setLayoutWizardResultUrl] = useState('');
  const [layoutWizardShowOriginal, setLayoutWizardShowOriginal] = useState(false);
  const [layoutWizardRevealComplete, setLayoutWizardRevealComplete] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<SidebarTab>('session');

  useEffect(() => {
    setEffectiveFoundations(foundations);
  }, [foundations]);

  useEffect(() => {
    if (!layoutWizardResultUrl) {
      setLayoutWizardRevealComplete(false);
      return;
    }
    setLayoutWizardShowOriginal(false);
    const timer = window.setTimeout(() => setLayoutWizardRevealComplete(true), 1120);
    return () => window.clearTimeout(timer);
  }, [layoutWizardResultUrl]);

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
        setImageSrc(artifact.imageUrl);
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

  const promptedFoundations = includeFoundations ? effectiveFoundations : EMPTY_FOUNDATIONS;
  const customFoundationImage = !includeFoundations ? customFoundationImageDataUrl : '';
  const brandVoiceGuidelines = useMemo(() => formatBrandVoiceForPrompt(brandVoice), [brandVoice]);
  const selectedGuides = useMemo<DesignWorkbenchComponentGuide[]>(() => [], []);
  const activeGeneration = generatedImages.find((image) => image.id === selectedGeneratedImageIdRef.current);
  const isGenerating = activeGeneration?.status === 'pending';

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
    setLayoutWizardResultUrl('');
    setLayoutWizardStatus('idle');
    setLayoutWizardShowOriginal(false);
    setLayoutWizardRevealComplete(false);
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
    (event: React.ClipboardEvent<HTMLInputElement>) => {
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
      const json = (await response.json().catch(() => ({}))) as { image?: string; error?: string };
      if (!response.ok) throw new Error(json.error || `Design API error (${response.status})`);
      if (!json.image) throw new Error('No image returned.');

      const now = new Date().toISOString();
      setConversationHistory((h) => [
        ...h,
        { role: 'user', prompt: submittedPrompt, timestamp: now },
        { role: 'assistant', prompt: 'Generated image', imageUrl: json.image!, timestamp: now },
      ]);

      if (selectedGeneratedImageIdRef.current === requestId) {
        setImageSrc(json.image);
      }
      setGeneratedImages((current) =>
        current.map((image) => (image.id === requestId ? { ...image, src: json.image, status: 'completed' } : image))
      );
      return json.image;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to generate.';
      setError(message);
      setGeneratedImages((current) =>
        current.map((image) => (image.id === requestId ? { ...image, status: 'error', error: message } : image))
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
    setLayoutWizardOpen(true);
    setLayoutWizardStatus('idle');
    setLayoutWizardResultUrl('');
    setLayoutWizardShowOriginal(false);
    setLayoutWizardRevealComplete(false);
    setError(null);
  };

  const handleCloseLayoutWizard = () => {
    layoutWizardRunIdRef.current += 1;
    setLayoutWizardOpen(false);
    setLayoutGuideFile(null);
    setError(null);
  };

  const handleAddLayoutWizardToWorkbench = () => {
    if (!layoutWizardResultUrl) return;
    setImageSrc(layoutWizardResultUrl);
    setActiveSidebarTab('session');
    handleCloseLayoutWizard();
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

    setLayoutWizardResultUrl('');
    setLayoutWizardShowOriginal(false);
    setLayoutWizardRevealComplete(false);
    setError(null);
    const runId = (layoutWizardRunIdRef.current += 1);
    try {
      setLayoutWizardStatus('analyzing');
      const analysis = await analyzeLayoutGuideImage(layoutGuideImage);
      if (runId !== layoutWizardRunIdRef.current) return;
      setLayoutGuideDescription(analysis.description);
      setLayoutGuideWireframeUrl(analysis.wireframeImage);

      setLayoutWizardStatus('generating');
      const generatedImage = await generateDesignImage({
        submittedPrompt: LAYOUT_WIZARD_PROMPT,
        submittedPromptImages: [],
        submittedLayoutGuideImage: layoutGuideImage,
        submittedLayoutGuideWireframeUrl: analysis.wireframeImage,
        submittedLayoutGuideDescription: analysis.description,
        clearPromptAfterSubmit: false,
        clearPromptImagesAfterSubmit: false,
      });
      if (runId !== layoutWizardRunIdRef.current) return;
      setLayoutWizardResultUrl(generatedImage);
      setLayoutWizardStatus('done');
    } catch (e) {
      if (runId !== layoutWizardRunIdRef.current) return;
      setLayoutWizardStatus('idle');
      setError(e instanceof Error ? e.message : 'Could not generate a design from this layout.');
    }
  };

  const handleDeleteGeneratedImage = (imageId: string) => {
    setGeneratedImages((current) => current.filter((image) => image.id !== imageId));
    if (selectedGeneratedImageIdRef.current === imageId) {
      selectedGeneratedImageIdRef.current = null;
      setSelectedGeneratedImageId(null);
      setImageSrc(null);
    }
  };

  const handleDownloadGeneratedImage = (img: GeneratedImage) => {
    if (!img.src) return;
    const link = document.createElement('a');
    link.href = img.src;
    link.download = `handoff-generation-${img.id}.png`;
    link.click();
  };

  const handleCopyGeneratedPrompt = async (promptText: string) => {
    if (!promptText) return;
    await navigator.clipboard.writeText(promptText);
  };

  const handleOpenSaveArtifact = (img: GeneratedImage, index: number) => {
    if (!img.src) return;
    const defaultTitle = `Generation ${generatedImages.length - index}`;
    setSaveImageSrc(img.src);
    setSaveDefaultTitle(defaultTitle);
    setSaveTitle(defaultTitle);
    setSaveDescription('');
    setError(null);
    setSaveOpen(true);
  };

  const handleSaveArtifact = async () => {
    const title = (saveTitle.trim() || saveDefaultTitle.trim()).trim();
    if (!title || !saveImageSrc) return;
    setIsSaving(true);
    setError(null);
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
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  const isLayoutWizardRunning = layoutWizardStatus === 'analyzing' || layoutWizardStatus === 'generating';

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata} fullBleed>
      <>
      <div className="relative flex h-full min-h-0 overflow-hidden bg-background">
        {!serverAiAvailable ? (
          <p className="absolute left-1/2 top-4 z-20 w-[min(44rem,calc(100%-2rem))] -translate-x-1/2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            Design workbench needs server AI: <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_AI_API_KEY</code> or{' '}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_CLOUD_URL</code> +{' '}
            <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_CLOUD_TOKEN</code>.
          </p>
        ) : null}

        {layoutWizardOpen ? (
          <div className="absolute inset-0 z-30 flex flex-col bg-background">
            <style>{`
              @keyframes layoutWizardSourceOut {
                0% {
                  opacity: 1;
                  filter: blur(0);
                  transform: scale(1);
                }
                100% {
                  opacity: 0;
                  filter: blur(18px);
                  transform: scale(0.985);
                }
              }
              @keyframes layoutWizardDesignIn {
                0% {
                  opacity: 0;
                  filter: blur(18px);
                  transform: scale(1.015);
                }
                100% {
                  opacity: 1;
                  filter: blur(0);
                  transform: scale(1);
                }
              }
              @keyframes layoutWizardActionsIn {
                0% {
                  opacity: 0;
                  transform: translateY(6px);
                }
                100% {
                  opacity: 1;
                  transform: translateY(0);
                }
              }
            `}</style>
            <TooltipProvider delayDuration={200}>
              <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
                {layoutWizardResultUrl && layoutGuideWireframeUrl ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 rounded-full bg-background/80 p-0 shadow-sm backdrop-blur"
                        aria-label="Show layout wireframe"
                      >
                        <LayoutGridIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      align="end"
                      sideOffset={8}
                      className="border bg-background p-2 text-foreground shadow-md"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={layoutGuideWireframeUrl}
                        alt="Layout wireframe"
                        className="max-h-64 w-auto max-w-sm object-contain"
                      />
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {layoutWizardResultUrl && layoutGuideDescription ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 rounded-full bg-background/80 p-0 shadow-sm backdrop-blur"
                        aria-label="Show layout description"
                      >
                        <FileTextIcon className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      align="end"
                      sideOffset={8}
                      className="max-h-64 max-w-sm overflow-y-auto border bg-background px-3 py-2 text-left text-xs leading-relaxed text-foreground shadow-md"
                    >
                      {layoutGuideDescription}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                {layoutWizardResultUrl && layoutGuidePreviewUrl ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 rounded-full bg-background/80 p-0 shadow-sm backdrop-blur"
                    onClick={() => setLayoutWizardShowOriginal((current) => !current)}
                    aria-label={layoutWizardShowOriginal ? 'Show generated design' : 'Show original layout'}
                    title={layoutWizardShowOriginal ? 'Show generated design' : 'Show original layout'}
                  >
                    {layoutWizardShowOriginal ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 rounded-full bg-background/80 p-0 shadow-sm backdrop-blur"
                  onClick={handleCloseLayoutWizard}
                  aria-label="Close layout wizard"
                >
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>
            </TooltipProvider>

            <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/40 p-8">
              <div className="w-full max-w-5xl space-y-4 text-center">
                <div className="relative aspect-video overflow-hidden rounded-xl border bg-background shadow-sm">
                  {layoutGuidePreviewUrl ? (
                    <div
                      className={`absolute inset-0 flex items-center justify-center bg-background transition-opacity duration-150 ${
                        layoutWizardResultUrl
                          ? layoutWizardShowOriginal
                            ? 'z-20 opacity-100'
                            : layoutWizardRevealComplete
                              ? 'z-0 opacity-0'
                              : 'z-20'
                          : 'z-10 opacity-100'
                      }`}
                      style={
                        layoutWizardResultUrl && !layoutWizardRevealComplete && !layoutWizardShowOriginal
                          ? { animation: 'layoutWizardSourceOut 1000ms ease-in-out 120ms forwards' }
                          : undefined
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={layoutGuidePreviewUrl} alt="Original layout" className="h-full w-full object-contain" />
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted/30">
                      <LibraryIcon className="h-12 w-12 text-muted-foreground/60" />
                    </div>
                  )}
                  {layoutWizardResultUrl ? (
                    <Image
                      src={layoutWizardResultUrl}
                      alt="Generated design from layout"
                      fill
                      sizes="(min-width: 1024px) 1024px, 100vw"
                      unoptimized
                      className={`object-contain transition-opacity duration-150 ${
                        layoutWizardShowOriginal ? 'opacity-0' : 'opacity-100'
                      }`}
                      style={
                        !layoutWizardRevealComplete && !layoutWizardShowOriginal
                          ? { animation: 'layoutWizardDesignIn 1000ms ease-in-out 120ms both' }
                          : undefined
                      }
                    />
                  ) : null}
                </div>

                {error ? <p className="text-sm text-destructive">{error}</p> : null}

                {layoutWizardResultUrl ? (
                  <div
                    className="flex justify-center gap-2"
                    style={{ animation: 'layoutWizardActionsIn 300ms ease-out 900ms both' }}
                  >
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAddLayoutWizardToWorkbench}
                    >
                      Add to workbench
                    </Button>
                    <Button type="button" onClick={() => setLayoutGuideFile(null)}>
                      Start another
                    </Button>
                  </div>
                ) : (
                  <div className="flex justify-center gap-2">
                    {layoutGuideImage ? (
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => layoutGuideInputRef.current?.click()}
                        disabled={isLayoutWizardRunning}
                      >
                        Change layout
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => layoutGuideInputRef.current?.click()}
                        disabled={isLayoutWizardRunning}
                      >
                        Upload Layout
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant={layoutGuideImage ? 'default' : 'outline'}
                      onClick={layoutGuideImage ? () => void handleGenerateLayoutWizard() : () => void handlePasteLayoutGuide()}
                      disabled={(layoutGuideImage && (!serverAiAvailable || !isLoggedIn)) || isLayoutWizardRunning}
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
                          <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                          {layoutWizardStatus === 'analyzing' ? 'Analyzing design...' : 'Generating design...'}
                        </>
                      ) : layoutGuideImage ? (
                        'Generate design'
                      ) : (
                        <>
                          <ClipboardIcon className="mr-2 h-4 w-4" />
                          Paste
                        </>
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        <aside className="flex w-56 shrink-0 flex-col border-r bg-background">
          <input
            ref={layoutGuideInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => handleLayoutGuideUpload(e.target.files)}
          />
          <Tabs
            value={activeSidebarTab}
            onValueChange={(value) => setActiveSidebarTab(value as SidebarTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="border-b px-3 py-3">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="session">Session</TabsTrigger>
                <TabsTrigger value="layout" className="hidden">
                  Layout
                </TabsTrigger>
                <TabsTrigger value="library">Library</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="session" className="m-0 flex min-h-0 flex-1 flex-col">
              <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
                {generatedImages.length > 0 ? (
                  generatedImages.map((img, index) => (
                    <div
                      key={img.id}
                      className="group relative"
                    >
                      <div className="mb-2 space-y-0.5">
                        <p className="text-xs font-medium">Generation {generatedImages.length - index}</p>
                        <p className="text-[11px] text-muted-foreground">{formatGenerationTimestamp(img.createdAt)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          selectedGeneratedImageIdRef.current = img.id;
                          setSelectedGeneratedImageId(img.id);
                          setImageSrc(img.src ?? null);
                        }}
                        className="block w-full rounded-lg border bg-muted/20 p-1 text-left transition hover:border-primary data-[selected=true]:border-primary"
                        data-selected={selectedGeneratedImageId === img.id}
                        title={img.error || img.prompt}
                      >
                        {img.status === 'completed' && img.src ? (
                          <Image
                            src={img.src}
                            alt={img.prompt}
                            width={192}
                            height={108}
                            unoptimized
                            className="h-20 w-full rounded-md object-cover"
                          />
                        ) : (
                          <div
                            className={`flex h-20 w-full items-center justify-center rounded-md text-xs text-muted-foreground ${
                              img.status === 'error' ? 'bg-destructive/10 text-destructive' : 'animate-pulse bg-muted'
                            }`}
                          >
                            {img.status === 'error' ? 'Failed' : 'Generating...'}
                          </div>
                        )}
                      </button>
                      <div className="absolute right-3 top-3">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-7 w-7 p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 data-[state=open]:opacity-100"
                              aria-label="Generation actions"
                            >
                              <MoreHorizontalIcon className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem disabled={!img.src} onClick={() => handleOpenSaveArtifact(img, index)}>
                              <LibraryIcon className="h-3.5 w-3.5" />
                              Add to Library
                            </DropdownMenuItem>
                            <DropdownMenuItem disabled={!img.src} onClick={() => handleDownloadGeneratedImage(img)}>
                              <DownloadIcon className="h-3.5 w-3.5" />
                              Download PNG
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void handleCopyGeneratedPrompt(img.prompt)}>
                              <CopyIcon className="h-3.5 w-3.5" />
                              Copy prompt
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteGeneratedImage(img.id)}>
                              <Trash2Icon className="h-3.5 w-3.5" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">Generations appear here for this session.</p>
                )}
              </div>
            </TabsContent>
            <TabsContent value="layout" className="hidden">
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Add a web section screenshot to use its layout structure.</p>
                {layoutGuidePreviewUrl ? (
                  <div className="group relative overflow-hidden rounded-md border bg-muted/20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={layoutGuidePreviewUrl} alt="Layout guide" className="max-h-36 w-full object-cover" />
                    <button
                      type="button"
                      className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded bg-background/90 text-muted-foreground opacity-0 shadow-sm transition hover:text-foreground group-hover:opacity-100"
                      onClick={() => setLayoutGuideFile(null)}
                      aria-label="Remove layout guide"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}
                {layoutGuidePreviewUrl ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      className="w-full"
                      onClick={() => void handleUseLayoutGuide()}
                      disabled={isAnalyzingLayoutGuide || !serverAiAvailable || !isLoggedIn}
                      title={
                        !isLoggedIn
                          ? LOGIN_TO_USE_TOOL_MESSAGE
                          : !serverAiAvailable
                            ? 'Configure server AI in Integrations or .env'
                            : undefined
                      }
                    >
                      {isAnalyzingLayoutGuide ? (
                        <>
                          <Loader2Icon className="mr-2 h-3.5 w-3.5 animate-spin" />
                          Analyzing...
                        </>
                      ) : (
                        'Use layout'
                      )}
                    </Button>
                    {layoutGuideDescription ? (
                      <p className="rounded-md border bg-muted/20 p-2 text-xs leading-relaxed text-muted-foreground">
                        {layoutGuideDescription}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" className="flex-1" onClick={() => layoutGuideInputRef.current?.click()}>
                      Upload Layout
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => void handlePasteLayoutGuide()}
                      aria-label="Paste layout image from clipboard"
                      title="Paste image from clipboard"
                    >
                      <ClipboardIcon className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-auto border-t pt-3">
                <Button type="button" className="w-full" onClick={handleOpenLayoutWizard}>
                  Make a design
                </Button>
              </div>
            </TabsContent>
            <TabsContent value="library" className="m-0 flex min-h-0 flex-1 flex-col p-4">
              <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-8 text-center">
                <p className="text-sm font-medium">Library</p>
                <p className="mt-1 text-xs text-muted-foreground">Library items will appear here.</p>
              </div>
            </TabsContent>
          </Tabs>
        </aside>

        <div
          className="relative min-h-0 flex-1 overflow-hidden bg-muted/70"
          style={{
            backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '18px 18px',
          }}
        >
          <div className="absolute inset-x-0 top-0" style={{ bottom: CANVAS_PROMPT_SAFE_AREA }}>
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
                  <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
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
                        <div className="h-full w-full bg-muted/70" aria-hidden="true" />
                      )}
                    </div>
                  </TransformComponent>
                </>
              )}
            </TransformWrapper>
          </div>

          {!imageSrc ? (
            <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-center bg-muted px-6 text-center" style={{ bottom: CANVAS_PROMPT_SAFE_AREA }}>
              <div className="space-y-5">
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
              </div>
            </div>
          ) : null}

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-5 pt-12">
            <div className="pointer-events-auto relative mx-auto w-full max-w-3xl">
              {error ? <p className="mb-2 text-sm text-destructive">{error}</p> : null}
              {!imageSrc && promptSuggestionsOpen ? (
                <div className="absolute inset-x-0 bottom-[calc(100%+0.5rem)] animate-in fade-in-0 slide-in-from-bottom-2 duration-200 rounded-2xl border border-gray-200 bg-white p-2 text-left shadow-lg">
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
              <div className="rounded-2xl border border-gray-200 bg-white shadow-lg">
                <Label htmlFor="design-prompt" className="sr-only">
                  {imageSrc ? 'Refine' : 'Prompt'}
                </Label>
                <input
                  ref={promptImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  className="hidden"
                  onChange={(e) => addPromptImageFiles(e.target.files)}
                />
                <div className="px-5 pt-4">
                  <input
                    id="design-prompt"
                    className="h-8 w-full border-0 bg-transparent p-0 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onPaste={handlePromptPaste}
                    onKeyDown={(e) => e.key === 'Enter' && !isGenerating && void handleGenerate()}
                    placeholder={imageSrc ? 'Describe a change to this design...' : 'Describe the design you want...'}
                  />
                </div>
                <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
                  <div className="flex items-center gap-1">
                    <Select value={imageQuality} onValueChange={(value) => setImageQuality(value as ImageQuality)}>
                      <SelectTrigger
                        className="h-9 w-auto gap-2 border-0 px-2 text-sm font-medium text-gray-600 shadow-none hover:bg-gray-100 hover:text-gray-900 focus:ring-0"
                        aria-label="Image quality"
                      >
                        <span>Quality</span>
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
                    <Button variant="ghost" size="sm" className="h-9 w-9 p-0 text-gray-500" asChild>
                      <Link href={`${basePath}/design/settings/`} aria-label="Design settings">
                        <SettingsIcon className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    {promptImages.length > 0 ? (
                      <div className="flex min-w-0 max-w-xs gap-2 overflow-x-auto">
                        {promptImages.map((file, i) =>
                          promptImagePreviewUrls[i] ? (
                            <div
                              key={`${file.name}-${file.lastModified}-${i}`}
                              className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={promptImagePreviewUrls[i]} alt="" className="h-full w-full object-cover" />
                              <button
                                type="button"
                                className="absolute inset-0 flex items-center justify-center bg-white/80 text-gray-700 opacity-0 transition hover:opacity-100"
                                onClick={() => {
                                  setPromptImages((current) => current.filter((_, idx) => idx !== i));
                                  if (promptImageInputRef.current) promptImageInputRef.current.value = '';
                                }}
                                aria-label={`Remove ${file.name}`}
                              >
                                <Trash2Icon className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : null
                        )}
                      </div>
                    ) : null}
                    <button
                      type="button"
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
                      onClick={() => promptImageInputRef.current?.click()}
                      aria-label="Attach image to this prompt"
                    >
                      <PaperclipIcon className="h-5 w-5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleGenerate()}
                      disabled={!prompt.trim() || !serverAiAvailable || !isLoggedIn || isGenerating}
                      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                      title={
                        !isLoggedIn
                          ? LOGIN_TO_USE_TOOL_MESSAGE
                          : !serverAiAvailable
                            ? 'Configure server AI in Integrations or .env'
                            : undefined
                      }
                      aria-label={imageSrc ? 'Refine design' : 'Generate design'}
                    >
                      {isGenerating ? <Loader2Icon className="h-5 w-5 animate-spin" /> : <ArrowUpIcon className="h-5 w-5" />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
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
                onChange={(e) => setSaveTitle(e.target.value)}
                placeholder="e.g. Hero - pricing page"
              />
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

export default NewDesignClient;
