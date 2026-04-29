'use client';

import { KeyIcon, Layers, Loader2Icon, RotateCcwIcon, XIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import type { GetStaticProps } from 'next';
import Image from 'next/image';
import { useRef, useState } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import ApiKeySettings from '../../components/Design/ApiKeySettings';
import { getApiKey, getImageModel } from '../../components/Design/llm-client';
import Layout from '../../components/Layout/Main';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip';
import { DocumentationProps, fetchDocPageMarkdown, getClientRuntimeConfig } from '../../components/util';

type GeneratedImage = {
  id: string;
  src: string;
  prompt: string;
};

const DESIGN_CLIENTS = ['ssc', '8x8'] as const;

type DesignClient = (typeof DESIGN_CLIENTS)[number];

const DESIGN_ASSETS = [
  { name: 'carousel.png' },
  { name: 'container.png' },
  { name: 'hero.png' },
];

const DESIGN_SYSTEM_IMAGE = { name: 'design-system.png' };

const getDesignAssetSrc = (client: DesignClient, name: string) => `/assets/design/${client}/${name}`;

const DESIGN_SYSTEM_PROMPT = `Create a design for a new section based on the reference image. Follow the typography and color palette of the reference image. Use spacing and padding of the reference image. Use text and color styles from the design system file. Use the user's prompt as the main direction. Treat the provided 1024x1024 image size as the full canvas. OpenAI will always return a 1024x1024 image, but the section itself should only use the vertical height it needs on that canvas, leaving unused space plain and unobtrusive instead of stretching the section to fill the whole square.`;

export const getStaticProps: GetStaticProps = async () => {
  const config = getClientRuntimeConfig();
  return {
    props: {
      config,
      ...fetchDocPageMarkdown('docs/', 'design', `/design`).props,
    } as DocumentationProps,
  };
};

const DesignPage = ({ menu, metadata, current, config }: DocumentationProps) => {
  const referenceImageInputRef = useRef<HTMLInputElement>(null);
  const layoutReferenceInputRef = useRef<HTMLInputElement>(null);
  const [selectedClient, setSelectedClient] = useState<DesignClient>('ssc');
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [layoutReferenceImages, setLayoutReferenceImages] = useState<File[]>([]);
  const [selectedAssetName, setSelectedAssetName] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleClientChange = (client: DesignClient) => {
    setSelectedClient(client);
    setReferenceImage(null);
    setSelectedAssetName(null);
    if (referenceImageInputRef.current) {
      referenceImageInputRef.current.value = '';
    }
  };

  const handleSelectAsset = async (asset: (typeof DESIGN_ASSETS)[number]) => {
    try {
      const response = await fetch(getDesignAssetSrc(selectedClient, asset.name));
      if (!response.ok) {
        throw new Error(`Could not load ${asset.name}. Add it to src/app/public/assets/design/${selectedClient} first.`);
      }

      const blob = await response.blob();
      setReferenceImage(new File([blob], asset.name, { type: blob.type || 'image/png' }));
      setSelectedAssetName(asset.name);
      if (referenceImageInputRef.current) {
        referenceImageInputRef.current.value = '';
      }
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to select asset.');
    }
  };

  const handleAddLayoutReferences = (files: FileList | null) => {
    if (!files?.length) return;

    setLayoutReferenceImages((current) => [...current, ...Array.from(files)]);
    if (layoutReferenceInputRef.current) {
      layoutReferenceInputRef.current.value = '';
    }
  };

  const handleClearReferenceImage = () => {
    setReferenceImage(null);
    setSelectedAssetName(null);
    if (referenceImageInputRef.current) {
      referenceImageInputRef.current.value = '';
    }
  };

  const loadDesignSystemImage = async () => {
    const response = await fetch(getDesignAssetSrc(selectedClient, DESIGN_SYSTEM_IMAGE.name));
    if (!response.ok) {
      throw new Error(`Could not load ${DESIGN_SYSTEM_IMAGE.name}. Add it to src/app/public/assets/design/${selectedClient} first.`);
    }

    const blob = await response.blob();
    return new File([blob], DESIGN_SYSTEM_IMAGE.name, { type: blob.type || 'image/png' });
  };

  const handleGenerate = async () => {
    if (!prompt.trim() || isGenerating) return;

    const apiKey = getApiKey();
    if (!apiKey) {
      setSettingsOpen(true);
      setError('Add your OpenAI API key before generating an image.');
      return;
    }

    setIsGenerating(true);
    setError(null);
    const submittedPrompt = prompt.trim();
    const layoutReferencePrompt = layoutReferenceImages.length
      ? `\n\nLayout reference: Use the ${layoutReferenceImages.length} uploaded layout reference image${layoutReferenceImages.length === 1 ? '' : 's'} to guide the section structure and composition.`
      : '';
    const apiPrompt = `${DESIGN_SYSTEM_PROMPT}${layoutReferencePrompt}\n\nUser request: ${submittedPrompt}`;

    try {
      const designSystemImage = await loadDesignSystemImage();
      const response = await fetch('https://api.openai.com/v1/images/edits', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: (() => {
          const formData = new FormData();
          formData.append('model', getImageModel());
          formData.append('prompt', apiPrompt);
          formData.append('size', '1024x1024');
          formData.append('image[]', designSystemImage, `system-prompt-${DESIGN_SYSTEM_IMAGE.name}`);
          if (referenceImage) {
            formData.append('image[]', referenceImage);
          }
          layoutReferenceImages.forEach((image, index) => {
            formData.append('image[]', image, `layout-reference-${index + 1}-${image.name}`);
          });
          return formData;
        })(),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`OpenAI image API error (${response.status}): ${body}`);
      }

      const json = await response.json();
      const image = json.data?.[0];
      const nextImageSrc = image?.b64_json ? `data:image/png;base64,${image.b64_json}` : image?.url;

      if (!nextImageSrc) {
        throw new Error('OpenAI did not return an image.');
      }

      setImageSrc(nextImageSrc);
      setGeneratedImages((current) => [
        {
          id: `${Date.now()}`,
          src: nextImageSrc,
          prompt: submittedPrompt,
        },
        ...current,
      ]);
    } catch (err: any) {
      setError(err.message || 'Failed to generate image.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Layout config={config} menu={menu} current={current} metadata={metadata} fullBleed>
      <TooltipProvider>
        <div className="flex h-full min-h-0 flex-col">
          <div className="relative flex h-12 shrink-0 items-center border-b bg-background px-2">
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => layoutReferenceInputRef.current?.click()}>
                    <Layers className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Layout reference</TooltipContent>
              </Tooltip>
              <Input
                ref={layoutReferenceInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={(event) => handleAddLayoutReferences(event.target.files)}
                className="hidden"
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Select value={selectedClient} onValueChange={(value) => handleClientChange(value as DesignClient)}>
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
            <aside className="flex w-40 shrink-0 flex-col border-r bg-background">
              <div className="border-b px-3 py-3">
                <h2 className="text-sm font-semibold">Assets</h2>
                <p className="text-xs text-muted-foreground">{DESIGN_ASSETS.length} temp files</p>
              </div>
              <div className="flex-1 space-y-2 overflow-visible p-3">
                {DESIGN_ASSETS.map((asset) => (
                  <button
                    key={asset.name}
                    type="button"
                    onClick={() => handleSelectAsset(asset)}
                    className="group relative block w-full rounded-md border bg-muted/20 p-1 text-left transition hover:border-primary data-[selected=true]:border-primary"
                    data-selected={selectedAssetName === asset.name}
                    title={asset.name}
                  >
                    <Image
                      src={getDesignAssetSrc(selectedClient, asset.name)}
                      alt={asset.name}
                      width={128}
                      height={128}
                      unoptimized
                      className="h-auto w-full rounded"
                    />
                    <div className="pointer-events-none absolute left-full top-0 z-50 ml-3 hidden w-96 rounded-lg border bg-background p-2 shadow-xl group-hover:block">
                      <Image
                        src={getDesignAssetSrc(selectedClient, asset.name)}
                        alt={asset.name}
                        width={512}
                        height={512}
                        unoptimized
                        className="h-auto w-full rounded"
                      />
                    </div>
                    <span className="mt-1 block truncate px-1 text-xs text-muted-foreground">{asset.name}</span>
                  </button>
                ))}
              </div>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-auto p-6">
              <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-lg border bg-muted/20">
                <TransformWrapper
                  initialScale={0.75}
                  minScale={0.25}
                  maxScale={4}
                  centerOnInit
                  limitToBounds={false}
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
                          className="flex h-[1024px] w-[1024px] items-center justify-center p-8"
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
                            <div className="rounded-md border border-dashed bg-background/80 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                              Generated design will appear here.
                            </div>
                          )}
                        </div>
                      </TransformComponent>
                    </>
                  )}
                </TransformWrapper>
              </div>

              <div className="space-y-3">
                {referenceImage ? <p className="text-xs text-muted-foreground">Reference: {selectedAssetName || referenceImage.name}</p> : null}

                {error ? <p className="text-sm text-destructive">{error}</p> : null}

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Input
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && handleGenerate()}
                    placeholder="Describe an image to generate..."
                  />
                  <div className="flex gap-3 sm:max-w-80">
                    <Input
                      ref={referenceImageInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={(event) => {
                        setReferenceImage(event.target.files?.[0] ?? null);
                        setSelectedAssetName(null);
                      }}
                      className="sm:max-w-64"
                    />
                    <Button variant="outline" onClick={handleClearReferenceImage} disabled={!referenceImage} aria-label="Clear reference image">
                      <XIcon className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button onClick={handleGenerate} disabled={!prompt.trim() || isGenerating}>
                    {isGenerating ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Generate
                  </Button>
                  <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                    <KeyIcon className="mr-2 h-4 w-4" />
                    API Key
                  </Button>
                </div>
              </div>
            </div>

            <aside className="flex w-40 shrink-0 flex-col border-l bg-background">
              <div className="border-b px-3 py-3">
                <h2 className="text-sm font-semibold">Images</h2>
                <p className="text-xs text-muted-foreground">{generatedImages.length} this session</p>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {generatedImages.length > 0 ? (
                  generatedImages.map((image) => (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => setImageSrc(image.src)}
                      className="block w-full rounded-md border bg-muted/20 p-1 text-left transition hover:border-primary"
                      title={image.prompt}
                    >
                      <Image
                        src={image.src}
                        alt={image.prompt || 'Generated design thumbnail'}
                        width={128}
                        height={128}
                        unoptimized
                        className="aspect-square w-full rounded object-cover"
                      />
                    </button>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">Generated thumbnails will appear here.</p>
                )}
              </div>
            </aside>
          </div>
        </div>

        <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
          <DialogContent className="w-full max-w-[min(42rem,calc(100vw-2rem))]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyIcon className="h-5 w-5" />
                OpenAI API Key
              </DialogTitle>
              <DialogDescription>Configure your OpenAI API key to get started.</DialogDescription>
            </DialogHeader>
            <ApiKeySettings onConfigured={() => setSettingsOpen(false)} />
          </DialogContent>
        </Dialog>

      </TooltipProvider>
    </Layout>
  );
}
