'use client';

import {
  ArrowUpIcon,
  DownloadIcon,
  Eye,
  ImageIcon,
  Loader2Icon,
  PaperclipIcon,
  RotateCcwIcon,
  SettingsIcon,
  SquareDashedMousePointer,
  Trash2Icon,
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
import { handoffApiUrl } from '../../lib/api-path';
import { Button } from '../../components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import type { DocumentationProps } from '../../components/util';
import { LOGIN_TO_USE_TOOL_MESSAGE } from '@/lib/login-required-messages';
import type {
  DesignConversationTurn,
  DesignWorkbenchComponentGuide,
  DesignWorkbenchComponentRow,
  DesignWorkbenchFoundationContext,
} from './workbench-types';
import {
  BRAND_VOICE_SETTINGS,
  COMPONENT_REFERENCE_SETTINGS,
  CUSTOM_FOUNDATION_IMAGE_FILENAME,
  CUSTOM_FOUNDATION_IMAGE_SETTING_KEY,
  DESIGN_MD_SETTING_KEY,
  INCLUDE_FOUNDATIONS_SETTING_KEY,
} from './settings/settings-constants';

type GeneratedImage = {
  id: string;
  src?: string;
  prompt: string;
  status: 'pending' | 'completed' | 'error';
  error?: string;
};

type AnnotationRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type DraftAnnotation = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
};

type DesignClientProps = DocumentationProps & {
  isLoggedIn: boolean;
  serverAiAvailable: boolean;
  components: DesignWorkbenchComponentRow[];
  foundations: DesignWorkbenchFoundationContext;
  loadArtifactId?: string;
};

const DESIGN_CLIENTS = ['ssc', '8x8'] as const;
type DesignLibraryClient = (typeof DESIGN_CLIENTS)[number];
const DESIGN_ASSETS = [{ name: 'carousel.png' }, { name: 'container.png' }, { name: 'hero.png' }];
const IMAGE_QUALITY_OPTIONS = ['auto', 'low', 'medium', 'high'] as const;
type ImageQuality = (typeof IMAGE_QUALITY_OPTIONS)[number];
const EMPTY_FOUNDATIONS: DesignWorkbenchFoundationContext = { colors: [], typography: [], effects: [], spacing: [] };
const PROMPT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const CANVAS_SIZE = 1024;
const MIN_ANNOTATION_SIZE = 8;

const getDesignAssetSrc = (client: DesignLibraryClient, name: string) => `/assets/design/${client}/${name}`;

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

function formatBrandVoiceGuidelines(values: Record<string, string>): string {
  const lines: string[] = [];
  for (const setting of BRAND_VOICE_SETTINGS) {
    const value = values[setting.id]?.trim();
    if (value) lines.push(`### ${setting.label}\n${value}`);
  }
  return lines.join('\n\n');
}

/** Full URL to the authenticated screenshot API for a preview HTML app path (includes basePath). */
function componentScreenshotApiUrl(previewHtmlAppPath: string): string {
  const endpoint = handoffApiUrl('/api/handoff/ai/component-screenshot');
  return `${endpoint}?url=${encodeURIComponent(previewHtmlAppPath)}`;
}

