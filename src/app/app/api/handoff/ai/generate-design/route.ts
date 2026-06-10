import { NextResponse, type NextRequest } from 'next/server';
import { authOrCloudToken, rateLimitUserId } from '@/lib/sync-auth';
import {
  buildDesignGenerationPrompt,
  type DesignConversationTurn,
  type DesignWorkbenchComponentGuide,
  type DesignWorkbenchFoundationContext,
} from '@/lib/server/design-prompt-builder';
import { renderFoundationsImage } from '@/lib/server/foundation-image';
import { openAiImageEdit, shouldProxyAi, type ImageEditInput, type ImageEditQuality } from '@/lib/server/ai-client';
import { proxyAiToCloud } from '@/lib/server/ai-proxy';
import { resolveDesignGenerationContext } from '@/lib/server/design-workspace';
import { COMPONENT_REFERENCE_SETTINGS } from '@/app/design/settings/settings-constants';

const MAX_PER_USER_PER_MINUTE = 10;
const timestampsByUser = new Map<string, number[]>();

function pruneAndCountRecent(userId: string, windowMs: number, now: number): number {
  const arr = timestampsByUser.get(userId) ?? [];
  const cutoff = now - windowMs;
  const next = arr.filter((t) => t > cutoff);
  timestampsByUser.set(userId, next);
  return next.length;
}

function record(userId: string, now: number): void {
  const arr = timestampsByUser.get(userId) ?? [];
  arr.push(now);
  timestampsByUser.set(userId, arr);
}

function toAllowedImageType(type: string): ImageEditInput['contentType'] | null {
  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') {
    return type;
  }
  return null;
}

function toAllowedImageQuality(value: string): ImageEditQuality {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'auto') {
    return value;
  }
  return 'auto';
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeLabel(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 240) : fallback;
}

type SseStage = 'preparing' | 'building_prompt' | 'generating' | 'done' | 'error';

