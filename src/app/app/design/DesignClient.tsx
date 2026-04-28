'use client';

import { KeyIcon, Loader2Icon } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import ApiKeySettings from '../../components/Design/ApiKeySettings';
import { getApiKey, getImageModel } from '../../components/Design/llm-client';
import Layout from '../../components/Layout/Main';
import { Button } from '../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Input } from '../../components/ui/input';
import { TooltipProvider } from '../../components/ui/tooltip';

type GeneratedImage = {
  id: string;
  src: string;
  prompt: string;
};

const DESIGN_ASSETS = [
  { name: 'carousel.png', src: '/assets/design/carousel.png' },
  { name: 'container.png', src: '/assets/design/container.png' },
  { name: 'hero.png', src: '/assets/design/hero.png' },
];

const DESIGN_SYSTEM_PROMPT = `Create a design for a new section based on the reference image. Follow the typography and color palette of the reference image. Use spacing and padding of the reference image. Use the user's prompt as the main direction. Treat the provided 1024x1024 image size as the full canvas. OpenAI will always return a 1024x1024 image, but the section itself should only use the vertical height it needs on that canvas, leaving unused space plain and unobtrusive instead of stretching the section to fill the whole square.`;

export default function DesignClient({ menu, metadata, current, config }: any) {
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [prompt, setPrompt] = useState('');
  const [referenceImage, setReferenceImage] = useState<File | null>(null);
  const [selectedAssetName, setSelectedAssetName] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleSelectAsset = async (asset: (typeof DESIGN_ASSETS)[number]) => {
    try {
      const response = await fetch(asset.src);
      if (!response.ok) {
        throw new Error(`Could not load ${asset.name}. Add it to src/app/public/assets/design first.`);
      }

      const blob = await response.blob();
      setReferenceImage(new File([blob], asset.name, { type: blob.type || 'image/png' }));
      setSelectedAssetName(asset.name);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to select asset.');
    }
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
    const apiPrompt = `${DESIGN_SYSTEM_PROMPT}\n\nUser request: ${submittedPrompt}`;

    try {
      const response = referenceImage
        ? await fetch('https://api.openai.com/v1/images/edits', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
            },
            body: (() => {
              const formData = new FormData();
              formData.append('model', getImageModel());
              formData.append('prompt', apiPrompt);
              formData.append('size', '1024x1024');
              formData.append('image[]', referenceImage);
              return formData;
            })(),
          })
        : await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: getImageModel(),
              prompt: apiPrompt,
              size: '1024x1024',
            }),
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
        <div className="flex h-full min-h-0">
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
                    src={asset.src}
                    alt={asset.name}
                    width={128}
                    height={128}
                    unoptimized
                    className="h-auto w-full rounded"
                  />
                  <div className="pointer-events-none absolute left-full top-0 z-50 ml-3 hidden w-96 rounded-lg border bg-background p-2 shadow-xl group-hover:block">
                    <Image
                      src={asset.src}
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

          <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-auto p-6">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleGenerate()}
                placeholder="Describe an image to generate..."
              />
              <Input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(event) => {
                  setReferenceImage(event.target.files?.[0] ?? null);
                  setSelectedAssetName(null);
                }}
                className="sm:max-w-64"
              />
              <Button onClick={handleGenerate} disabled={!prompt.trim() || isGenerating}>
                {isGenerating ? <Loader2Icon className="mr-2 h-4 w-4 animate-spin" /> : null}
                Generate
              </Button>
              <Button variant="outline" onClick={() => setSettingsOpen(true)}>
                <KeyIcon className="mr-2 h-4 w-4" />
                API Key
              </Button>
            </div>

            {referenceImage ? <p className="text-xs text-muted-foreground">Reference: {selectedAssetName || referenceImage.name}</p> : null}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed bg-muted/20 p-6">
              {imageSrc ? (
                <Image
                  src={imageSrc}
                  alt={prompt || 'Generated design'}
                  width={1024}
                  height={1024}
                  unoptimized
                  className="max-h-full max-w-full rounded-md object-contain"
                />
              ) : (
                <p className="text-sm text-muted-foreground">Generated design will appear here.</p>
              )}
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
