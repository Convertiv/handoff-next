import {
  claimDesignArtifactForExtraction,
  finalizeDesignArtifactExtraction,
  getDesignArtifactById,
} from '@/lib/db/queries';
import { sanitizeDesignAssetsForStorage } from '@/lib/server/design-artifact-persist';
import { openAiImageEdit, type ImageEditInput } from '@/lib/server/ai-client';

const BACKGROUND_EXTRACTION_PROMPT = `This image is a UI mockup or marketing hero composition that layers text, buttons, and other overlays on top of a photographic or illustrated background scene.

Your task: produce a NEW image that isolates ONLY the underlying background photograph or atmospheric scene — the full photographic or illustrated backdrop behind the UI overlays.

What to REMOVE (these are overlay elements):
- All text: headlines, subheadings, body copy, labels, and captions
- All interactive UI: buttons, CTAs, links, navigation elements, icons
- Solid color overlay panels or gradient overlays that obscure the photo

What to KEEP (these are part of the scene):
- The full photographic or illustrated background (people, objects, scenery, lighting)
- Any floating cards, dashboard widgets, charts, or decorative UI elements that are composited INTO the scene as design elements (they are part of the visual composition, not removable overlays)
- The overall mood, lighting, color grade, and depth of field

Inpainting rules:
- Where text or buttons were removed, fill the area with a natural continuation of the surrounding background (not a checkerboard or flat color).
- Preserve the image dimensions and aspect ratio.
- Output a single image suitable as a reusable background asset.`;

const ELEMENTS_EXTRACTION_PROMPT = `This image is a UI mockup or marketing hero composition. It contains floating UI cards, dashboard widgets, charts, or other decorative visual elements composited on top of the background.

Your task: produce a NEW image that isolates ONLY the floating UI composition elements — the cards, charts, data widgets, and dashboard panels that are layered on top of the background scene.

What to EXTRACT and KEEP:
- Floating cards showing data (charts, numbers, statistics, graphs)
- Dashboard-style widgets and panels
- Any glassmorphism or frosted-glass UI elements that are decorative design assets
- Keep their visual styling (shadows, rounded corners, blur effects) intact

What to REMOVE:
- The background photograph or illustration (replace with a clean, neutral white or very light gray background)
- All headline text, body copy, and paragraph text
- All buttons and CTAs
- Navigation elements

Output rules:
- Place the extracted elements roughly where they appeared in the original composition
- Use a clean white/light gray background so the elements can be easily re-composited
- Keep the same relative sizing and spacing between elements
- Output a single image.`;

async function imageUrlToEditInput(imageUrl: string): Promise<ImageEditInput | null> {
  const trimmed = imageUrl.trim();
  const dataMatch = /^data:(image\/(?:png|jpeg|webp|jpg));base64,(.+)$/i.exec(trimmed);
  if (dataMatch) {
    let mime = dataMatch[1].toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') return null;
    const buf = Buffer.from(dataMatch[2], 'base64');
    if (buf.length === 0) return null;
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    return {
      filename: `composite.${ext}`,
      contentType: mime as ImageEditInput['contentType'],
      data: buf,
    };
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    const res = await fetch(trimmed);
    if (!res.ok) return null;
    const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    let contentType: ImageEditInput['contentType'] | null = null;
    if (ct === 'image/png') contentType = 'image/png';
    else if (ct === 'image/jpeg' || ct === 'image/jpg') contentType = 'image/jpeg';
    else if (ct === 'image/webp') contentType = 'image/webp';
    if (!contentType) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return { filename: 'composite.png', contentType, data: buf };
  }
  return null;
}

/**
 * Background worker entry: claim pending row, run gpt-image-2 isolation edit, persist assets.
 */
export async function runDesignAssetExtractionForArtifact(artifactId: string): Promise<void> {
  const claimed = await claimDesignArtifactForExtraction(artifactId);
  if (!claimed) {
    console.log('[design-asset-extractor] skip (not pending or already claimed)', artifactId);
    return;
  }

  const row = await getDesignArtifactById(artifactId);
  if (!row?.imageUrl?.trim()) {
    await finalizeDesignArtifactExtraction(artifactId, {
      assets: [],
      assetsStatus: 'failed',
      extractionError: 'No composite image on artifact.',
    });
    return;
  }

  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    await finalizeDesignArtifactExtraction(artifactId, {
      assets: [],
      assetsStatus: 'failed',
      extractionError: 'HANDOFF_AI_API_KEY is not configured.',
    });
    return;
  }

  try {
    const input = await imageUrlToEditInput(row.imageUrl);
    if (!input) {
      await finalizeDesignArtifactExtraction(artifactId, {
        assets: [],
        assetsStatus: 'failed',
        extractionError: 'Could not read composite image (need data URL or http image).',
      });
      return;
    }

    const editOpts = {
      model: 'gpt-image-2' as const,
      size: '1024x1024' as const,
      actorUserId: row.userId,
      route: 'worker:design-asset',
    };

    const [bgResult, elemResult] = await Promise.allSettled([
      openAiImageEdit({
        ...editOpts,
        prompt: BACKGROUND_EXTRACTION_PROMPT,
        images: [input],
        eventType: 'ai.design_asset_extract.background',
      }),
      openAiImageEdit({
        ...editOpts,
        prompt: ELEMENTS_EXTRACTION_PROMPT,
        images: [input],
        eventType: 'ai.design_asset_extract.elements',
      }),
    ]);

    const rawAssets: { label: string; imageUrl: string; prompt: string }[] = [];

    if (bgResult.status === 'fulfilled') {
      rawAssets.push({
        label: 'Background image',
        imageUrl: bgResult.value,
        prompt: BACKGROUND_EXTRACTION_PROMPT,
      });
    } else {
      console.error('[design-asset-extractor] background extraction failed:', bgResult.reason);
    }

    if (elemResult.status === 'fulfilled') {
      rawAssets.push({
        label: 'Composition elements',
        imageUrl: elemResult.value,
        prompt: ELEMENTS_EXTRACTION_PROMPT,
      });
    } else {
      console.error('[design-asset-extractor] elements extraction failed:', elemResult.reason);
    }

    if (rawAssets.length === 0) {
      const errors = [bgResult, elemResult]
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
      await finalizeDesignArtifactExtraction(artifactId, {
        assets: [],
        assetsStatus: 'failed',
        extractionError: errors.join(' | ').slice(0, 2000),
      });
      return;
    }

    const assets = sanitizeDesignAssetsForStorage(rawAssets) as typeof rawAssets;

    await finalizeDesignArtifactExtraction(artifactId, {
      assets,
      assetsStatus: 'done',
      extractionError: null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finalizeDesignArtifactExtraction(artifactId, {
      assets: [],
      assetsStatus: 'failed',
      extractionError: msg.slice(0, 2000),
    });
  }
}
