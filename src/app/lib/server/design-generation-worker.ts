import 'server-only';

import { getDesignGenerationJob, insertDesignArtifact, updateDesignArtifactById, updateDesignGenerationJob } from '@/lib/db/queries';
import { openAiImageEdit, type ImageEditInput, type ImageEditQuality } from '@/lib/server/ai-client';
import {
  buildDesignGenerationPrompt,
  type DesignConversationTurn,
  type DesignWorkbenchComponentGuide,
  type DesignWorkbenchFoundationContext,
} from '@/lib/server/design-prompt-builder';
import { renderFoundationsImage } from '@/lib/server/foundation-image';
import { resolveDesignGenerationContext } from '@/lib/server/design-workspace';
import { COMPONENT_REFERENCE_SETTINGS } from '@/app/design/settings/settings-constants';

export type StoredImage = {
  filename: string;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  dataBase64: string;
};

export type DesignGenerationRequestParams = {
  prompt: string;
  quality: ImageEditQuality;
  /** data URL or HTTP URL for the current canvas — used as iteration base */
  iterationBaseUrl?: string | null;
  conversationHistory: DesignConversationTurn[];
  componentGuides: DesignWorkbenchComponentGuide[];
  foundationContext: DesignWorkbenchFoundationContext;
  designGuidelines: string;
  brandVoiceGuidelines: string;
  promptImageCount: number;
  /** User-attached prompt images stored as base64 (max 3, max 2MB each) */
  attachedImages?: StoredImage[];
  /** Labels matching attachedImages order (designer-assembled references) */
  attachedImageLabels?: string[];
  layoutGuideDescription?: string;
  layoutGuideImageIncluded?: boolean;
  /** Custom foundation image uploaded with the request */
  customFoundationImage?: StoredImage | null;
};

const MAX_ATTACHED = 12;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Serialize FormData images into a storable list (caps count and size). */
export async function serializeAttachedImages(files: File[], maxCount = MAX_ATTACHED): Promise<StoredImage[]> {
  const result: StoredImage[] = [];
  for (const f of files.slice(0, maxCount)) {
    if (f.size > MAX_IMAGE_BYTES) continue;
    const ct = f.type as StoredImage['contentType'];
    if (ct !== 'image/png' && ct !== 'image/jpeg' && ct !== 'image/webp') continue;
    const buf = Buffer.from(await f.arrayBuffer());
    result.push({ filename: f.name || 'image.png', contentType: ct, dataBase64: buf.toString('base64') });
  }
  return result;
}

function storedImageToEditInput(img: StoredImage): ImageEditInput {
  return {
    filename: img.filename,
    contentType: img.contentType,
    data: Buffer.from(img.dataBase64, 'base64'),
  };
}

async function urlToEditInput(url: string): Promise<ImageEditInput | null> {
  const trimmed = url.trim();
  const dataMatch = /^data:(image\/(?:png|jpeg|webp|jpg));base64,(.+)$/i.exec(trimmed);
  if (dataMatch) {
    let mime = dataMatch[1].toLowerCase();
    if (mime === 'image/jpg') mime = 'image/jpeg';
    if (mime !== 'image/png' && mime !== 'image/jpeg' && mime !== 'image/webp') return null;
    const buf = Buffer.from(dataMatch[2], 'base64');
    if (buf.length === 0) return null;
    const ext = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
    return { filename: `canvas.${ext}`, contentType: mime as ImageEditInput['contentType'], data: buf };
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const res = await fetch(trimmed);
      if (!res.ok) return null;
      const ct = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      let contentType: ImageEditInput['contentType'] | null = null;
      if (ct === 'image/png') contentType = 'image/png';
      else if (ct === 'image/jpeg' || ct === 'image/jpg') contentType = 'image/jpeg';
      else if (ct === 'image/webp') contentType = 'image/webp';
      if (!contentType) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return { filename: 'canvas.png', contentType, data: buf };
    } catch {
      return null;
    }
  }
  return null;
}