function sseEvent(stage: SseStage, payload?: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ stage, ...payload })}\n\n`;
}

export async function POST(request: NextRequest) {
  const ctx = await authOrCloudToken(request);
  if (ctx instanceof NextResponse) return ctx;

  const now = Date.now();
  const userId = rateLimitUserId(ctx, request);
  if (pruneAndCountRecent(userId, 60_000, now) >= MAX_PER_USER_PER_MINUTE) {
    return NextResponse.json({ error: 'Too many AI requests; try again in a minute.' }, { status: 429 });
  }

  if (shouldProxyAi()) {
    return proxyAiToCloud(request, { actingUserId: ctx.userId !== 'cloud-proxy' ? ctx.userId : undefined });
  }

  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    return NextResponse.json({ error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' }, { status: 503 });
  }

  // Parse form data before opening the stream so we can return JSON errors for bad inputs.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Could not parse form data.' }, { status: 400 });
  }

  const prompt = String(formData.get('prompt') ?? '').trim();
  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
  }

  const quality = toAllowedImageQuality(String(formData.get('quality') ?? 'auto'));
  const promptImageCount = Math.max(0, Number.parseInt(String(formData.get('promptImageCount') ?? '0'), 10) || 0);

  const foundationContext = safeJson<DesignWorkbenchFoundationContext>(String(formData.get('foundationContext') ?? ''), {
    colors: [],
    typography: [],
    effects: [],
    spacing: [],
  });
  const componentGuides = safeJson<DesignWorkbenchComponentGuide[]>(String(formData.get('componentGuides') ?? ''), []);
  const conversationHistory = safeJson<DesignConversationTurn[]>(String(formData.get('conversationHistory') ?? ''), []);
  const attachedImageLabels = safeJson<string[]>(String(formData.get('attachedImageLabels') ?? ''), []);

  // Validate attached image types before opening the stream.
  const iterationBase = formData.get('iterationBase');
  if (iterationBase instanceof File && iterationBase.size > 0) {
    if (!toAllowedImageType(iterationBase.type)) {
      return NextResponse.json(
        { error: `iterationBase must be PNG, JPEG, or WEBP (got ${iterationBase.type || 'unknown'}).` },
        { status: 400 }
      );
    }
  }
  const files = formData.getAll('image[]');
  for (const value of files) {
    if (!(value instanceof File) || value.size === 0) continue;
    if (!toAllowedImageType(value.type)) {
      return NextResponse.json(
        { error: `Unsupported image type "${value.type || 'unknown'}". Allowed: PNG, JPEG, WEBP.` },
        { status: 400 }
      );
    }
  }
  const customFoundationImage = formData.get('customFoundationImage');
  if (customFoundationImage instanceof File && customFoundationImage.size > 0) {
    if (!toAllowedImageType(customFoundationImage.type)) {
      return NextResponse.json(
        { error: `customFoundationImage must be PNG, JPEG, or WEBP (got ${customFoundationImage.type || 'unknown'}).` },
        { status: 400 }
      );
    }
  }

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (stage: SseStage, payload?: Record<string, unknown>) => {
        controller.enqueue(enc.encode(sseEvent(stage, payload)));
      };

      try {
        emit('preparing');

        let designGuidelines = String(formData.get('designGuidelines') ?? '').trim();
        let brandVoiceGuidelines = String(formData.get('brandVoiceGuidelines') ?? '').trim();

        const workspaceResolved = await resolveDesignGenerationContext({ designGuidelines, brandVoiceGuidelines });
        designGuidelines = workspaceResolved.designGuidelines;
        brandVoiceGuidelines = workspaceResolved.brandVoiceGuidelines;

        let customFoundationImageInput: ImageEditInput | null = null;
        if (customFoundationImage instanceof File && customFoundationImage.size > 0) {
          const contentType = toAllowedImageType(customFoundationImage.type)!;
          customFoundationImageInput = {
            filename: customFoundationImage.name || 'custom-foundations.png',
            contentType,
            data: Buffer.from(await customFoundationImage.arrayBuffer()),
          };
        } else if (workspaceResolved.customFoundationImageUrl.startsWith('data:image/')) {
          const match = workspaceResolved.customFoundationImageUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
          if (match) {
            const contentType = toAllowedImageType(match[1]);
            if (contentType) {
              customFoundationImageInput = {
                filename: 'custom-foundations.png',
                contentType,
                data: Buffer.from(match[2], 'base64'),
              };
            }
          }
        }

        const images: ImageEditInput[] = [];
        const attachedFilenames = new Set<string>();
        const imageOrderLabels: string[] = [];

        if (customFoundationImageInput) {
          images.push(customFoundationImageInput);
          imageOrderLabels.push('custom-foundations.png: custom foundation reference image from settings.');
        } else {
          try {
            const foundationPng = await renderFoundationsImage(foundationContext);
            if (foundationPng) {
              images.push({ filename: 'design-system-foundations.png', contentType: 'image/png', data: foundationPng });
              imageOrderLabels.push('design-system-foundations.png: generated design system foundations reference from settings/tokens.');
            }
          } catch (foundationErr) {
            console.error('[generate-design] foundation raster failed:', foundationErr);
          }
        }

        if (iterationBase instanceof File && iterationBase.size > 0) {
          const ct = toAllowedImageType(iterationBase.type)!;
          images.push({
            filename: iterationBase.name || 'iteration-base.png',
            contentType: ct,
            data: Buffer.from(await iterationBase.arrayBuffer()),
          });
          imageOrderLabels.push('iteration-base.png: main canvas image the user is referring to for this request.');
        }

        for (let i = 0; i < files.length; i += 1) {
          const value = files[i];
          if (!(value instanceof File) || value.size === 0) continue;
          const contentType = toAllowedImageType(value.type)!;
          const fname = value.name || `reference-${i + 1}.png`;
          attachedFilenames.add(fname);
          images.push({ filename: fname, contentType, data: Buffer.from(await value.arrayBuffer()) });
          imageOrderLabels.push(safeLabel(attachedImageLabels[i], `${fname}: attached reference image.`));
        }

        for (const ref of workspaceResolved.componentReferenceFiles) {
          if (attachedFilenames.has(ref.filename)) continue;
          const match = ref.dataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
          if (!match) continue;
          const contentType = toAllowedImageType(match[1]);
          if (!contentType) continue;
          const setting = COMPONENT_REFERENCE_SETTINGS.find((s) => s.id === ref.slot);
          images.push({ filename: ref.filename, contentType, data: Buffer.from(match[2], 'base64') });
          imageOrderLabels.push(
            `${ref.filename}: saved ${setting?.label.toLowerCase() ?? ref.slot} style reference from team workspace.`
          );
        }

        if (images.length === 0) {
          emit('error', {
            error:
              'Add at least one reference image, select a component with a preview, include foundation tokens (for a generated reference sheet), or generate from the current canvas.',
          });
          controller.close();
          return;
        }

        emit('building_prompt');

        const fullPrompt = buildDesignGenerationPrompt({
          userPrompt: prompt,
          foundationContext,
          componentGuides: Array.isArray(componentGuides) ? componentGuides : [],
          conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
          designGuidelines,
          brandVoiceGuidelines,
          customFoundationImageIncluded: Boolean(customFoundationImageInput),
          promptImageCount,
          attachedImageLabels: imageOrderLabels,
        });

        emit('generating');

        const image = await openAiImageEdit({
          prompt: fullPrompt,
          images,
          model: 'gpt-image-2',
          size: '1024x1024',
          quality,
          actorUserId: userId,
          route: '/api/handoff/ai/generate-design',
          eventType: 'ai.generate_design',
        });

        record(userId, now);
        emit('done', { imageUrl: image });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'AI image request failed';
        emit('error', { error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
