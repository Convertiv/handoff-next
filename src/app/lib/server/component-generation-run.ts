import 'server-only';

import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import path from 'path';
import type { ComponentListObject } from '@handoff/transformers/preview/types';
import { resolveHandoffRepoRoot } from '@/lib/server/component-builder';
import {
  buildFoundationContextBlock,
  discoverScssEntryFromConfig,
  discoverScssImportPattern,
  loadReferenceMaterialsMarkdown,
  pickSimilarComponentExamples,
} from '@/lib/server/component-generation-context';
import { generateComponentWithLlm, type AssetRef, type LlmGeneratedComponent } from '@/lib/server/component-generation-llm';
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

  let designWorkspaceMarkdown = '';
  try {
    const { loadDesignWorkspaceMarkdown } = await import('@/lib/server/design-workspace');
    designWorkspaceMarkdown = await loadDesignWorkspaceMarkdown();
  } catch {
    designWorkspaceMarkdown = '';
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

  try {
    await updateComponentGenerationJob(jobId, { status: 'generating', error: null, iteration: 0 });

    for (let iter = 1; iter <= max; iter++) {
      await updateComponentGenerationJob(jobId, { iteration: iter, status: 'generating', generationLog: [...log] });

      const refinement = undefined;

      lastGen = await generateComponentWithLlm({
        artifact,
        componentId: row.componentId,
        renderer,
        behaviorPrompt: row.behaviorPrompt,
        a11yStandard: row.a11yStandard,
        useExtractedAssets: row.useExtractedAssets,
        referenceMarkdown,
        designWorkspaceMarkdown,
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
      log.push({
        action: 'metadata_only',
        note: 'Server-side preview builds are retired. Pull this component, build locally, and run handoff-app push --build.',
      });
      await updateComponentGenerationJob(jobId, {
        status: 'complete',
        generationLog: [...log],
        completedAt: new Date(),
        error: null,
      });
      return;
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