export async function runDesignGenerationJob(jobId: number, actorUserId: string): Promise<void> {
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    await updateDesignGenerationJob(jobId, { status: 'failed', error: 'HANDOFF_AI_API_KEY not configured.' });
    return;
  }

  const job = await getDesignGenerationJob(jobId);
  if (!job) return;
  if (job.status !== 'pending') return;

  await updateDesignGenerationJob(jobId, { status: 'running', stage: 'preparing' });

  try {
    const params = job.requestParams as unknown as DesignGenerationRequestParams;

    // Resolve workspace settings (design guidelines etc.)
    const workspaceResolved = await resolveDesignGenerationContext({
      designGuidelines: params.designGuidelines,
      brandVoiceGuidelines: params.brandVoiceGuidelines,
    });

    await updateDesignGenerationJob(jobId, { stage: 'preparing' });

    const images: ImageEditInput[] = [];
    const imageOrderLabels: string[] = [];
    const designerAssembled = Boolean(params.attachedImageLabels?.length && params.attachedImages?.length);

    // Foundation image
    if (params.customFoundationImage) {
      images.push(storedImageToEditInput(params.customFoundationImage));
      imageOrderLabels.push(
        'custom-foundations.png: custom foundation style reference from settings. Use only for styling; do not reproduce it as visible content.'
      );
    } else if (workspaceResolved.customFoundationImageUrl.startsWith('data:image/')) {
      const input = await urlToEditInput(workspaceResolved.customFoundationImageUrl);
      if (input) {
        images.push(input);
        imageOrderLabels.push(
          'custom-foundations.png: custom foundation style reference from settings. Use only for styling; do not reproduce it as visible content.'
        );
      }
    } else if (!designerAssembled) {
      try {
        const foundationPng = await renderFoundationsImage(params.foundationContext);
        if (foundationPng) {
          images.push({ filename: 'design-system-foundations.png', contentType: 'image/png', data: foundationPng });
          imageOrderLabels.push(
            'design-system-foundations.png: generated design system foundation style reference from settings/tokens. Use only for styling; do not reproduce the sheet as visible content.'
          );
        }
      } catch { /* non-fatal */ }
    } else {
      try {
        const foundationPng = await renderFoundationsImage(params.foundationContext);
        if (foundationPng) {
          images.push({ filename: 'design-system-foundations.png', contentType: 'image/png', data: foundationPng });
          imageOrderLabels.push(
            'design-system-foundations.png: generated design system foundation style reference from settings/tokens. Use only for styling; do not reproduce the sheet as visible content.'
          );
        }
      } catch { /* non-fatal */ }
    }

    if (designerAssembled) {
      for (let i = 0; i < (params.attachedImages ?? []).length; i += 1) {
        const img = params.attachedImages![i];
        images.push(storedImageToEditInput(img));
        imageOrderLabels.push(params.attachedImageLabels![i] ?? `${img.filename}: attached reference image.`);
      }
    } else {
      // Iteration base (current canvas)
      if (params.iterationBaseUrl) {
        const input = await urlToEditInput(params.iterationBaseUrl);
        if (input) {
          images.push(input);
          imageOrderLabels.push('iteration-base.png: main canvas image the user is referring to for this request.');
        }
      }

      // Component references from workspace
      for (const ref of workspaceResolved.componentReferenceFiles) {
        const match = ref.dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
        if (!match) continue;
        const ct = match[1] as ImageEditInput['contentType'];
        if (ct !== 'image/png' && ct !== 'image/jpeg' && ct !== 'image/webp') continue;
        const setting = COMPONENT_REFERENCE_SETTINGS.find((s) => s.id === ref.slot);
        images.push({ filename: ref.filename, contentType: ct, data: Buffer.from(match[2], 'base64') });
        imageOrderLabels.push(`${ref.filename}: saved ${setting?.label.toLowerCase() ?? ref.slot} style reference.`);
      }

      // User-attached images
      for (const img of params.attachedImages ?? []) {
        images.push(storedImageToEditInput(img));
        imageOrderLabels.push(`${img.filename}: user-attached reference image.`);
      }
    }

    // gpt-image-2 requires at least one input image even for text-to-image generation.
    // When no context images exist (empty settings, first generation), use a minimal
    // white canvas so the API accepts the request and generates from the prompt alone.
    if (images.length === 0) {
      // 8×8 px white PNG (smallest valid canvas gpt-image accepts)
      const WHITE_PNG_B64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAADklEQVQI12P4z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==';
      images.push({ filename: 'canvas.png', contentType: 'image/png', data: Buffer.from(WHITE_PNG_B64, 'base64') });
      imageOrderLabels.push('canvas.png: blank starting canvas — generate the design from the prompt alone.');
    }

    await updateDesignGenerationJob(jobId, { stage: 'building_prompt' });

    const fullPrompt = buildDesignGenerationPrompt({
      userPrompt: params.prompt,
      foundationContext: params.foundationContext,
      componentGuides: params.componentGuides,
      conversationHistory: params.conversationHistory,
      designGuidelines: workspaceResolved.designGuidelines,
      brandVoiceGuidelines: workspaceResolved.brandVoiceGuidelines,
      customFoundationImageIncluded: Boolean(params.customFoundationImage || workspaceResolved.customFoundationImageUrl),
      promptImageCount: params.promptImageCount,
      layoutGuideDescription: params.layoutGuideDescription ?? '',
      layoutGuideImageIncluded: Boolean(params.layoutGuideImageIncluded),
      attachedImageLabels: imageOrderLabels,
    });

    await updateDesignGenerationJob(jobId, { stage: 'generating' });

    const imageUrl = await openAiImageEdit({
      prompt: fullPrompt,
      images,
      model: 'gpt-image-2',
      size: '2048x1152',
      quality: params.quality,
      actorUserId,
      route: 'worker:design-generation',
      eventType: 'ai.generate_design',
    });

    // Auto-save the result as a draft artifact if no artifact is linked yet
    if (!job.artifactId) {
      try {
        const title = `Draft — ${new Date().toLocaleDateString()}`;
        const artifactId = await insertDesignArtifact({
          title,
          description: '',
          status: 'draft',
          userId: job.userId,
          imageUrl,
          conversationHistory: [
            ...params.conversationHistory,
            { role: 'user', prompt: params.prompt, timestamp: new Date().toISOString() },
            { role: 'assistant', prompt: 'Generated image', imageUrl, timestamp: new Date().toISOString() },
          ],
          componentGuides: params.componentGuides,
          foundationContext: params.foundationContext,
          assetsStatus: 'none',
        });
        if (artifactId) {
          await updateDesignGenerationJob(jobId, { artifactId });
        }
      } catch (e) {
        console.warn('[design-generation-worker] auto-save draft failed', e);
      }
    } else {
      // Update existing linked artifact with the new image + history
      try {
        await updateDesignArtifactById(job.artifactId, {
          imageUrl,
          status: 'draft',
          conversationHistory: [
            ...params.conversationHistory,
            { role: 'user', prompt: params.prompt, timestamp: new Date().toISOString() },
            { role: 'assistant', prompt: 'Generated image', imageUrl, timestamp: new Date().toISOString() },
          ] as Parameters<typeof updateDesignArtifactById>[1]['conversationHistory'],
        });
      } catch (e) {
        console.warn('[design-generation-worker] artifact update failed', e);
      }
    }

    await updateDesignGenerationJob(jobId, { status: 'done', stage: 'done', imageUrl });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateDesignGenerationJob(jobId, { status: 'failed', stage: 'done', error: msg.slice(0, 2000) });
  }
}
