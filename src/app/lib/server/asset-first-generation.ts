import 'server-only';

import { openAiImageEdit, type ImageEditSize } from '@/lib/server/ai-client';
import { planAssetsFromSpec, type AssetJob } from '@/lib/spec/asset-plan';
import type { ComponentSpec } from '@/lib/server/design-spec-types';
import type { StoredImage } from '@/lib/server/design-generation-worker';

/**
 * Asset-first generation: produce each declared image on its own, then compose the design FROM them.
 *
 * This inverts the pipeline. Previously one flat composite was generated and a second pass tried to
 * re-extract sub-regions from it — which could not work, because "extraction" was really an image
 * model repainting a crop, forced to 1024×1024 and unfaithful to the original pixels. Nothing about
 * that path could produce a right-sized, production-usable asset.
 *
 * Generating assets first fixes it by construction:
 *  - each asset is rendered at its own aspect ratio and resolution, from the spec's requirement
 *  - the asset is the real deliverable — the composite is assembled *from* it
 *  - so the photograph in the comp and the file a developer downloads are the same bytes
 *
 * **Placement holds in practice.** The open question was whether an image model handed a reference
 * photograph would place it verbatim or quietly reinterpret it — `attachmentLabel` instructs it not to,
 * but nothing here enforces that, and a redraw would silently cost the central guarantee. Confirmed by
 * inspection on live 8x8 spec-first runs (2026-07-29): the photograph in the composite matches the
 * standalone asset.
 *
 * That is an observation, not an invariant. It rests on a model instruction, so a model or prompt change
 * can break it without any code changing and without any test failing. A pixel comparison between each
 * generated asset and its region in the composite is what would turn this into something enforced;
 * until then, re-check it by eye after any change to the composite prompt or the image model.
 */

export interface GeneratedAsset {
  job: AssetJob;
  /** Data URL of the generated image, ready to persist as an artifact asset. */
  dataUrl: string;
}

export interface AssetFirstResult {
  assets: GeneratedAsset[];
  /** Slots whose generation failed, so the caller can report rather than silently omit them. */
  failed: { slot: string; error: string }[];
}

/**
 * Generate every asset a spec declares.
 *
 * Runs the jobs concurrently — they're independent, and serializing them would multiply latency by
 * the number of images. A failure is recorded per slot rather than aborting the batch: one missing
 * photograph should not cost you the rest of the design.
 */
export async function generateSpecAssets(
  spec: ComponentSpec,
  opts: {
    actorUserId?: string | null;
    max?: number;
    quality?: 'low' | 'medium' | 'high' | 'auto';
    /** Registry colours, so imagery generated in isolation still reads as part of the system. */
    palette?: string[];
  } = {}
): Promise<AssetFirstResult> {
  const jobs = planAssetsFromSpec(spec, { max: opts.max, palette: opts.palette });
  if (!jobs.length) return { assets: [], failed: [] };

  const settled = await Promise.allSettled(
    jobs.map(async (job) => {
      const dataUrl = await openAiImageEdit({
        prompt: job.prompt,
        // Text-to-image still needs an input canvas; a 1×1 keeps the model from anchoring on it.
        images: [{ filename: 'canvas.png', contentType: 'image/png', data: BLANK_PNG }],
        model: 'gpt-image-2',
        size: job.size as ImageEditSize,
        quality: opts.quality ?? 'high',
        actorUserId: opts.actorUserId ?? null,
        route: 'asset-first-generation',
        eventType: `ai.generate_asset.${job.kind}`,
      });
      return { job, dataUrl };
    })
  );

  const assets: GeneratedAsset[] = [];
  const failed: { slot: string; error: string }[] = [];
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') assets.push(r.value);
    else {
      const error = r.reason instanceof Error ? r.reason.message : String(r.reason);
      console.warn('[asset-first] asset generation failed', jobs[i].slot, error);
      failed.push({ slot: jobs[i].slot, error });
    }
  });

  return { assets, failed };
}

/**
 * Convert generated assets into the attachment pair the design-generation worker expects.
 *
 * Supplying both `attachedImages` and `attachedImageLabels` puts the worker on its
 * `designerAssembled` path, which attaches these as labelled references AND skips the iteration
 * base — correct here, because the composite should be built fresh from the assets rather than
 * edited from a previous canvas.
 */
export function assetsAsAttachments(assets: GeneratedAsset[]): { attachedImages: StoredImage[]; attachedImageLabels: string[] } {
  const attachedImages: StoredImage[] = [];
  const attachedImageLabels: string[] = [];

  for (const a of assets) {
    const parsed = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(a.dataUrl.trim());
    if (!parsed) continue;
    attachedImages.push({
      filename: a.job.filename,
      contentType: parsed[1].toLowerCase() as StoredImage['contentType'],
      dataBase64: parsed[2],
    });
    attachedImageLabels.push(a.job.attachmentLabel);
  }

  return { attachedImages, attachedImageLabels };
}

/**
 * Artifact `assets[]` entries for the generated images.
 *
 * These are populated at generation time, which is what turns "extraction" into enumeration: the
 * assets exist as first-class records because they were produced as assets, not carved out of a
 * composite afterwards. `offloadArtifactImages` moves the bytes to Blob on write.
 */
export function assetsAsArtifactAssets(assets: GeneratedAsset[]): Record<string, unknown>[] {
  return assets.map((a) => ({
    key: a.job.filename.replace(/\.[^.]+$/, ''),
    label: `${a.job.slot} (${a.job.kind})`,
    imageUrl: a.dataUrl,
    role: 'media',
    semanticName: a.job.slot,
    description: a.job.requirement.subject,
    // Provenance: generated to a declared requirement, not recovered from pixels.
    generatedFromRequirement: {
      slot: a.job.slot,
      aspect: a.job.requirement.aspect,
      minWidth: a.job.requirement.minWidth,
      size: a.job.size,
      focalPoint: a.job.requirement.focalPoint ?? null,
    },
  }));
}

/** 1×1 transparent PNG — the minimum input the image API accepts for text-to-image. */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