const DesignWorkbenchPage = ({
  menu,
  metadata,
  current,
  config,
  isLoggedIn,
  serverAiAvailable,
  components,
  foundations,
  loadArtifactId,
}: DesignClientProps) => {
  const router = useRouter();
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const promptImageInputRef = useRef<HTMLInputElement>(null);
  const componentsRef = useRef(components);
  componentsRef.current = components;

  const [selectedClient, setSelectedClient] = useState<DesignLibraryClient>('ssc');
  const [selectedAssetName, setSelectedAssetName] = useState<string | null>(null);
  const [selectedGeneratedImageId, setSelectedGeneratedImageId] = useState<string | null>(null);
  const [promptImages, setPromptImages] = useState<File[]>([]);
  const [promptImagePreviewUrls, setPromptImagePreviewUrls] = useState<string[]>([]);
  const [componentQuery, setComponentQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [imageQuality, setImageQuality] = useState<ImageQuality>('auto');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationRect[]>([]);
  const [draftAnnotation, setDraftAnnotation] = useState<DraftAnnotation | null>(null);
  const [conversationHistory, setConversationHistory] = useState<DesignConversationTurn[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [includeFoundations, setIncludeFoundations] = useState(true);
  const [customFoundationImageDataUrl, setCustomFoundationImageDataUrl] = useState('');
  const [componentReferenceDataUrls, setComponentReferenceDataUrls] = useState<Record<string, string>>({});
  const [designMd, setDesignMd] = useState('');
  const [brandVoice, setBrandVoice] = useState<Record<string, string>>({});
  const [effectiveFoundations, setEffectiveFoundations] = useState<DesignWorkbenchFoundationContext>(foundations);

  const selectedGeneratedImageIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedGeneratedImageIdRef.current = selectedGeneratedImageId;
  }, [selectedGeneratedImageId]);

  useEffect(() => {
    setEffectiveFoundations(foundations);
  }, [foundations]);

  useEffect(() => {
    const readSetting = () => {
      try {
        setIncludeFoundations(window.localStorage.getItem(INCLUDE_FOUNDATIONS_SETTING_KEY) !== 'false');
        setCustomFoundationImageDataUrl(window.localStorage.getItem(CUSTOM_FOUNDATION_IMAGE_SETTING_KEY) || '');
        setComponentReferenceDataUrls(
          Object.fromEntries(
            COMPONENT_REFERENCE_SETTINGS.map((setting) => [setting.id, window.localStorage.getItem(setting.storageKey) || ''])
          )
        );
        setDesignMd(window.localStorage.getItem(DESIGN_MD_SETTING_KEY) || '');
        setBrandVoice(
          Object.fromEntries(BRAND_VOICE_SETTINGS.map((setting) => [setting.id, window.localStorage.getItem(setting.storageKey) || '']))
        );
      } catch {
        setIncludeFoundations(true);
        setCustomFoundationImageDataUrl('');
        setComponentReferenceDataUrls({});
        setDesignMd('');
        setBrandVoice({});
      }
    };
    readSetting();
    window.addEventListener('storage', readSetting);
    window.addEventListener('focus', readSetting);
    return () => {
      window.removeEventListener('storage', readSetting);
      window.removeEventListener('focus', readSetting);
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
            componentGuides?: { id?: string }[];
            foundationContext?: unknown;
          };
          error?: string;
        };
        if (!res.ok) throw new Error(json.error || `Could not load design (${res.status})`);
        const a = json.artifact;
        if (!a?.imageUrl) throw new Error('Saved design has no image to continue from.');
        if (cancelled) return;
        setImageSrc(a.imageUrl);
        if (Array.isArray(a.conversationHistory)) setConversationHistory(a.conversationHistory);
        const guideIds = (Array.isArray(a.componentGuides) ? a.componentGuides : [])
          .map((g) => (g && typeof g.id === 'string' ? g.id : ''))
          .filter(Boolean);
        const known = new Set(componentsRef.current.map((c) => c.id));
        setSelectedIds(guideIds.filter((gid) => known.has(gid)));
        setEffectiveFoundations(safeFoundationContext(a.foundationContext));
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

  const promptedFoundations = includeFoundations ? effectiveFoundations : EMPTY_FOUNDATIONS;
  const customFoundationImage = !includeFoundations ? customFoundationImageDataUrl : '';
  const brandVoiceGuidelines = useMemo(() => formatBrandVoiceGuidelines(brandVoice), [brandVoice]);

  const hasFoundationsForRaster = useMemo(
    () =>
      promptedFoundations.colors.length > 0 ||
      promptedFoundations.typography.length > 0 ||
      (promptedFoundations.spacing?.length ?? 0) > 0 ||
      (promptedFoundations.effects?.length ?? 0) > 0,
    [promptedFoundations]
  );

  const filteredComponents = useMemo(() => {
    const q = componentQuery.trim().toLowerCase();
    if (!q) return components;
    return components.filter(
      (c) =>
        c.id.toLowerCase().includes(q) ||
        c.title.toLowerCase().includes(q) ||
        c.group.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
  }, [components, componentQuery]);

  const selectedGuides: DesignWorkbenchComponentGuide[] = useMemo(() => {
    const map = new Map(components.map((c) => [c.id, c]));
    return selectedIds
      .map((id) => map.get(id))
      .filter(Boolean)
      .map((c) => {
        const first = c!.previews?.[0];
        const htmlAppPath = first?.url ? handoffApiUrl(`/api/component/${first.url}`) : null;
        const previewUrl = htmlAppPath != null ? componentScreenshotApiUrl(htmlAppPath) : c!.image || null;
        return {
          id: c!.id,
          title: c!.title,
          group: c!.group,
          description: c!.description,
          previewUrl,
          previewKey: first?.key,
          propertiesSummary: c!.propertiesSummary,
        };
      });
  }, [components, selectedIds]);

  const toggleComponent = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const addPromptImageFiles = useCallback((files: ArrayLike<File> | Iterable<File> | null) => {
    if (!files) return;
    const next = Array.from(files).filter((f) => PROMPT_IMAGE_TYPES.includes(f.type));
    if (!next.length) return;
    setPromptImages((current) => [...current, ...next]);
    if (promptImageInputRef.current) promptImageInputRef.current.value = '';
  }, []);

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

  const handleSelectAsset = async (assetName: string) => {
    const assetSrc = getDesignAssetSrc(selectedClient, assetName);
    try {
      const response = await fetch(assetSrc);
      if (!response.ok) {
        throw new Error(`Could not load ${assetName}. Add it under public/assets/design/${selectedClient}/.`);
      }
      setImageSrc(assetSrc);
      setSelectedAssetName(assetName);
      selectedGeneratedImageIdRef.current = null;
      setSelectedGeneratedImageId(null);
      setAnnotations([]);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to select asset.');
    }
  };

  const handleDeleteGeneratedImage = (imageId: string) => {
    setGeneratedImages((current) => current.filter((image) => image.id !== imageId));
    if (selectedGeneratedImageId === imageId) {
      selectedGeneratedImageIdRef.current = null;
      setSelectedGeneratedImageId(null);
      setImageSrc(null);
      setAnnotations([]);
    }
  };

  const getCanvasPoint = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(Math.max(((event.clientX - rect.left) / rect.width) * CANVAS_SIZE, 0), CANVAS_SIZE),
      y: Math.min(Math.max(((event.clientY - rect.top) / rect.height) * CANVAS_SIZE, 0), CANVAS_SIZE),
    };
  };

  const getAnnotationRect = (annotation: DraftAnnotation): Omit<AnnotationRect, 'id'> => {
    const x = Math.min(annotation.startX, annotation.currentX);
    const y = Math.min(annotation.startY, annotation.currentY);
    return {
      x,
      y,
      width: Math.abs(annotation.currentX - annotation.startX),
      height: Math.abs(annotation.currentY - annotation.startY),
    };
  };

  const handleAnnotationStart = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isAnnotating || !imageSrc) return;
    event.preventDefault();
    const point = getCanvasPoint(event);
    setAnnotations([]);
    setDraftAnnotation({
      startX: point.x,
      startY: point.y,
      currentX: point.x,
      currentY: point.y,
    });
  };

  const handleAnnotationMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!draftAnnotation) return;
    const point = getCanvasPoint(event);
    setDraftAnnotation((current) => (current ? { ...current, currentX: point.x, currentY: point.y } : current));
  };

  const handleAnnotationEnd = () => {
    if (!draftAnnotation) return;
    const rect = getAnnotationRect(draftAnnotation);
    setDraftAnnotation(null);
    if (rect.width < MIN_ANNOTATION_SIZE || rect.height < MIN_ANNOTATION_SIZE) return;
    setIsAnnotating(false);
    setAnnotations((current) => [
      ...current,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        ...rect,
      },
    ]);
  };

  const loadImageForCanvas = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load image for export.'));
      image.src = src;
    });

  const createAnnotatedImageBlob = async (src: string, imageAnnotations: AnnotationRect[]) => {
    const sourceImage = await loadImageForCanvas(src);
    const imageWidth = sourceImage.naturalWidth || CANVAS_SIZE;
    const imageHeight = sourceImage.naturalHeight || CANVAS_SIZE;
    const displayedImageWidth = CANVAS_SIZE;
    const displayedImageHeight = (imageHeight / imageWidth) * displayedImageWidth;
    const displayedImageX = (CANVAS_SIZE - displayedImageWidth) / 2;
    const displayedImageY = (CANVAS_SIZE - displayedImageHeight) / 2;
    const scaleX = imageWidth / displayedImageWidth;
    const scaleY = imageHeight / displayedImageHeight;
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    const canvas = document.createElement('canvas');
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create canvas context.');

    context.drawImage(sourceImage, 0, 0, imageWidth, imageHeight);
    imageAnnotations.forEach((annotation) => {
      const x = clamp((annotation.x - displayedImageX) * scaleX, 0, imageWidth);
      const y = clamp((annotation.y - displayedImageY) * scaleY, 0, imageHeight);
      const width = clamp(annotation.width * scaleX, 0, imageWidth - x);
      const height = clamp(annotation.height * scaleY, 0, imageHeight - y);
      context.strokeStyle = 'rgb(239, 68, 68)';
      context.lineWidth = 2;
      context.strokeRect(x, y, width, height);
    });

    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error('Could not export annotated image.'));
      }, 'image/png');
    });
  };

  const downloadHref = (href: string, filename: string) => {
    const link = document.createElement('a');
    link.href = href;
    link.download = filename;
    link.click();
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    downloadHref(url, filename);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const handleDownloadImage = async (src = imageSrc) => {
    if (!src) return;
    try {
      const response = await fetch(src);
      if (!response.ok) throw new Error('Could not fetch image.');
      downloadBlob(await response.blob(), 'design-image.png');
    } catch {
      downloadHref(src, 'design-image.png');
    }
  };

  const handleDownloadAnnotatedImage = async () => {
    if (!imageSrc || annotations.length === 0) return;
    try {
      downloadBlob(await createAnnotatedImageBlob(imageSrc, annotations), 'design-image-annotated.png');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not export annotated image.');
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
    if (!refining && !hasPromptImage && !hasFoundationsForRaster && !hasCustomFoundationImage && !hasSavedComponentReferences) {
      setError(
        'Select an image on the canvas, attach a prompt image, save component references in settings, use foundations, or add a custom foundation image in settings.'
      );
      return;
    }

    setError(null);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const submittedPrompt = prompt.trim();
    const submittedPromptImages = promptImages;

    selectedGeneratedImageIdRef.current = requestId;
    setSelectedGeneratedImageId(requestId);
    setSelectedAssetName(null);
    setImageSrc(null);
    setAnnotations([]);
    setGeneratedImages((current) => [{ id: requestId, prompt: submittedPrompt, status: 'pending' }, ...current]);
    setPrompt('');
    setPromptImages([]);
    if (promptImageInputRef.current) promptImageInputRef.current.value = '';

    try {
      const formData = new FormData();
      const attachedImageLabels: string[] = [];
      formData.append('prompt', submittedPrompt);
      formData.append('foundationContext', JSON.stringify(promptedFoundations));
      formData.append('componentGuides', JSON.stringify(selectedGuides.map((guide) => ({ ...guide, previewUrl: null }))));
      formData.append('conversationHistory', JSON.stringify(conversationHistory));
      formData.append('designGuidelines', designMd);
      formData.append('brandVoiceGuidelines', brandVoiceGuidelines);
      formData.append('quality', imageQuality);
      formData.append('promptImageCount', String(submittedPromptImages.length));

      if (refining && imageSrc) {
        let canvasFile: File;
        if (annotations.length > 0) {
          const blob = await createAnnotatedImageBlob(imageSrc, annotations);
          canvasFile = new File([blob], 'annotated-current-canvas.png', { type: 'image/png' });
        } else {
          canvasFile = await dataUrlToFile(imageSrc, 'current-canvas.png');
        }
        formData.append('image[]', canvasFile);
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
      submittedPromptImages.forEach((file, index) => {
        formData.append('image[]', file);
        attachedImageLabels.push(`User-attached prompt image ${index + 1}${file.name ? ` (${file.name})` : ''}: request-specific visual reference.`);
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
        setAnnotations([]);
      }
      setGeneratedImages((current) =>
        current.map((image) => (image.id === requestId ? { ...image, src: json.image, status: 'completed' } : image))
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to generate.';
      setError(message);
      setGeneratedImages((current) =>
        current.map((image) => (image.id === requestId ? { ...image, status: 'error', error: message } : image))
      );
    }
  };

  const handleSaveArtifact = async () => {
    if (!saveTitle.trim() || !imageSrc) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/ai/design-artifact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: saveTitle.trim(),
          description: saveDescription.trim(),
          status: 'review',
          imageUrl: imageSrc,
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
      setSaveDescription('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata} fullBleed>
      <>
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex h-12 shrink-0 items-center border-b bg-muted/30 px-2">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className={`h-8 w-8 p-0 ${isAnnotating ? 'bg-foreground text-background hover:bg-foreground hover:text-background' : ''}`}
                onClick={() => setIsAnnotating((current) => !current)}
                disabled={!imageSrc}
              >
                <SquareDashedMousePointer className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setAnnotations([])}
                disabled={annotations.length === 0}
              >
                <XIcon className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => void handleDownloadImage()} disabled={!imageSrc}>
                <DownloadIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => void handleDownloadAnnotatedImage()}
                disabled={!imageSrc || annotations.length === 0}
              >
                <Eye className="h-4 w-4" />
              </Button>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Select
                value={selectedClient}
                onValueChange={(value) => {
                  setSelectedClient(value as DesignLibraryClient);
                  setSelectedAssetName(null);
                }}
              >
                <SelectTrigger className="h-8 w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  {DESIGN_CLIENTS.map((client) => (
                    <SelectItem key={client} value={client}>
                      {client}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild>
                <Link href={`${basePath}/design/settings/`} aria-label="Design settings">
                  <SettingsIcon className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="flex min-h-0 flex-1">
            <aside className="flex w-[min(22rem,100%)] shrink-0 flex-col overflow-hidden border-r bg-background">
              <div className="flex-1 space-y-2 overflow-y-auto p-2">
                <Collapsible defaultOpen className="rounded-md border px-2 py-1">
                  <CollapsibleTrigger className="flex w-full items-center justify-between py-2 text-left text-sm font-medium">
                    <span>Reference library</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 pb-2">
                    <div className="grid grid-cols-3 gap-2">
                      {DESIGN_ASSETS.map((asset) => (
                        <button
                          key={asset.name}
                          type="button"
                          onClick={() => void handleSelectAsset(asset.name)}
                          data-selected={selectedAssetName === asset.name}
                          className="group relative rounded-md border bg-muted/20 p-1 data-[selected=true]:border-primary"
                          title={asset.name}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getDesignAssetSrc(selectedClient, asset.name)}
                            alt={asset.name}
                            className="aspect-square w-full rounded object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                <Collapsible defaultOpen className="rounded-md border px-2 py-1">
                  <CollapsibleTrigger className="flex w-full items-center justify-between py-2 text-left text-sm font-medium">
                    <span>Component guides</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-2 pb-2">
                    <Input
                      placeholder="Search components…"
                      value={componentQuery}
                      onChange={(e) => setComponentQuery(e.target.value)}
                      className="h-8 text-sm"
                    />
                    <div className="max-h-72 space-y-1.5 overflow-y-auto pb-1">
                      {filteredComponents.slice(0, 80).map((c) => {
                        const selected = selectedIds.includes(c.id);
                        const thumbUrl =
                          c.previews?.[0]?.url != null
                            ? componentScreenshotApiUrl(handoffApiUrl(`/api/component/${c.previews[0].url}`))
                            : c.image;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => toggleComponent(c.id)}
                            className={`flex w-full items-center gap-2.5 rounded-md border-2 bg-muted/20 p-1.5 text-left transition ${
                              selected ? 'border-primary ring-1 ring-primary/30' : 'border-transparent hover:border-muted-foreground/30'
                            }`}
                            title={`${c.title}${c.group ? ` — ${c.group}` : ''}`}
                          >
                            <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded bg-muted/40">
                              {thumbUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={thumbUrl} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full items-center justify-center text-muted-foreground/40">
                                  <ImageIcon className="h-4 w-4" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium">{c.title}</span>
                              {c.group ? <span className="block truncate text-[10px] text-muted-foreground">{c.group}</span> : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
              {!serverAiAvailable ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  Design workbench needs server AI: <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_AI_API_KEY</code>{' '}
                  or <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_CLOUD_URL</code> +{' '}
                  <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_CLOUD_TOKEN</code>.
                </p>
              ) : null}

              {conversationHistory.length > 0 ? (
                <div className="hidden max-h-24 flex-wrap gap-2 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs">
                  {conversationHistory.map((turn, idx) => (
                    <span key={idx} className="rounded bg-background px-2 py-1 shadow-sm">
                      <strong>{turn.role}:</strong> {turn.prompt.slice(0, 80)}
                      {turn.prompt.length > 80 ? '…' : ''}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/20">
                <TransformWrapper
                  initialScale={0.75}
                  minScale={0.25}
                  maxScale={4}
                  centerOnInit
                  limitToBounds={false}
                  panning={{ disabled: isAnnotating }}
                  wheel={{ step: 0.08 }}
                  doubleClick={{ mode: 'reset' }}
                >
                  {({ zoomIn, zoomOut, resetTransform }) => (
                    <>
                      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
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

                      <TransformComponent wrapperClass="!h-full !w-full" contentClass="!h-fit !w-fit">
                        <div
                          className={`relative flex h-[1024px] w-[1024px] items-center justify-center p-8 ${isAnnotating ? 'cursor-crosshair' : ''}`}
                          onMouseDown={handleAnnotationStart}
                          onMouseMove={handleAnnotationMove}
                          onMouseUp={handleAnnotationEnd}
                          onMouseLeave={handleAnnotationEnd}
                          style={{
                            backgroundImage: 'radial-gradient(hsl(var(--border)) 1px, transparent 1px)',
                            backgroundSize: '18px 18px',
                          }}
                        >
                          {imageSrc ? (
                            <Image
                              src={imageSrc}
                              alt={prompt || 'Generated design'}
                              width={1024}
                              height={1024}
                              unoptimized
                              className="h-auto w-[1024px] max-w-none rounded-md bg-background object-contain shadow-lg"
                            />
                          ) : (
                            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed bg-background/80 px-6 py-8 text-sm text-muted-foreground shadow-sm">
                              <ImageIcon className="h-10 w-10 opacity-40" />
                              <p>Add images, select components, or rely on foundations — then write a prompt and generate.</p>
                            </div>
                          )}
                          {annotations.map((annotation) => (
                            <div
                              key={annotation.id}
                              className="pointer-events-none absolute border-2 border-dashed border-red-500 bg-red-500/10"
                              style={{ left: annotation.x, top: annotation.y, width: annotation.width, height: annotation.height }}
                            />
                          ))}
                          {draftAnnotation ? (
                            <div
                              className="pointer-events-none absolute border-2 border-dashed border-red-500 bg-red-500/10"
                              style={{
                                left: getAnnotationRect(draftAnnotation).x,
                                top: getAnnotationRect(draftAnnotation).y,
                                width: getAnnotationRect(draftAnnotation).width,
                                height: getAnnotationRect(draftAnnotation).height,
                              }}
                            />
                          ) : null}
                        </div>
                      </TransformComponent>
                    </>
                  )}
                </TransformWrapper>
              </div>

              {error ? <p className="text-sm text-destructive">{error}</p> : null}

              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
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
                    onKeyDown={(e) => e.key === 'Enter' && void handleGenerate()}
                    placeholder="Reply..."
                  />
                </div>
                <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-4">
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
                      disabled={!prompt.trim() || !serverAiAvailable || !isLoggedIn}
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
                      <ArrowUpIcon className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <aside className="flex w-44 shrink-0 flex-col border-l bg-background">
              <div className="border-b px-3 py-3">
                <h2 className="text-sm font-semibold">Session</h2>
                <p className="text-xs text-muted-foreground">{generatedImages.length} versions</p>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                {generatedImages.length > 0 ? (
                  generatedImages.map((img) => (
                    <div key={img.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => {
                          selectedGeneratedImageIdRef.current = img.id;
                          setSelectedGeneratedImageId(img.id);
                          setSelectedAssetName(null);
                          if (img.src) {
                            setImageSrc(img.src);
                          } else {
                            setImageSrc(null);
                          }
                          setAnnotations([]);
                        }}
                        className="block w-full rounded-md border bg-muted/20 p-1 text-left text-xs transition hover:border-primary data-[selected=true]:border-primary"
                        title={img.error || img.prompt}
                        data-selected={selectedGeneratedImageId === img.id}
                      >
                        {img.status === 'completed' && img.src ? (
                          <Image
                            src={img.src}
                            alt={img.prompt}
                            width={128}
                            height={128}
                            unoptimized
                            className="aspect-square w-full rounded object-cover"
                          />
                        ) : (
                          <div
                            className={`aspect-square w-full rounded ${img.status === 'error' ? 'bg-destructive/10' : 'animate-pulse bg-muted'}`}
                          />
                        )}
                      </button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute right-1.5 top-1.5 h-6 w-6 p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                        onClick={() => handleDeleteGeneratedImage(img.id)}
                        aria-label="Delete generated image"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </Button>
                      {img.src ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          className="absolute bottom-1.5 right-1.5 h-6 w-6 p-0 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                          onClick={() => void handleDownloadImage(img.src)}
                          aria-label="Save generated image"
                        >
                          <DownloadIcon className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">Versions appear here.</p>
                )}
                {generatedImages.length > 0 ? (
                  <div className="mt-auto flex w-full shrink-0 flex-col gap-1.5">
                    <Button variant="secondary" size="sm" className="w-full" onClick={() => setSaveOpen(true)}>
                      Save for review
                    </Button>
                    <Button variant="ghost" size="sm" className="h-auto w-full py-1 text-[11px] text-muted-foreground" asChild>
                      <Link href={`${basePath}/design/library/`}>View saved designs</Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            </aside>
          </div>
        </div>

        <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Save design for review</DialogTitle>
              <DialogDescription>Describe the design and required assets. This is stored for your team to review.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {imageSrc ? (
                <div className="relative mx-auto h-40 w-40 overflow-hidden rounded border">
                  <Image src={imageSrc} alt="Preview" fill className="object-contain" unoptimized />
                </div>
              ) : null}
              <div className="space-y-1">
                <Label htmlFor="artifact-title">Title</Label>
                <Input
                  id="artifact-title"
                  value={saveTitle}
                  onChange={(e) => setSaveTitle(e.target.value)}
                  placeholder="e.g. Hero — pricing page"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="artifact-desc">Description and assets</Label>
                <Textarea
                  id="artifact-desc"
                  value={saveDescription}
                  onChange={(e) => setSaveDescription(e.target.value)}
                  rows={5}
                  placeholder="What this design is for, copy notes, and image assets needed to build the component…"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Saves with status <strong>review</strong>. {selectedGuides.length} component guide(s), {conversationHistory.length}{' '}
                conversation step(s).
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSaveOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleSaveArtifact()} disabled={!saveTitle.trim() || isSaving}>
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
