'use client';

import {
  DownloadIcon,
  Eye,
  ImageIcon,
  LayoutTemplate,
  Loader2Icon,
  PaperclipIcon,
  RotateCcwIcon,
  SquareDashedMousePointer,
  Trash2Icon,
  Upload,
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

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || 'image/png' });
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
  const benchInputRef = useRef<HTMLInputElement>(null);
  const layoutReferenceInputRef = useRef<HTMLInputElement>(null);
  const promptImageInputRef = useRef<HTMLInputElement>(null);
  const componentsRef = useRef(components);
  componentsRef.current = components;

  const [selectedClient, setSelectedClient] = useState<DesignLibraryClient>('ssc');
  const [selectedAssetName, setSelectedAssetName] = useState<string | null>(null);
  const [selectedGeneratedImageId, setSelectedGeneratedImageId] = useState<string | null>(null);
  const [benchFiles, setBenchFiles] = useState<File[]>([]);
  const [layoutReferenceImages, setLayoutReferenceImages] = useState<File[]>([]);
  const [promptImage, setPromptImage] = useState<File | null>(null);
  const [promptImagePreviewUrl, setPromptImagePreviewUrl] = useState<string | null>(null);
  const [componentQuery, setComponentQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [annotations, setAnnotations] = useState<AnnotationRect[]>([]);
  const [draftAnnotation, setDraftAnnotation] = useState<DraftAnnotation | null>(null);
  const [conversationHistory, setConversationHistory] = useState<DesignConversationTurn[]>([]);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [benchPreviewUrls, setBenchPreviewUrls] = useState<string[]>([]);
  const [foundationPreviewOpen, setFoundationPreviewOpen] = useState(false);
  const [foundationPreviewUrl, setFoundationPreviewUrl] = useState<string | null>(null);
  const [foundationPreviewLoading, setFoundationPreviewLoading] = useState(false);
  const [foundationPreviewError, setFoundationPreviewError] = useState<string | null>(null);
  const [effectiveFoundations, setEffectiveFoundations] = useState<DesignWorkbenchFoundationContext>(foundations);

  useEffect(() => {
    setEffectiveFoundations(foundations);
  }, [foundations]);

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
    const urls = benchFiles.map((f) => URL.createObjectURL(f));
    setBenchPreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [benchFiles]);

  useEffect(() => {
    if (!promptImage) {
      setPromptImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(promptImage);
    setPromptImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [promptImage]);

  useEffect(() => {
    return () => {
      if (foundationPreviewUrl) URL.revokeObjectURL(foundationPreviewUrl);
    };
  }, [foundationPreviewUrl]);

  const hasFoundationsForRaster = useMemo(
    () =>
      effectiveFoundations.colors.length > 0 ||
      effectiveFoundations.typography.length > 0 ||
      (effectiveFoundations.spacing?.length ?? 0) > 0 ||
      (effectiveFoundations.effects?.length ?? 0) > 0,
    [effectiveFoundations]
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

  const addBenchFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const next = Array.from(files).filter((f) => ['image/png', 'image/jpeg', 'image/webp'].includes(f.type));
    if (!next.length) return;
    setBenchFiles((cur) => [...cur, ...next]);
    if (benchInputRef.current) benchInputRef.current.value = '';
  }, []);

  const addLayoutReferenceFiles = useCallback((files: FileList | null) => {
    if (!files?.length) return;
    const next = Array.from(files).filter((f) => ['image/png', 'image/jpeg', 'image/webp'].includes(f.type));
    if (!next.length) return;
    setLayoutReferenceImages((cur) => [...cur, ...next]);
    if (layoutReferenceInputRef.current) layoutReferenceInputRef.current.value = '';
  }, []);

  const removeBenchFile = (index: number) => {
    setBenchFiles((cur) => cur.filter((_, i) => i !== index));
  };

  const removeLayoutReference = (index: number) => {
    setLayoutReferenceImages((cur) => cur.filter((_, i) => i !== index));
  };

  const handleSelectAsset = async (assetName: string) => {
    const assetSrc = getDesignAssetSrc(selectedClient, assetName);
    try {
      const response = await fetch(assetSrc);
      if (!response.ok) {
        throw new Error(`Could not load ${assetName}. Add it under public/assets/design/${selectedClient}/.`);
      }
      setImageSrc(assetSrc);
      setSelectedAssetName(assetName);
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

  const openFoundationRasterPreview = async () => {
    if (!hasFoundationsForRaster) return;
    setFoundationPreviewLoading(true);
    setFoundationPreviewError(null);
    try {
      const res = await fetch(handoffApiUrl('/api/handoff/ai/foundation-preview'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ foundationContext: effectiveFoundations }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || `Preview failed (${res.status})`);
      }
      const blob = await res.blob();
      setFoundationPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setFoundationPreviewOpen(true);
    } catch (e: unknown) {
      setFoundationPreviewError(e instanceof Error ? e.message : 'Could not load preview.');
    } finally {
      setFoundationPreviewLoading(false);
    }
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;
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
    const hasComponentImages = selectedGuides.some((g) => g.previewUrl);
    const hasPromptImage = Boolean(promptImage);
    if (!refining && benchFiles.length === 0 && !hasComponentImages && !hasPromptImage && !hasFoundationsForRaster) {
      setError(
        'Add at least one image, attach a prompt image, select a component with a preview, use foundations loaded in the sidebar, or generate again from the current canvas after a first result.'
      );
      return;
    }

    setIsGenerating(true);
    setError(null);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const submittedPrompt = prompt.trim();

    setSelectedGeneratedImageId(requestId);
    setSelectedAssetName(null);
    setGeneratedImages((current) => [{ id: requestId, prompt: submittedPrompt, status: 'pending' }, ...current]);

    try {
      const formData = new FormData();
      formData.append('prompt', submittedPrompt);
      formData.append('foundationContext', JSON.stringify(effectiveFoundations));
      formData.append('componentGuides', JSON.stringify(selectedGuides));
      formData.append('conversationHistory', JSON.stringify(conversationHistory));

      if (refining && imageSrc) {
        let baseFile: File;
        if (annotations.length > 0) {
          const blob = await createAnnotatedImageBlob(imageSrc, annotations);
          baseFile = new File([blob], 'annotated-current-canvas.png', { type: 'image/png' });
        } else {
          baseFile = await dataUrlToFile(imageSrc, 'current-canvas.png');
        }
        formData.append('iterationBase', baseFile);
      }

      for (const file of benchFiles) formData.append('image[]', file);
      for (const file of layoutReferenceImages) formData.append('image[]', file);
      if (promptImage) formData.append('image[]', promptImage);

      const guideImageUrls = selectedGuides
        .filter((g) => g.previewUrl)
        .map((g) => ({ id: g.id, url: g.previewUrl! }));
      for (const { id, url } of guideImageUrls) {
        try {
          const res = await fetch(url, { credentials: 'include' });
          if (res.ok) {
            const blob = await res.blob();
            const ext = blob.type === 'image/jpeg' ? '.jpg' : blob.type === 'image/webp' ? '.webp' : '.png';
            formData.append('image[]', blob, `component-${id}${ext}`);
          }
        } catch {
          // skip unreachable component images
        }
      }

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

      setImageSrc(json.image);
      setAnnotations([]);
      setGeneratedImages((current) =>
        current.map((image) => (image.id === requestId ? { ...image, src: json.image, status: 'completed' } : image))
      );
      setPrompt('');
      setPromptImage(null);
      if (promptImageInputRef.current) promptImageInputRef.current.value = '';
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to generate.';
      setError(message);
      setGeneratedImages((current) =>
        current.map((image) => (image.id === requestId ? { ...image, status: 'error', error: message } : image))
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSaveArtifact = async () => {
    if (!saveTitle.trim() || !imageSrc) return;
    setIsSaving(true);
    setError(null);
    try {
      const sourceImages = await Promise.all(
        benchFiles.map(async (f) => ({
          name: f.name,
          dataUrl: await fileToDataUrl(f),
        }))
      );
      const res = await fetch(handoffApiUrl('/api/handoff/ai/design-artifact'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: saveTitle.trim(),
          description: saveDescription.trim(),
          status: 'review',
          imageUrl: imageSrc,
          sourceImages,
          componentGuides: selectedGuides,
          foundationContext: effectiveFoundations,
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
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-12 shrink-0 items-center border-b bg-muted/30 px-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => layoutReferenceInputRef.current?.click()}>
              <LayoutTemplate className="h-4 w-4" />
            </Button>
            <Input
              ref={layoutReferenceInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={(event) => addLayoutReferenceFiles(event.target.files)}
              className="hidden"
            />
            <Button
              variant="ghost"
              size="sm"
              className={`h-8 w-8 p-0 ${isAnnotating ? 'bg-foreground text-background hover:bg-foreground hover:text-background' : ''}`}
              onClick={() => setIsAnnotating((current) => !current)}
              disabled={!imageSrc}
            >
              <SquareDashedMousePointer className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setAnnotations([])} disabled={annotations.length === 0}>
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
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="flex w-[min(22rem,100%)] shrink-0 flex-col overflow-hidden border-r bg-background">
            <div className="border-b px-3 py-2">
              <h2 className="text-sm font-semibold">Workbench</h2>
              <p className="text-xs text-muted-foreground">Images, guides, and foundations are sent with each prompt.</p>
            </div>
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
                        <img src={getDesignAssetSrc(selectedClient, asset.name)} alt={asset.name} className="aspect-square w-full rounded object-cover" />
                      </button>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible defaultOpen className="rounded-md border px-2 py-1">
                <CollapsibleTrigger className="flex w-full items-center justify-between py-2 text-left text-sm font-medium">
                  <span className="flex items-center gap-2">
                    <Upload className="h-4 w-4" /> Images
                  </span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pb-2">
                  <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => benchInputRef.current?.click()}>
                    Add images
                  </Button>
                  <Input
                    ref={benchInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => addBenchFiles(e.target.files)}
                  />
                  <div className="flex flex-wrap gap-2">
                    {benchFiles.map((file, i) => (
                      <div key={`${file.name}-${i}-${file.lastModified}`} className="relative h-16 w-16 overflow-hidden rounded border">
                        {benchPreviewUrls[i] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={benchPreviewUrls[i]} alt={file.name} className="h-full w-full object-cover" />
                        ) : null}
                        <button
                          type="button"
                          className="absolute right-0 top-0 rounded-bl bg-background/90 p-0.5"
                          onClick={() => removeBenchFile(i)}
                          aria-label="Remove"
                        >
                          <Trash2Icon className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  {layoutReferenceImages.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Layout references</p>
                      {layoutReferenceImages.map((file, i) => (
                        <div key={`${file.name}-${i}`} className="flex items-center justify-between text-xs">
                          <span className="truncate">{file.name}</span>
                          <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => removeLayoutReference(i)}>
                            <XIcon className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
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

              <Collapsible className="rounded-md border px-2 py-1">
                <CollapsibleTrigger className="flex w-full items-center justify-between py-2 text-left text-sm font-medium">
                  <span>Foundations (read-only)</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pb-2 text-xs">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 rounded bg-muted/50 px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
                      A visual reference image of these tokens is automatically generated on the server and sent with each request.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-auto shrink-0 gap-1 px-2 py-1 text-[11px]"
                      disabled={!hasFoundationsForRaster || foundationPreviewLoading}
                      onClick={() => void openFoundationRasterPreview()}
                      title="Open the same raster image sent to the model"
                    >
                      {foundationPreviewLoading ? <Loader2Icon className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <Eye className="h-3.5 w-3.5 shrink-0" />}
                      Preview
                    </Button>
                  </div>
                  {foundationPreviewError ? <p className="text-[11px] text-destructive">{foundationPreviewError}</p> : null}
                  <div className="flex flex-wrap gap-1">
                    {effectiveFoundations.colors.slice(0, 16).map((c, i) => (
                      <span key={`${c.name}-${i}`} className="inline-flex items-center gap-1 rounded border px-1 py-0.5" title={`${c.name}: ${c.value}`}>
                        <span className="h-3 w-3 rounded-sm border" style={{ background: c.value }} />
                        <span className="max-w-[5rem] truncate">{c.name}</span>
                      </span>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-auto p-4">
            {!serverAiAvailable ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
                Design workbench needs server AI: <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_AI_API_KEY</code> or{' '}
                <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_CLOUD_URL</code> +{' '}
                <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">HANDOFF_CLOUD_TOKEN</code>.
              </p>
            ) : null}

            {conversationHistory.length > 0 ? (
              <div className="flex max-h-24 flex-wrap gap-2 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs">
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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <Label htmlFor="design-prompt">{imageSrc ? 'Refine' : 'Prompt'}</Label>
                <div className="flex items-center gap-2">
                  <input
                    ref={promptImageInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && ['image/png', 'image/jpeg', 'image/webp'].includes(f.type)) setPromptImage(f);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => promptImageInputRef.current?.click()}
                    aria-label="Attach image to this prompt"
                  >
                    <PaperclipIcon className="h-4 w-4" />
                  </Button>
                  {promptImage && promptImagePreviewUrl ? (
                    <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={promptImagePreviewUrl} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        className="absolute inset-0 flex items-center justify-center bg-background/80 opacity-0 transition hover:opacity-100"
                        onClick={() => {
                          setPromptImage(null);
                          if (promptImageInputRef.current) promptImageInputRef.current.value = '';
                        }}
                        aria-label="Remove prompt image"
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                  <Input
                    id="design-prompt"
                    className="min-w-0 flex-1"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleGenerate()}
                    placeholder={imageSrc ? 'Describe changes to the selected area/current design…' : 'Describe the section to design…'}
                  />
                </div>
              </div>
              <Button
                onClick={() => void handleGenerate()}
                disabled={!prompt.trim() || isGenerating || !serverAiAvailable || !isLoggedIn}
                title={
                  !isLoggedIn
                    ? LOGIN_TO_USE_TOOL_MESSAGE
                    : !serverAiAvailable
                      ? 'Configure server AI in Integrations or .env'
                      : undefined
                }
              >
                {isGenerating ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : null}
                {imageSrc ? 'Refine' : 'Generate'}
              </Button>
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
                        if (img.src) {
                          setSelectedGeneratedImageId(img.id);
                          setSelectedAssetName(null);
                          setImageSrc(img.src);
                          setAnnotations([]);
                        }
                      }}
                      className="block w-full rounded-md border bg-muted/20 p-1 text-left text-xs transition hover:border-primary data-[selected=true]:border-primary disabled:cursor-default"
                      title={img.error || img.prompt}
                      disabled={!img.src}
                      data-selected={selectedGeneratedImageId === img.id}
                    >
                      {img.status === 'completed' && img.src ? (
                        <Image src={img.src} alt={img.prompt} width={128} height={128} unoptimized className="aspect-square w-full rounded object-cover" />
                      ) : (
                        <div className={`aspect-square w-full rounded ${img.status === 'error' ? 'bg-destructive/10' : 'animate-pulse bg-muted'}`} />
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

      <Dialog
        open={foundationPreviewOpen}
        onOpenChange={(open) => {
          setFoundationPreviewOpen(open);
          if (!open) setFoundationPreviewUrl(null);
        }}
      >
        <DialogContent className="max-h-[90vh] w-[min(56rem,calc(100vw-2rem))] max-w-[min(56rem,calc(100vw-2rem))] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Foundation reference image</DialogTitle>
            <DialogDescription>Same raster PNG prepended to generation requests.</DialogDescription>
          </DialogHeader>
          <div className="max-h-[calc(90vh-10rem)] overflow-auto rounded-md border bg-muted/30 p-2">
            {foundationPreviewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foundationPreviewUrl} alt="Foundation raster preview" className="mx-auto h-auto w-full max-w-full" />
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setFoundationPreviewOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <Input id="artifact-title" value={saveTitle} onChange={(e) => setSaveTitle(e.target.value)} placeholder="e.g. Hero — pricing page" />
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
              Saves with status <strong>review</strong>. {selectedGuides.length} component guide(s), {benchFiles.length} source image(s),{' '}
              {conversationHistory.length} conversation step(s).
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
    </Layout>
  );
};

export default DesignWorkbenchPage;
