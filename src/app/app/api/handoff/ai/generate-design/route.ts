import { NextResponse, type NextRequest } from 'next/server';
import { authOrCloudToken, rateLimitUserId } from '@/lib/sync-auth';
import { shouldProxyAi } from '@/lib/server/ai-client';
import { proxyAiToCloud } from '@/lib/server/ai-proxy';
import { insertDesignGenerationJob } from '@/lib/db/queries';
import { runDesignGenerationJob, serializeAttachedImages, type StoredImage } from '@/lib/server/design-generation-worker';
import type { ImageEditQuality } from '@/lib/server/ai-client';
import type {
  DesignConversationTurn,
  DesignWorkbenchComponentGuide,
  DesignWorkbenchFoundationContext,
} from '@/lib/server/design-prompt-builder';
import type { DesignGenerationRequestParams } from '@/lib/server/design-generation-worker';

// Vercel max function duration — gpt-image generation can take 3-4 minutes at high quality.
export const maxDuration = 300;

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

function toAllowedImageType(type: string): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') return type;
  return null;
}

function toAllowedImageQuality(value: string): ImageEditQuality {
  if (value === 'low' || value === 'medium' || value === 'high' || value === 'auto') return value;
  return 'auto';
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
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

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Could not parse form data.' }, { status: 400 });
  }

  const prompt = String(formData.get('prompt') ?? '').trim();
  if (!prompt) return NextResponse.json({ error: 'prompt is required' }, { status: 400 });

  const quality = toAllowedImageQuality(String(formData.get('quality') ?? 'auto'));
  const promptImageCount = Math.max(0, Number.parseInt(String(formData.get('promptImageCount') ?? '0'), 10) || 0);
  const existingArtifactId = String(formData.get('artifactId') ?? '').trim() || null;
  const layoutGuideDescription = String(formData.get('layoutGuideDescription') ?? '').trim();
  const layoutGuideImageIncluded = String(formData.get('layoutGuideImageIncluded') ?? '') === 'true';

  const foundationContext = safeJson<DesignWorkbenchFoundationContext>(String(formData.get('foundationContext') ?? ''), {
    colors: [], typography: [], effects: [], spacing: [],
  });
  const componentGuides = safeJson<DesignWorkbenchComponentGuide[]>(String(formData.get('componentGuides') ?? ''), []);
  const conversationHistory = safeJson<DesignConversationTurn[]>(String(formData.get('conversationHistory') ?? ''), []);
  const designGuidelines = String(formData.get('designGuidelines') ?? '').trim();
  const brandVoiceGuidelines = String(formData.get('brandVoiceGuidelines') ?? '').trim();
  const attachedImageLabels = safeJson<string[]>(String(formData.get('attachedImageLabels') ?? ''), []);

  // Validate image types
  const iterationBase = formData.get('iterationBase');
  if (iterationBase instanceof File && iterationBase.size > 0 && !toAllowedImageType(iterationBase.type)) {
    return NextResponse.json({ error: `iterationBase must be PNG, JPEG, or WEBP.` }, { status: 400 });
  }
  const customFoundationImageFile = formData.get('customFoundationImage');
  if (customFoundationImageFile instanceof File && customFoundationImageFile.size > 0 && !toAllowedImageType(customFoundationImageFile.type)) {
    return NextResponse.json({ error: `customFoundationImage must be PNG, JPEG, or WEBP.` }, { status: 400 });
  }
  const imageFiles = formData.getAll('image[]');
  for (const f of imageFiles) {
    if (f instanceof File && f.size > 0 && !toAllowedImageType(f.type)) {
      return NextResponse.json({ error: `Unsupported image type "${f.type}". Allowed: PNG, JPEG, WEBP.` }, { status: 400 });
    }
  }

  // Resolve iteration base URL (data URL for current canvas)
  let iterationBaseUrl: string | null = null;
  if (iterationBase instanceof File && iterationBase.size > 0) {
    const buf = Buffer.from(await iterationBase.arrayBuffer());
    const ct = toAllowedImageType(iterationBase.type)!;
    iterationBaseUrl = `data:${ct};base64,${buf.toString('base64')}`;
  }

  // Serialize user-attached prompt images
  const attachedImages = await serializeAttachedImages(
    imageFiles.filter((f): f is File => f instanceof File && f.size > 0)
  );

  let customFoundationImage: StoredImage | null = null;
  if (customFoundationImageFile instanceof File && customFoundationImageFile.size > 0) {
    const serialized = await serializeAttachedImages([customFoundationImageFile], 1);
    customFoundationImage = serialized[0] ?? null;
  }

  const requestParams: DesignGenerationRequestParams = {
    prompt,
    quality,
    iterationBaseUrl,
    conversationHistory,
    componentGuides: Array.isArray(componentGuides) ? componentGuides : [],
    foundationContext,
    designGuidelines,
    brandVoiceGuidelines,
    promptImageCount,
    attachedImages,
    layoutGuideDescription,
    layoutGuideImageIncluded,
    attachedImageLabels,
    customFoundationImage,
  };

  // Insert job row
  const jobId = await insertDesignGenerationJob({
    artifactId: existingArtifactId,
    userId,
    requestParams: requestParams as unknown as Record<string, unknown>,
  });

  record(userId, now);

  // Open an SSE stream that runs the worker INLINE.
  //
  // We do NOT detach the worker (neither via after() nor a fire-and-forget
  // promise). On Vercel's streaming model, background promises the response
  // body does not await are not guaranteed compute — the worker silently never
  // runs (no AI log, 300s timeout, "No image returned."). Awaiting it here is
  // exactly what the working inline path does, so it is reliable. maxDuration
  // (300s) covers the ~25s generation; a heartbeat keeps the connection warm.
  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const emit = (stage: SseStage, payload?: Record<string, unknown>) => {
        try { controller.enqueue(enc.encode(sseEvent(stage, payload))); } catch { /* closed */ }
      };

      emit('preparing', { jobId });

      // Heartbeat: re-emit the current stage every few seconds so proxies don't
      // treat the long generation as an idle connection and drop it.
      emit('generating');
      const heartbeat = setInterval(() => emit('generating'), 5000);

      try {
        await runDesignGenerationJob(jobId, userId);
        clearInterval(heartbeat);

        const { getDesignGenerationJob } = await import('@/lib/db/queries');
        const job = await getDesignGenerationJob(jobId);
        if (job?.status === 'done' && job.imageUrl) {
          emit('done', { imageUrl: job.imageUrl, jobId, artifactId: job.artifactId });
        } else {
          emit('error', { error: job?.error || 'Generation failed.' });
        }
      } catch (e) {
        clearInterval(heartbeat);
        console.error('[generate-design] worker error', jobId, e);
        emit('error', { error: e instanceof Error ? e.message : 'Generation failed.' });
      }

      try { controller.close(); } catch { /* already closed */ }
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
