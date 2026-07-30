import 'server-only';

import { getDesignArtifactById, updateDesignArtifactById } from '@/lib/db/queries';
import type { ImageEditInput } from '@/lib/server/ai-client';
import { buildGenerationPromptFromSpec } from '@/lib/spec/generation-prompt';
import { planAssetsFromSpec } from '@/lib/spec/asset-plan';
import { assetsAsArtifactAssets, generateSpecAssets } from '@/lib/server/asset-first-generation';
import { blobPathnameFromProxyUrl, isDataUrl, readPrivateBlob } from '@/lib/storage/artifact-images';
import type { ComponentSpec } from '@/lib/server/design-spec-types';
import type { PipelineJobRow, PipelineStage } from '@/lib/server/pipeline-queue';

/**
 * Stage handlers for the pipeline queue.
 *
 * One handler per stage, each sized to run in its own invocation. The queue owns ordering, retry and
 * claiming; a handler only has to do its work and return what later stages need.
 *
 * **Results carry references, never bytes.** A generated image is megabytes of base64, and putting
 * that in the job's `result` jsonb would recreate exactly the multi-MB-row problem that private Blob
 * storage just solved. So the `assets` stage persists images onto the artifact — where
 * `offloadArtifactImages` moves them to Blob — and returns only the keys. The `composite` stage reads
 * them back and resolves the Blob refs itself.
 */

export interface StageContext {
  job: PipelineJobRow;
  /** Results of earlier stages in this pipeline, keyed by stage name. */
  upstream: Record<string, unknown>;
  /** Wall-clock left for this stage in this invocation. */
  budgetMs: number;
}

export type StageHandler = (ctx: StageContext) => Promise<unknown>;

/** Load the artifact's current spec, or throw so the queue records a real reason. */
async function requireSpec(artifactId: string): Promise<{ spec: ComponentSpec; userId: string }> {
  const row = await getDesignArtifactById(artifactId);
  if (!row) throw new Error('Artifact not found.');
  if (!row.componentSpec) {
    throw new Error('Artifact has no specification yet — asset and composite stages are driven by the spec.');
  }
  return { spec: row.componentSpec as unknown as ComponentSpec, userId: row.userId };
}

/** Resolve a stored image value (data URL or private-Blob proxy) to bytes for an API call. */
async function toEditInput(filename: string, imageUrl: string): Promise<ImageEditInput | null> {
  let dataUrl = imageUrl;
  const blobPath = blobPathnameFromProxyUrl(imageUrl);
  if (blobPath) {
    const read = await readPrivateBlob(blobPath);
    if (!read) return null;
    dataUrl = `data:${read.contentType};base64,${read.buffer.toString('base64')}`;
  }
  if (!isDataUrl(dataUrl)) return null;
  const m = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  return { filename, contentType: m[1].toLowerCase() as ImageEditInput['contentType'], data: Buffer.from(m[2], 'base64') };
}

// ── assets ────────────────────────────────────────────────────────────────────

/**
 * Generate every image the spec declares, at its own aspect and resolution.
 *
 * This is the stage that makes assets web-ready by construction. It replaces the old
 * extract-crops-from-a-composite path, which asked an image model to repaint sub-regions at a forced
 * 1024×1024 and could never produce a faithful, correctly-sized file.
 */
const runAssetsStage: StageHandler = async ({ job }) => {
  const { spec, userId } = await requireSpec(job.artifactId);
  // The palette keeps an asset generated in isolation in the same colour family as the component it
  // will sit inside. Without it the generator sees only the requirement's subject line, which is how a
  // technically-correct photo still reads as belonging to a different design.
  const palette = await registryPalette();
  const planned = planAssetsFromSpec(spec, { palette });
  if (!planned.length) {
    // A component with no photographs needs no asset generation — the common case for atoms and forms.
    return { generated: [], skippedReason: 'Specification declares no imagery.' };
  }

  const { assets, failed } = await generateSpecAssets(spec, { actorUserId: userId, palette });
  if (!assets.length) {
    throw new Error(`All ${planned.length} asset generation(s) failed: ${failed.map((f) => `${f.slot}: ${f.error}`).join(' | ')}`);
  }

  // Persist onto the artifact so the bytes go to Blob, then return only keys.
  const existing = await getDesignArtifactById(job.artifactId);
  const prior = Array.isArray(existing?.assets) ? (existing!.assets as Record<string, unknown>[]) : [];
  const generated = assetsAsArtifactAssets(assets);
  const byKey = new Map<string, Record<string, unknown>>();
  for (const a of [...prior, ...generated]) {
    const key = typeof a.key === 'string' ? a.key : '';
    if (key) byKey.set(key, a);
  }
  await updateDesignArtifactById(job.artifactId, {
    assets: [...byKey.values()] as never,
    assetsStatus: 'done',
  } as Parameters<typeof updateDesignArtifactById>[1]);

  return {
    generated: assets.map((a) => ({ key: a.job.filename.replace(/\.[^.]+$/, ''), slot: a.job.slot, size: a.job.size })),
    failed,
  };
};

