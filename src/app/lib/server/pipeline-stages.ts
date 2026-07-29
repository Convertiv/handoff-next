import 'server-only';

import { getDesignArtifactById, updateDesignArtifactById } from '@/lib/db/queries';
import { openAiImageEdit, type ImageEditInput } from '@/lib/server/ai-client';
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
 * The attachment labels instruct the model to place each asset rather than reinterpret it, which is
 * what keeps the photograph in the comp identical to the file a developer downloads. Verified holding
 * on a live run (2026-07-29) — but it is a model instruction, not an enforcement, so a placement check
 * remains worth building.
 */
const runCompositeStage: StageHandler = async ({ job, upstream }) => {
  const { spec, userId } = await requireSpec(job.artifactId);
  const row = await getDesignArtifactById(job.artifactId);

  const generated = ((upstream.assets as { generated?: { key: string; slot: string }[] } | undefined)?.generated ?? []);
  const artifactAssets = Array.isArray(row?.assets) ? (row!.assets as Record<string, unknown>[]) : [];

  const images: ImageEditInput[] = [];
  const labels: string[] = [];
  for (const g of generated) {
    const asset = artifactAssets.find((a) => a.key === g.key);
    const url = typeof asset?.imageUrl === 'string' ? asset.imageUrl : '';
    if (!url) continue;
    const input = await toEditInput(`${g.key}.png`, url);
    if (!input) continue;
    images.push(input);
    labels.push(
      `${input.filename}: the final image for the "${g.slot}" slot. Place it as-is in that position, ` +
        `cropping only if the layout demands it. Do NOT redraw, restyle, or replace its content.`
    );
  }

  // The rasterized token sheet. Measured on 8x8: generation without it produced 76% token overlap,
  // with it the same prompt came back exact. In spec-first this stage IS the design's only image, so
  // omitting the sheet here would make the new path produce worse output than the one it replaces.
  const foundationSheet = await foundationSheetInput();
  if (foundationSheet) {
    images.unshift(foundationSheet);
    labels.unshift(
      'design-system-foundations.png: the design system\'s colours, type and spacing. Use it for styling ONLY — never reproduce the sheet itself as visible content.'
    );
  }

  // gpt-image-2 requires at least one input image even for text-to-image.
  if (images.length === 0) {
    images.push({ filename: 'canvas.png', contentType: 'image/png', data: BLANK_PNG });
    labels.push('canvas.png: blank starting canvas — compose from the specification alone.');
  }

  const prompt =
    buildGenerationPromptFromSpec(spec) +
    (labels.length ? `\n\n## Attached images\n${labels.map((l) => `- ${l}`).join('\n')}` : '');

  const imageUrl = await openAiImageEdit({
    prompt,
    images,
    model: 'gpt-image-2',
    size: '2048x1152',
    quality: 'high',
    actorUserId: userId,
    route: 'pipeline:composite',
    eventType: 'ai.generate_design',
  });

  await updateDesignArtifactById(job.artifactId, { imageUrl } as Parameters<typeof updateDesignArtifactById>[1]);
  return { attachedAssets: generated.length, bytes: imageUrl.length };
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

/** The rasterized foundations sheet as an image input, or null when there is nothing to rasterize. */
async function foundationSheetInput(): Promise<ImageEditInput | null> {
  try {
    const [{ buildFoundationContextFromRegistry }, { renderFoundationsImage }] = await Promise.all([
      import('@/lib/server/foundation-context'),
      import('@/lib/server/foundation-image'),
    ]);
    const context = await buildFoundationContextFromRegistry();
    const png = await renderFoundationsImage(context);
    if (!png) return null;
    return { filename: 'design-system-foundations.png', contentType: 'image/png', data: png };
  } catch (err) {
    console.warn('[pipeline] foundation sheet unavailable', err);
    return null;
  }
}

// ── registry ──────────────────────────────────────────────────────────────────

const HANDLERS: Record<PipelineStage, StageHandler> = {
  assets: runAssetsStage,
  composite: runCompositeStage,
  spec: runSpecStage,
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
};

/** 1×1 transparent PNG — minimum accepted input for text-to-image. */
const BLANK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
