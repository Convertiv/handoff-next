import 'server-only';

import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import path from 'path';
import type { ComponentListObject } from '@handoff/transformers/preview/types';
import { getBuildJob, insertBuildJob, spawnComponentBuildWorker, resolveHandoffRepoRoot } from '@/lib/server/component-builder';
import {
  buildFoundationContextBlock,
  discoverScssEntryFromConfig,
  discoverScssImportPattern,
  loadReferenceMaterialsMarkdown,
  pickSimilarComponentExamples,
} from '@/lib/server/component-generation-context';
import { generateComponentWithLlm, type AssetRef, type LlmGeneratedComponent } from '@/lib/server/component-generation-llm';
import { compareDesignToPreviewScreenshot } from '@/lib/server/component-visual-compare';
import { captureComponentPreviewPng, componentPreviewPathPrefix, internalHandoffServerOrigin } from '@/lib/server/component-preview-screenshot';
import type { RendererKind } from '@/lib/server/component-scaffold';
import { scaffoldNewComponentPayload } from '@/lib/server/component-scaffold';
import { getDb } from '@/lib/db';
import {
  getComponentGenerationJob,
  getDesignArtifactById,
  listReferenceMaterials,
  updateComponentGenerationJob,
} from '@/lib/db/queries';
import { regenerateAllReferenceMaterialsPersisted } from '@/lib/server/reference-material-persist';
import { handoffComponents } from '@/lib/db/schema';

type SavedAsset = {
  label: string;
  httpPath: string;
  localPath: string;
  role?: string;
  usage?: string;
  description?: string;
};

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
};

function prependScssPreambleIfMissing(scss: string, preamble: string): string {
  const p = preamble.trim();
  if (!p) return scss;
  const s = scss || '';
  if (s.includes(p)) return s;
  return `${p}\n\n${s}`;
}

function warnIfHardcodedApiComponentUrls(gen: LlmGeneratedComponent, log: unknown[]): void {
  const parts: { key: string; text: string }[] = [];
  if (gen.entrySources.template) parts.push({ key: 'template', text: gen.entrySources.template });
  if (gen.entrySources.component) parts.push({ key: 'component', text: gen.entrySources.component });
  if (gen.entrySources.story) parts.push({ key: 'story', text: gen.entrySources.story });
  if (gen.entrySources.scss) parts.push({ key: 'scss', text: gen.entrySources.scss });
  for (const { key, text } of parts) {
    if (text.includes('/api/component/')) {
      console.warn(
        `[component-generation] entrySources.${key} contains hardcoded /api/component/ — use image-type properties and previews.design.values instead.`
      );
      log.push({ action: 'warn_hardcoded_asset_urls', key, t: new Date().toISOString() });
    }
  }
}

/**
 * Persist extracted asset data-URLs to disk so templates can reference them
 * via HTTP path (e.g. `/api/component/hero-dev-6-asset-0.png`).
 */
async function persistExtractedAssets(
  componentId: string,
  assets: unknown[],
  workingPath: string
): Promise<SavedAsset[]> {
  const publicDir = path.join(workingPath, 'public/api/component');
  await fs.mkdirp(publicDir);

  const saved: SavedAsset[] = [];
  let idx = 0;
  for (const raw of assets) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as { label?: string; imageUrl?: string; role?: string; usage?: string; description?: string };
    const dataUrl = typeof a.imageUrl === 'string' ? a.imageUrl : '';
    if (!dataUrl.startsWith('data:image/')) continue;

    const match = dataUrl.match(/^data:(image\/[\w+]+);base64,(.+)/);
    if (!match) continue;

    const mime = match[1]!.toLowerCase();
    const b64 = match[2]!;
    const ext = MIME_TO_EXT[mime] ?? '.png';
    const filename = `${componentId}-asset-${idx}${ext}`;
    const localPath = path.join(publicDir, filename);
    await fs.writeFile(localPath, Buffer.from(b64, 'base64'));

    saved.push({
      label: typeof a.label === 'string' ? a.label : `asset-${idx}`,
      httpPath: `/api/component/${filename}`,
      localPath,
      role: typeof a.role === 'string' ? a.role : undefined,
      usage: typeof a.usage === 'string' ? a.usage : undefined,
      description: typeof a.description === 'string' ? a.description : undefined,
    });
    idx++;
  }
  return saved;
}

function buildDbPayload(componentId: string, renderer: RendererKind, gen: LlmGeneratedComponent): ComponentListObject {
  const base = scaffoldNewComponentPayload({
    id: componentId,
    title: gen.title,
    group: gen.group,
    renderer,
    description: gen.description,
  });
  const previews: Record<string, { title: string; values: Record<string, unknown>; url: string }> = {};
  for (const [k, p] of Object.entries(gen.previews)) {
    previews[k] = { title: p.title, values: p.values, url: '' };
  }
  return {
    ...base,
    title: gen.title,
    description: gen.description,
    group: gen.group,
    type: gen.type,
    properties: gen.properties as ComponentListObject['properties'],
    previews,
    entrySources: gen.entrySources,
  } as unknown as ComponentListObject;
}