// ── composite ─────────────────────────────────────────────────────────────────

/**
 * Compose the design FROM the generated assets.
 *
 * Delegates to the real generation worker rather than calling the image API directly. That is the whole
 * point of this rewrite: the first version assembled its own `openAiImageEdit` call and, in doing so,
 * silently dropped everything the workspace contributes — 8x8's uploaded **button, input and
 * iconography reference images**, the custom foundation image, the textual foundations block, the design
 * guidelines and the brand voice. The output looked plausible and was badly off-brand: wrong buttons,
 * wrong typeface. Exactly the failure already recorded for MCP generation on 2026-07-29, recreated by
 * writing a second generation path instead of reusing the first.
 *
 * `assetsAsAttachments` was always built for the worker's `designerAssembled` path — supplying both
 * `attachedImages` and `attachedImageLabels` makes it attach them as labelled references and skip the
 * iteration base, which is correct here because the composite is built fresh from the assets rather than
 * edited from a previous canvas.
 *
 * **Do not reintroduce a direct image call here.** Anything the workbench sends must flow through the
 * worker, or this stage drifts out of parity again the next time the workbench gains context.
 */
const runCompositeStage: StageHandler = async ({ job, upstream }) => {
  const { spec, userId } = await requireSpec(job.artifactId);
  const row = await getDesignArtifactById(job.artifactId);

  // The assets this pipeline just generated, as labelled references telling the model to PLACE them.
  const generated = (upstream.assets as { generated?: { key: string; slot: string }[] } | undefined)?.generated ?? [];
  const artifactAssets = Array.isArray(row?.assets) ? (row!.assets as Record<string, unknown>[]) : [];

  const attachedImages: { filename: string; contentType: 'image/png' | 'image/jpeg' | 'image/webp'; dataBase64: string }[] = [];
  const attachedImageLabels: string[] = [];
  for (const g of generated) {
    const asset = artifactAssets.find((a) => a.key === g.key);
    const url = typeof asset?.imageUrl === 'string' ? asset.imageUrl : '';
    if (!url) continue;
    const input = await toEditInput(`${g.key}.png`, url);
    if (!input) continue;
    attachedImages.push({
      filename: input.filename,
      contentType: input.contentType as 'image/png' | 'image/jpeg' | 'image/webp',
      dataBase64: input.data.toString('base64'),
    });
    attachedImageLabels.push(
      `${input.filename}: the final image for the "${g.slot}" slot. Place it as-is in that position, ` +
        `cropping only if the layout demands it. Do NOT redraw, restyle, or replace its content.`
    );
  }

  // The registry's real tokens. The worker rasterizes these into the foundations sheet; an empty
  // context makes it skip rasterization entirely, which is how generation loses the sheet.
  const { buildFoundationContextFromRegistry } = await import('@/lib/server/foundation-context');
  const foundationContext = await buildFoundationContextFromRegistry();

  const { insertDesignGenerationJob } = await import('@/lib/db/queries');
  const { runDesignGenerationJob } = await import('@/lib/server/design-generation-worker');

  const jobId = await insertDesignGenerationJob({
    artifactId: job.artifactId,
    userId,
    requestParams: {
      prompt: buildGenerationPromptFromSpec(spec),
      quality: 'high',
      // No iteration base: the composite is assembled from the assets, not edited from a prior canvas.
      iterationBaseUrl: null,
      conversationHistory: [],
      componentGuides: [],
      foundationContext,
      // Empty strings, deliberately: `resolveDesignGenerationContext` falls back to the workspace's own
      // guidelines and brand voice, which is how every design inherits them without restating them.
      designGuidelines: '',
      brandVoiceGuidelines: '',
      promptImageCount: 0,
      attachedImages,
      attachedImageLabels,
    } as never,
  });

  await runDesignGenerationJob(jobId, userId);

  // The worker writes the image onto the linked artifact itself, so success is judged by what landed
  // on the row rather than by the call returning.
  const after = await getDesignArtifactById(job.artifactId);
  if (!after?.imageUrl?.trim() || after.imageUrl === row?.imageUrl) {
    const { getDesignGenerationJob } = await import('@/lib/db/queries');
    const finished = await getDesignGenerationJob(jobId);
    throw new Error(finished?.error ? String(finished.error) : 'The composite stage produced no image.');
  }

  return { attachedAssets: attachedImages.length, jobId };
};

