import { useEffect, useRef, useState } from 'react';
import { Label } from '../../ui/label';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { ImageIcon, Loader2, Sparkles, Trash2Icon, X } from 'lucide-react';
import { useEditContext } from '../EditContext';
import { useFieldMedia } from '../FieldMediaContext';
import { pollGenerationJob } from '@/lib/client/poll-generation-job';
import { clearImageFieldWrites, imageFieldWrites } from '@/lib/image-field-write';

/**
 * The image slot's editor: pick from the library, or describe one and have it made.
 *
 * Generation here rather than only in the chat because swapping one picture should not require
 * narrating the whole page to an assistant. The field already knows which slot it is and what
 * dimensions the block wants, so it can ask for exactly the right thing and write the answer straight
 * back — no placeholder to match, unlike the chat path.
 *
 * Same queue, same worker, same asset library as `request_image`; only the entry point differs. See
 * `docs/PLAYGROUND-ASSETS.md`.
 */
/**
 * `scalar` — the value at this path is the URL string itself, not an image object.
 *
 * The default shape is an object: this control writes `src`, `srcset` and `alt` *inside* the value it is
 * bound to. That is right for a prop like `desktopImage`, and wrong for an image item's `src`, which the
 * measured `array-of-image-object` encoding defines as a bare URL. Pointing the object form at `src` wrote
 * `src.src` and the component rendered `<img src="[object Object]">`.
 *
 * In scalar mode there is no `srcset` and no `alt` here — `alt` is the item's own sibling field, so
 * offering a second one would give an author two inputs writing to different places.
 */
export function ImageField({
  identifier,
  value,
  scalar = false,
}: {
  identifier: string[];
  value: any;
  data: any;
  scalar?: boolean;
}) {
  const { getData, handleInputChange, setCurrentImagePath, setCurrentImageRules, setCurrentImageScalar, setMediaBrowserOpen } =
    useEditContext();
  // True on every authenticated surface, including outside a playground; false for a guest.
  const { imageGeneration } = useFieldMedia();

  const raw = getData(identifier);
  const imgData = scalar ? { src: typeof raw === 'string' ? raw : '', alt: '' } : raw;
  const hasSrc = !!imgData?.src;

  const [genOpen, setGenOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  /** Aborts the poll when the sheet closes, so a discarded generation stops costing requests. */
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const openBrowser = () => {
    setCurrentImagePath(identifier);
    setCurrentImageRules(value.rules?.dimensions ?? null);
    // The browser commits the selection itself, so it has to know whether this path takes a URL or an
    // object. Without this the picker would reintroduce `src.src` on the very next selection.
    setCurrentImageScalar(scalar);
    setMediaBrowserOpen(true);
  };

  const removeImage = () => {
    for (const [path, v] of clearImageFieldWrites(identifier, scalar)) handleInputChange(path, v);
  };

  const generate = async () => {
    if (!brief.trim() || generating) return;
    setGenError(null);
    setGenerating(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/handoff/ai/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          brief,
          altText: imgData?.alt || undefined,
          // The block's own contract decides the aspect ratio, so a 16:9 hero slot does not get a
          // square photo cropped to fit.
          dimensions: value.rules?.dimensions ?? null,
        }),
      });
      const json = (await res.json()) as { jobId?: number; error?: string };
      if (!res.ok || !json.jobId) throw new Error(json.error || 'Could not start generation.');

      const result = await pollGenerationJob(json.jobId, { signal: controller.signal });
      if (result.status !== 'done' || !result.imageUrl) {
        throw new Error(result.error || 'Generation failed.');
      }

      // Straight into the field. The editor knows the exact path, so unlike the chat's canvas-wide
      // swap there is nothing to search for and nothing to race.
      // Alt only when the field has none, so generating a replacement never overwrites authored alt text.
      const writes = imageFieldWrites(
        identifier,
        { src: result.imageUrl, alt: imgData?.alt ? undefined : brief.trim().slice(0, 120) },
        scalar
      );
      for (const [path, v] of writes) handleInputChange(path, v);
      setGenOpen(false);
      setBrief('');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setGenError(e instanceof Error ? e.message : 'Generation failed.');
      }
    } finally {
      abortRef.current = null;
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-2 rounded-lg">
      {hasSrc && (
        /**
         * Remove lives **on the picture**, as a trash icon in its corner.
         *
         * It used to be a third button in the row below, and three labelled buttons do not fit the rail: "Remove"
         * was clipped, so the one destructive action was also the one you could not read. Putting it on the
         * preview is not just space — it attaches "remove" to the thing being removed, and leaves the row to the
         * two actions that are about *choosing* a picture.
         */
        <div className="relative flex items-center justify-center overflow-hidden rounded-lg bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgData.src}
            alt={imgData.alt || 'Preview'}
            className="max-h-40 object-contain"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
          <button
            type="button"
            onClick={removeImage}
            title="Remove image"
            aria-label="Remove image"
            /* Its own backdrop, because the icon sits over an unknown picture — a bare icon vanishes on half of them. */
            className="absolute right-1.5 top-1.5 rounded-md bg-background/85 p-1.5 text-muted-foreground shadow-sm backdrop-blur transition hover:bg-background hover:text-destructive"
          >
            <Trash2Icon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" className="flex-1 gap-1.5" onClick={openBrowser}>
          <ImageIcon className="h-3.5 w-3.5" />
          {hasSrc ? 'Change Image' : 'Select Image'}
        </Button>
        {/* Hidden where the surface can't generate — a guest builds from the asset library only, and the
            endpoint behind this needs a session, so offering it was a guaranteed 401. */}
        {imageGeneration && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setGenOpen((o) => !o)}
            aria-expanded={genOpen}
          >
            <Sparkles className="h-3.5 w-3.5" />
            Generate
          </Button>
        )}
      </div>

      {genOpen && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-2.5">
          <Input
            autoFocus
            value={brief}
            disabled={generating}
            placeholder="A nurse using a tablet in a bright ward"
            onChange={(e) => setBrief(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void generate();
              }
            }}
          />
          {generating ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              {/* Named up front: a minute of silence with no expectation set reads as broken. */}
              <span className="text-xs text-muted-foreground">Generating — this takes a minute or two.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto h-7 gap-1 text-xs"
                onClick={() => abortRef.current?.abort()}
              >
                <X className="h-3 w-3" />
                Stop
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" className="h-7 text-xs" disabled={!brief.trim()} onClick={() => void generate()}>
                Generate image
              </Button>
              <span className="text-[11px] text-muted-foreground">Saved to your asset library.</span>
            </div>
          )}
          {genError && <p className="text-xs text-destructive">{genError}</p>}
        </div>
      )}

      {!scalar && (
      <div className="space-y-1">
        <Label htmlFor={`${identifier[identifier.length - 1]}_alt`} className="text-xs">
          Alt text
        </Label>
        <Input
          id={`${identifier[identifier.length - 1]}_alt`}
          defaultValue={imgData?.alt || ''}
          onChange={(e) => handleInputChange([...identifier, 'alt'], e.target.value)}
        />
      </div>
      )}

      {value.description && <p className="text-xs text-muted-foreground">{value.description}</p>}
    </div>
  );
}
