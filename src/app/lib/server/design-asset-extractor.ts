import {
  claimDesignArtifactForExtraction,
  finalizeDesignArtifactExtraction,
  getDesignArtifactById,
} from '@/lib/db/queries';
import { openAiChatJson, openAiImageEdit, type ImageEditInput } from '@/lib/server/ai-client';
import { imageUrlToVisionPart } from '@/lib/server/component-generation-images';
import type { DesignClassification, ExtractedAssetV2 } from '@/lib/server/design-spec-types';

const ASSET_VISION_MODEL = () => process.env.HANDOFF_ASSET_VISION_MODEL?.trim() || 'gpt-4o-mini';

/** Convert a data URL or http URL to an ImageEditInput buffer. */
export async function imageUrlToEditInput(imageUrl: string): Promise<ImageEditInput | null> {
  const trimmed = imageUrl.trim();
  const dataMatch = /^data:(image\/(?:png|jpeg|webp|jpg));base64,(.+)$/i.exec(trimmed);
  if (dataMatch) {
    let mime = dataMatch[1].toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') return null;
    const buf = Buffer.from(dataMatch[2], 'base64');
    if (buf.length === 0) return null;
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    return { filename: `composite.${ext}`, contentType: mime as ImageEditInput['contentType'], data: buf };
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

// ── Phase 1: Classify ─────────────────────────────────────────────────────────

function parseClassification(raw: string): DesignClassification {
  const fallback: DesignClassification = {
    componentType: 'other',
    suggestedName: 'Component',
    visibleStates: ['default'],
    subComponents: [],
    hasIcons: false,
    hasMedia: false,
    complexity: 'medium',
  };
  try {
    const o = JSON.parse(raw) as Partial<DesignClassification>;
    return {
      componentType: (o.componentType as DesignClassification['componentType']) || fallback.componentType,
      suggestedName: typeof o.suggestedName === 'string' && o.suggestedName.trim() ? o.suggestedName.trim() : fallback.suggestedName,
      visibleStates: Array.isArray(o.visibleStates) && o.visibleStates.length > 0 ? o.visibleStates : fallback.visibleStates,
      subComponents: Array.isArray(o.subComponents) ? o.subComponents : [],
      hasIcons: Boolean(o.hasIcons),
      hasMedia: Boolean(o.hasMedia),
      complexity: (o.complexity as DesignClassification['complexity']) || fallback.complexity,
    };
  } catch {
    return fallback;
  }
}

async function classifyDesign(imageUrl: string, actorUserId: string | null): Promise<DesignClassification> {
  const part = await imageUrlToVisionPart(imageUrl, 'low');
  if (!part) {
    return { componentType: 'other', suggestedName: 'Component', visibleStates: ['default'], subComponents: [], hasIcons: false, hasMedia: false, complexity: 'medium' };
  }

  const system = `You are analyzing a UI design screenshot. Classify it and return JSON only:
{
  "componentType": "button|card|form|input|navigation|modal|table|list|badge|tooltip|hero|banner|media|other",
  "suggestedName": "short PascalCase component name e.g. PrimaryButton",
  "visibleStates": ["default", and any of: "hover","focus","active","disabled","error","loading","selected","expanded"],
  "subComponents": [{"name":"short name","role":"what it does"}, ...],
  "hasIcons": true|false,
  "hasMedia": true|false,
  "complexity": "simple|medium|complex"
}
Rules:
- visibleStates: only include states actually visible as separate variations in the screenshot
- subComponents: reusable child pieces e.g. label, icon slot, avatar, badge
- complexity: simple=1-2 elements, medium=3-6, complex=7+`;

  try {
    const raw = await openAiChatJson(
      [
        { role: 'system', content: system },
        { role: 'user', content: [{ type: 'text', text: 'Classify this UI design:' }, part] },
      ],
      { actorUserId, route: 'design-asset-extract', eventType: 'ai.design_classify', model: ASSET_VISION_MODEL(), maxTokens: 400 }
    );
    return parseClassification(raw);
  } catch (e) {
    console.warn('[design-asset-extractor] classify failed, using fallback:', e);
    return { componentType: 'other', suggestedName: 'Component', visibleStates: ['default'], subComponents: [], hasIcons: false, hasMedia: false, complexity: 'medium' };
  }
}

// ── Phase 2: Semantic extraction ──────────────────────────────────────────────

interface ExtractionTask {
  key: string;
  role: ExtractedAssetV2['role'];
  label: string;
  stateName?: string;
  prompt: string;
  semanticName?: string;
}

function buildExtractionTasks(classification: DesignClassification): ExtractionTask[] {
  const tasks: ExtractionTask[] = [];

  // Always include annotated overview (no image edit needed — we use the original)
  // It's added after extraction as role: annotated_overview

  // State variants
  for (const state of classification.visibleStates) {
    if (state === 'default') continue; // default state is the composite itself
    tasks.push({
      key: `state_${state}`,
      role: 'state',
      stateName: state,
      label: `${state.charAt(0).toUpperCase() + state.slice(1)} state`,
      semanticName: `${classification.suggestedName} — ${state}`,
      prompt: buildStateExtractionPrompt(classification.componentType, state),
    });
  }

  // Sub-components (up to 3)
  for (const sub of classification.subComponents.slice(0, 3)) {
    const key = `sub_${sub.name.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30)}`;
    tasks.push({
      key,
      role: 'subcomponent',
      label: sub.name,
      semanticName: `${sub.name} — ${sub.role}`,
      prompt: buildSubcomponentPrompt(sub.name, sub.role),
    });
  }

  // Icons (up to 2) when present
  if (classification.hasIcons) {
    tasks.push({
      key: 'icons',
      role: 'icon',
      label: 'Icons',
      prompt: `Extract all icons from this UI design as individual icon glyphs on a transparent background. Include only the icon shapes, not surrounding buttons or containers. Preserve original proportions.`,
    });
  }

  // Media (once) when present
  if (classification.hasMedia) {
    tasks.push({
      key: 'media',
      role: 'media',
      label: 'Media',
      prompt: `Extract the main media element (photo, video thumbnail, or illustration) from this design. Preserve the crop and framing as it appears. Remove surrounding UI chrome, text, and buttons.`,
    });
  }

  // Background for hero/banner/card types
  if (['hero', 'banner', 'card', 'media'].includes(classification.componentType)) {
    tasks.push({
      key: 'background',
      role: 'background',
      label: 'Background',
      prompt: `Extract the background layer (fill, gradient, texture, or backdrop) from this design. Remove all foreground content: text, buttons, icons, photos. Output a CSS-ready background-image asset.`,
    });
  }

  return tasks;
}

function buildStateExtractionPrompt(componentType: string, state: string): string {
  return `Extract the ${state} state variant of this ${componentType} UI component.
Show only the ${state} state as it appears in the design, isolated from other states.
Preserve the component's full bounding box and styling.
Remove surrounding page content that is not part of this component state.`;
}

function buildSubcomponentPrompt(name: string, role: string): string {
  return `Extract the "${name}" sub-component (${role}) from this UI design.
Isolate this element with a transparent or neutral background.
Preserve its exact visual treatment including colors, typography, and decorative elements.
Remove surrounding layout, other components, and unrelated UI chrome.`;
}

// Vision gate: verify extracted asset is grounded in original
async function visionValidateAsset(
  originalUrl: string,
  assetUrl: string,
  task: ExtractionTask,
  actorUserId: string | null
): Promise<boolean> {
  try {
    const [orig, asset] = await Promise.all([imageUrlToVisionPart(originalUrl, 'low'), imageUrlToVisionPart(assetUrl, 'low')]);
    if (!orig || !asset) return true; // can't validate, pass through
    const raw = await openAiChatJson(
      [
        {
          role: 'system',
          content: `Compare two images. Image A is the original design. Image B is an extracted asset.
Reply JSON only: {"ok":true|false,"explanation":"one sentence"}.
Set ok=true only if B is grounded in A (no invented content) AND matches the intended role "${task.role}" / label "${task.label}".`,
        },
        { role: 'user', content: [{ type: 'text', text: 'Image A — original:' }, orig, { type: 'text', text: 'Image B — extracted:' }, asset] },
      ],
      { actorUserId, route: 'design-asset-extract', eventType: 'ai.design_asset_validate', model: ASSET_VISION_MODEL(), maxTokens: 160 }
    );
    const parsed = JSON.parse(raw) as { ok?: boolean };
    return parsed.ok !== false;
  } catch {
    return true;
  }
}

export type ExtractDesignAssetsResult = {
  assets: ExtractedAssetV2[];
  classification: DesignClassification | null;
  assetsStatus: 'done' | 'failed';
  extractionError: string | null;
};

/**
 * Two-phase semantic extraction:
 *   Phase 1 — classify the design (component type, visible states, sub-components)
 *   Phase 2 — extract each layer in parallel using type-aware prompts
 * Also produces the annotated overview by including the original as a labelled asset.
 */
export async function extractDesignAssetsFromCompositeImage(params: {
  imageUrl: string;
  actorUserId: string | null;
}): Promise<ExtractDesignAssetsResult> {
  const { imageUrl, actorUserId } = params;
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    return { assets: [], classification: null, assetsStatus: 'failed', extractionError: 'HANDOFF_AI_API_KEY is not configured.' };
  }

  try {
    const input = await imageUrlToEditInput(imageUrl);
    if (!input) {
      return { assets: [], classification: null, assetsStatus: 'failed', extractionError: 'Could not read composite image.' };
    }

    // Phase 1 — classify
    const classification = await classifyDesign(imageUrl, actorUserId);

    // Build extraction tasks based on classification
    const tasks = buildExtractionTasks(classification);

    // Phase 2 — extract in parallel (up to 4 at a time)
    const editOpts = { model: 'gpt-image-2' as const, size: '1024x1024' as const, actorUserId, route: 'worker:design-asset' };
    const CONCURRENCY = 4;
    const rawAssets: ExtractedAssetV2[] = [];
    const extractionErrors: string[] = [];

    for (let i = 0; i < tasks.length; i += CONCURRENCY) {
      const batch = tasks.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (task) => {
          const assetUrl = await openAiImageEdit({
            ...editOpts,
            prompt: task.prompt,
            images: [input],
            eventType: `ai.design_asset_extract.${task.role}`,
          });
          return { task, assetUrl };
        })
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
          extractionErrors.push(msg);
        } else {
          rawAssets.push({
            key: result.value.task.key,
            label: result.value.task.label,
            imageUrl: result.value.assetUrl,
            role: result.value.task.role,
            stateName: result.value.task.stateName,
            semanticName: result.value.task.semanticName,
            description: result.value.task.prompt.split('\n')[0],
            prompt: result.value.task.prompt,
          });
        }
      }
    }

    if (rawAssets.length === 0) {
      return {
        assets: [],
        classification,
        assetsStatus: 'failed',
        extractionError: extractionErrors.join(' | ').slice(0, 2000) || 'No assets extracted.',
      };
    }

    // Validate assets (skip annotated_overview — it IS the original)
    const vetted: ExtractedAssetV2[] = [];
    for (const asset of rawAssets) {
      const ok = await visionValidateAsset(imageUrl, asset.imageUrl, { ...asset, prompt: asset.prompt ?? '', semanticName: asset.semanticName }, actorUserId);
      if (!ok) {
        console.warn('[design-asset-extractor] discarded asset (validation):', asset.key);
        continue;
      }
      vetted.push(asset);
    }

    // Always add the original as the annotated_overview reference
    const overview: ExtractedAssetV2 = {
      key: 'annotated_overview',
      label: 'Design overview',
      imageUrl,
      role: 'annotated_overview',
      description: 'Original composite design image — primary reference for spec generation.',
    };

    const all = [overview, ...vetted];

    if (all.length === 1) {
      // Only overview extracted (everything else was rejected or skipped)
      return { assets: all, classification, assetsStatus: 'done', extractionError: null };
    }

    return { assets: all, classification, assetsStatus: 'done', extractionError: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { assets: [], classification: null, assetsStatus: 'failed', extractionError: msg.slice(0, 2000) };
  }
}

/** Background worker entry: claim pending row, run extraction, persist assets + classification. */
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

  const result = await extractDesignAssetsFromCompositeImage({ imageUrl: row.imageUrl, actorUserId: row.userId });

  await finalizeDesignArtifactExtraction(artifactId, {
    assets: result.assets as unknown[],
    assetsStatus: result.assetsStatus,
    extractionError: result.extractionError,
  });
}