function componentBuildPollWaitMs(): number {
  const n = Number(process.env.HANDOFF_COMPONENT_BUILD_WAIT_MS);
  if (Number.isFinite(n) && n >= 60_000) return Math.min(n, 900_000);
  return 240_000;
}

async function waitForBuildJob(jobId: number): Promise<{ ok: boolean; error?: string }> {
  const timeoutMs = componentBuildPollWaitMs();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const j = await getBuildJob(jobId);
    if (!j) return { ok: false, error: 'Build job missing' };
    if (j.status === 'complete') return { ok: true };
    if (j.status === 'failed') return { ok: false, error: j.error || 'Build failed' };
    await new Promise((r) => setTimeout(r, 800));
  }
  return {
    ok: false,
    error: `Build timed out after ${Math.round(timeoutMs / 1000)}s waiting for Vite (raise HANDOFF_COMPONENT_BUILD_WAIT_MS or HANDOFF_COMPONENT_WORKER_TIMEOUT_MS).`,
  };
}

export async function runComponentGenerationJob(jobId: number): Promise<void> {
  const row = await getComponentGenerationJob(jobId);
  if (!row) return;
  if (row.status === 'complete' || row.status === 'failed') return;

  const db = getDb();

  const artifact = await getDesignArtifactById(row.artifactId);
  if (!artifact) {
    await updateComponentGenerationJob(jobId, { status: 'failed', error: 'Artifact not found', completedAt: new Date() });
    return;
  }

  const workingPath = process.env.HANDOFF_WORKING_PATH?.trim() || resolveHandoffRepoRoot();

  const renderer = row.renderer as RendererKind;
  const log: unknown[] = [];
  const max = row.maxIterations ?? 3;
  const goalScore = Number(process.env.HANDOFF_COMPONENT_VISUAL_THRESHOLD || 0.78);

  try {
    const refs = await listReferenceMaterials();
    const hasContent = refs.some((r) => (r.content?.trim().length ?? 0) > 50);
    if (!hasContent) {
      await regenerateAllReferenceMaterialsPersisted({ actorUserId: row.userId ?? null });
    }
  } catch {
    /* non-fatal: generation continues with placeholder reference text */
  }

  let referenceMarkdown = '';
  try {
    referenceMarkdown = await loadReferenceMaterialsMarkdown();
  } catch {
    referenceMarkdown = '';
  }

  const foundationBlock = await buildFoundationContextBlock(artifact);
  const similar = await pickSimilarComponentExamples({ artifact, maxExamples: 3 });
  const similarMd = similar.map((s) => `### ${s.id} — ${s.title}\n${s.snippet}`).join('\n\n');

  let scssPreamble = '';
  try {
    scssPreamble = await discoverScssImportPattern();
  } catch {
    scssPreamble = '';
  }
  if (!scssPreamble.trim()) {
    scssPreamble = discoverScssEntryFromConfig(workingPath);
  }

  let assetRefs: AssetRef[] = [];
  if (row.useExtractedAssets && Array.isArray(artifact.assets) && artifact.assets.length > 0) {
    try {
      const saved = await persistExtractedAssets(row.componentId, artifact.assets as unknown[], workingPath);
      assetRefs = saved.map((s) => ({
        label: s.label,
        httpPath: s.httpPath,
        role: s.role,
        usage: s.usage,
        description: s.description,
      }));
    } catch {
      assetRefs = [];
    }
  }

  let lastGen: LlmGeneratedComponent | null = null;
  let lastCompare: Awaited<ReturnType<typeof compareDesignToPreviewScreenshot>> | null = null;

  try {
    await updateComponentGenerationJob(jobId, { status: 'generating', error: null, iteration: 0 });

    for (let iter = 1; iter <= max; iter++) {
      await updateComponentGenerationJob(jobId, { iteration: iter, status: 'generating', generationLog: [...log] });

      const refinement =
        iter > 1 &&
        lastCompare &&
        lastGen &&
        (lastCompare.score < goalScore || (row.a11yStandard !== 'none' && !lastCompare.a11yPassed))
          ? {
              differences: lastCompare.differences,
              a11yNotes: lastCompare.a11yNotes,
              previous: lastGen,
            }
          : undefined;

      lastGen = await generateComponentWithLlm({
        artifact,
        componentId: row.componentId,
        renderer,
        behaviorPrompt: row.behaviorPrompt,
        a11yStandard: row.a11yStandard,
        useExtractedAssets: row.useExtractedAssets,
        referenceMarkdown,
        foundationBlock,
        similarExamplesMarkdown: similarMd,
        scssPreamble,
        assetRefs,
        refinement,
        actorUserId: row.userId,
      });

      lastGen.entrySources.scss = prependScssPreambleIfMissing(lastGen.entrySources.scss, scssPreamble);
      warnIfHardcodedApiComponentUrls(lastGen, log);

      const payload = buildDbPayload(row.componentId, renderer, lastGen);

      const [existing] = await db.select({ id: handoffComponents.id }).from(handoffComponents).where(eq(handoffComponents.id, row.componentId));
      if (existing) {
        await db
          .update(handoffComponents)
          .set({
            title: lastGen.title,
            description: lastGen.description,
            group: lastGen.group,
            type: lastGen.type,
            data: payload as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          })
          .where(eq(handoffComponents.id, row.componentId));
      } else {
        await db.insert(handoffComponents).values({
          id: row.componentId,
          title: lastGen.title,
          description: lastGen.description,
          group: lastGen.group,
          type: lastGen.type,
          data: payload as unknown as Record<string, unknown>,
          source: 'db',
        });
      }

      log.push({ action: 'llm_generated', iter, t: new Date().toISOString() });
      await updateComponentGenerationJob(jobId, { status: 'building', generationLog: [...log] });

      const buildJobId = await insertBuildJob(row.componentId);
      await updateComponentGenerationJob(jobId, { lastBuildJobId: buildJobId });
      spawnComponentBuildWorker(buildJobId);

      const buildOk = await waitForBuildJob(buildJobId);
      if (!buildOk.ok) {
        log.push({ action: 'build_failed', error: buildOk.error, iter });
        await updateComponentGenerationJob(jobId, {
          status: 'failed',
          error: buildOk.error ?? 'Build failed',
          generationLog: [...log],
          completedAt: new Date(),
        });
        return;
      }

      log.push({ action: 'build_ok', iter, buildJobId });

      await updateComponentGenerationJob(jobId, { status: 'validating', generationLog: [...log] });

      const VALIDATION_TIMEOUT_MS = 120_000;
      let validationBailed = false;

      try {
        const result = await Promise.race([
          (async () => {
            const origin = internalHandoffServerOrigin();
            const pathname = `${componentPreviewPathPrefix()}${row.componentId}-design.html`;
            let png: Buffer;
            try {
              png = await captureComponentPreviewPng(origin, pathname, { cacheKeySuffix: String(buildJobId) });
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              log.push({ action: 'screenshot_failed', msg, iter });
              await updateComponentGenerationJob(jobId, {
                status: 'failed',
                error: `Screenshot failed: ${msg}`,
                generationLog: [...log],
                completedAt: new Date(),
              });
              return 'bail' as const;
            }

            lastCompare = await compareDesignToPreviewScreenshot({
              designImageUrl: artifact.imageUrl,
              previewPng: png,
              a11yStandard: row.a11yStandard,
              actorUserId: row.userId,
            });

            log.push({
              action: 'compare',
              iter,
              score: lastCompare.score,
              differences: lastCompare.differences.slice(0, 12),
              a11yPassed: lastCompare.a11yPassed,
            });

            await updateComponentGenerationJob(jobId, {
              generationLog: [...log],
              visualScore: lastCompare.score,
              validationResults: {
                a11yNotes: lastCompare.a11yNotes,
                a11yPassed: lastCompare.a11yPassed,
              },
            });
            return 'ok' as const;
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Validation timed out after ${VALIDATION_TIMEOUT_MS / 1000}s`)), VALIDATION_TIMEOUT_MS)
          ),
        ]);
        if (result === 'bail') validationBailed = true;
      } catch (valErr) {
        const msg = valErr instanceof Error ? valErr.message : String(valErr);
        log.push({ action: 'screenshot_failed', msg, iter });
        await updateComponentGenerationJob(jobId, {
          status: 'failed',
          error: `Validation failed: ${msg}`,
          generationLog: [...log],
          completedAt: new Date(),
        });
        return;
      }

      if (validationBailed) return;

      const a11yOk = row.a11yStandard === 'none' || lastCompare.a11yPassed;
      if (lastCompare.score >= goalScore && a11yOk) {
        await updateComponentGenerationJob(jobId, {
          status: 'complete',
          generationLog: [...log],
          completedAt: new Date(),
          error: null,
        });
        return;
      }

      if (iter === max) {
        await updateComponentGenerationJob(jobId, {
          status: 'complete',
          generationLog: [...log],
          completedAt: new Date(),
          error: `Max iterations reached (best visual score ${lastCompare.score.toFixed(2)}).`,
        });
        return;
      }

      await updateComponentGenerationJob(jobId, { status: 'iterating', generationLog: [...log] });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateComponentGenerationJob(jobId, {
      status: 'failed',
      error: msg.slice(0, 8000),
      completedAt: new Date(),
    });
  }
}