// ── spec ──────────────────────────────────────────────────────────────────────

/**
 * Generate (or regenerate) the specification.
 *
 * Delegates to the existing queued path, which keeps `spec_status` as the UI-facing mirror and applies
 * its own watchdog. The pipeline row is the real claim; `spec_status` is set to `pending` first so that
 * path can take it.
 *
 * A lost `spec_status` claim is not treated as a failure. The cron's sentinel drain skips artifacts this
 * queue owns, but the two can still interleave (`spec_status` was already `pending` from a "Transition
 * to dev" before the pipeline was enqueued), and in that case another worker generated the very
 * specification this stage wanted. What matters is the outcome on the row, so the outcome is what's
 * checked — failing here would report a spurious error for work that actually succeeded.
 */
const runSpecStage: StageHandler = async ({ job, budgetMs }) => {
  const { runQueuedSpecGeneration } = await import('@/lib/server/dev-handoff');
  // `brief` mode writes the spec from the user's request with no image to read — the first stage of a
  // spec-first pipeline, where the composite does not exist yet and the spec is what produces it.
  // Everything else reads the existing composite and describes it.
  const mode = (job.payload as { mode?: string } | null)?.mode === 'brief' ? 'brief' : 'image';
  await updateDesignArtifactById(job.artifactId, { specStatus: 'pending' } as Parameters<typeof updateDesignArtifactById>[1]);
  const ran = await runQueuedSpecGeneration(job.artifactId, { budgetMs: Math.max(60_000, budgetMs - 15_000), mode });

  const row = await getDesignArtifactById(job.artifactId);
  const status = row?.specStatus ?? 'unknown';
  if (status !== 'done') {
    const meta = (row?.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.specError === 'string') throw new Error(meta.specError);
    // Still in flight under another worker: hand the stage back rather than fail it, so the next tick
    // re-checks instead of burning the retry budget on a race.
    if (!ran) throw new Error(`Another worker is generating this specification (status "${status}") — retrying.`);
    throw new Error(`Specification ended as "${status}".`);
  }
  return { specStatus: status, mode, claimedHere: ran };
};

/**
 * The registry's core colours, as human-readable names/values for an image prompt.
 *
 * Degrades to [] on any failure — imagery generated without colour guidance is worse, not broken, and
 * a token lookup should never cost you the asset.
 */
async function registryPalette(): Promise<string[]> {
  try {
    const { getTokenSummary, isTokenSummaryEmpty } = await import('@/lib/server/design-token-summary');
    const summary = await getTokenSummary();
    if (!summary || isTokenSummaryEmpty(summary)) return [];
    const colors = (summary as { colors?: { name?: string; value?: string }[] }).colors ?? [];
    return colors
      .map((c) => (c.name && c.value ? `${c.name} (${c.value})` : c.value || c.name || ''))
      .filter(Boolean)
      .slice(0, 6);
  } catch {
    return [];
  }
}

// ── conformance ───────────────────────────────────────────────────────────────

/**
 * Measure the rendered design against the registry's tokens.
 *
 * Runs last, because it can only run last: the `tokens` section reports which *observed* values map onto
 * real tokens, so it needs something rendered to observe. A brief-written spec omits it for exactly that
 * reason, and without this stage a spec-first design never got one at all.
 *
 * Never fails the pipeline. An unmeasured design is the state every spec-first design was already in;
 * failing here would turn a missing section into a broken run.
 */
const runConformanceStage: StageHandler = async ({ job }) => {
  const { measureTokenConformance } = await import('@/lib/server/design-spec-generator');
  const result = await measureTokenConformance(job.artifactId);
  if (!result.measured) console.log('[pipeline] conformance skipped', job.artifactId, result.reason);
  return result;
};

// ── registry ──────────────────────────────────────────────────────────────────

const HANDLERS: Record<PipelineStage, StageHandler> = {
  assets: runAssetsStage,
  composite: runCompositeStage,
  spec: runSpecStage,
  conformance: runConformanceStage,
};

/** Handler for a stage name, or null when the stage is unknown (so the queue can fail it clearly). */
export function handlerFor(stage: string): StageHandler | null {
  return (HANDLERS as Record<string, StageHandler>)[stage] ?? null;
}

/**
 * Rough minimum budget a stage needs to be worth starting.
 *
 * Starting a 100s+ image generation with 30s left just burns an attempt and strands the row, so the
 * drain checks this before claiming rather than after.
 */
export const STAGE_MIN_BUDGET_MS: Record<PipelineStage, number> = {
  assets: 150_000,
  composite: 130_000,
  spec: 90_000,
  // One vision call against one image — far cheaper than the generation stages.
  conformance: 60_000,
};

