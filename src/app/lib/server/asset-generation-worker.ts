import 'server-only';

import { getDesignGenerationJob, updateDesignGenerationJob } from '@/lib/db/queries';
import { openAiImageEdit, type ImageEditQuality, type ImageEditSize } from '@/lib/server/ai-client';
import { decodeImageDataUrl } from '@/lib/image-bytes';
import { storeImageAsset } from '@/lib/server/store-image-asset';

/**
 * Generate one content image and put it in the asset library.
 *
 * Shares the `handoff_design_generation_job` queue with `runDesignGenerationJob` — same table, same
 * cron drain, same poll endpoints, distinguished by `requestParams.intent`. What it does **not** share
 * is the worker body: the design worker assembles foundation sheets, component references and
 * iteration bases, then auto-creates a `Draft — <date>` design artifact when none is given. A hero
 * photo wants none of that, and filling the design library with drafts from playground turns would be
 * a bug rather than a side effect.
 *
 * Why a queue at all: the playground chat route has a 120s budget and an image is 25s–4min. See
 * `docs/PLAYGROUND-ASSETS.md`.
 */

export interface AssetGenerationRequestParams {
  intent: 'asset';
  /** What to draw. Already composed by the caller from the block's purpose and the brand voice. */
  prompt: string;
  /** Asset library title. Also what the chat shows while it is generating. */
  title: string;
  /** What was actually asked for, before the style and no-text rules were appended. Shown in the library. */
  brief?: string;
  altText?: string | null;
  size?: ImageEditSize;
  quality?: ImageEditQuality;
  tags?: string[];
  /**
   * The placeholder this image replaces, so the client knows which canvas slot to swap. Opaque here —
   * the worker never touches the canvas; it only carries this back for the poller.
   */
  placeholderSrc?: string | null;
}

export function isAssetGenerationParams(params: unknown): params is AssetGenerationRequestParams {
  return (
    !!params &&
    typeof params === 'object' &&
    (params as { intent?: unknown }).intent === 'asset' &&
    typeof (params as { prompt?: unknown }).prompt === 'string'
  );
}

/**
 * gpt-image-2 requires at least one input image, so a from-nothing generation still has to hand it
 * something. A 1x1 transparent PNG is the smallest legal answer; the design worker uses an 8x8 white
 * one for the same reason.
 */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

export async function runAssetGenerationJob(jobId: number): Promise<void> {
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    await updateDesignGenerationJob(jobId, {
      status: 'failed',
      stage: 'done',
      error: 'HANDOFF_AI_API_KEY not configured.',
    });
    return;
  }

  const job = await getDesignGenerationJob(jobId);
  if (!job) return;
  // The only claim available on this table is read-then-write, matching the design worker. Overlapping
  // ticks are possible in principle; at one drain per minute against a job that takes minutes, the
  // real protection is that a re-run is idempotent — the asset id is content-addressed.
  if (job.status !== 'pending') return;

  const params = job.requestParams as unknown;
  if (!isAssetGenerationParams(params)) {
    await updateDesignGenerationJob(jobId, {
      status: 'failed',
      stage: 'done',
      error: 'Job is not an asset generation request.',
    });
    return;
  }

  await updateDesignGenerationJob(jobId, { status: 'running', stage: 'generating' });

  try {
    const dataUrl = await openAiImageEdit({
      prompt: params.prompt,
      images: [{ filename: 'blank.png', contentType: 'image/png', data: BLANK_PNG }],
      size: params.size ?? '1536x1024',
      quality: params.quality ?? 'medium',
      actorUserId: job.userId,
      route: 'worker:asset-generation',
      eventType: 'ai.asset_generation',
    });

    const decoded = decodeImageDataUrl(dataUrl);
    if (!decoded) {
      // The model can also return an http URL. Not fetched here on purpose: that is a server-side
      // fetch of a remote address and belongs behind the same SSRF guard as URL ingest, which is a
      // separate change. Failing loudly beats storing something unverified.
      throw new Error('Image generation returned something other than a storable image.');
    }

    const stored = await storeImageAsset({
      bytes: decoded.bytes,
      mimeType: decoded.mimeType,
      title: params.title,
      altText: params.altText ?? params.title,
      description: params.brief ?? params.prompt,
      tags: ['generated', ...(params.tags ?? [])],
      sourceType: 'upload',
      sourceMetadata: { generatedBy: 'playground', prompt: params.prompt, brief: params.brief ?? null, jobId },
      createdBy: job.userId,
    });

    await updateDesignGenerationJob(jobId, {
      status: 'done',
      stage: 'done',
      imageUrl: stored.storageUrl,
      assetId: stored.assetId,
    });
  } catch (err) {
    await updateDesignGenerationJob(jobId, {
      status: 'failed',
      stage: 'done',
      error: (err instanceof Error ? err.message : String(err)).slice(0, 2000),
    });
  }
}
