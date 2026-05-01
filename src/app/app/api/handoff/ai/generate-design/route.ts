import { NextResponse, type NextRequest } from 'next/server';
import { authOrCloudToken, rateLimitUserId } from '@/lib/sync-auth';
import {
  buildDesignGenerationPrompt,
  type DesignConversationTurn,
  type DesignWorkbenchComponentGuide,
  type DesignWorkbenchFoundationContext,
} from '@/lib/server/design-prompt-builder';
import { renderFoundationsImage } from '@/lib/server/foundation-image';
import { openAiImageEdit, shouldProxyAi, type ImageEditInput } from '@/lib/server/ai-client';
import { proxyAiToCloud } from '@/lib/server/ai-proxy';

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

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw?.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
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

  try {
    const formData = await request.formData();
    const prompt = String(formData.get('prompt') ?? '').trim();
    if (!prompt) {
      return NextResponse.json({ error: 'prompt is required' }, { status: 400 });
    }

    const foundationContext = safeJson<DesignWorkbenchFoundationContext>(
      String(formData.get('foundationContext') ?? ''),
      { colors: [], typography: [], effects: [], spacing: [] }
    );
    const componentGuides = safeJson<DesignWorkbenchComponentGuide[]>(String(formData.get('componentGuides') ?? ''), []);
    const conversationHistory = safeJson<DesignConversationTurn[]>(String(formData.get('conversationHistory') ?? ''), []);

    const fullPrompt = buildDesignGenerationPrompt({
      userPrompt: prompt,
      foundationContext,
      componentGuides: Array.isArray(componentGuides) ? componentGuides : [],
      conversationHistory: Array.isArray(conversationHistory) ? conversationHistory : [],
    });

    const images: ImageEditInput[] = [];

    try {
      const foundationPng = await renderFoundationsImage(foundationContext);
      if (foundationPng) {
        images.push({
          filename: 'design-system-foundations.png',
          contentType: 'image/png',
          data: foundationPng,
        });
      }
    } catch (foundationErr) {
      console.error('[generate-design] foundation raster failed:', foundationErr);
    }

    const iterationBase = formData.get('iterationBase');
    if (iterationBase instanceof File && iterationBase.size > 0) {
      const ct = toAllowedImageType(iterationBase.type);
      if (!ct) {
        return NextResponse.json(
          { error: `iterationBase must be PNG, JPEG, or WEBP (got ${iterationBase.type || 'unknown'}).` },
          { status: 400 }
        );
      }
      images.push({
        filename: iterationBase.name || 'iteration-base.png',
        contentType: ct,
        data: Buffer.from(await iterationBase.arrayBuffer()),
      });
    }

    const files = formData.getAll('image[]');
    for (let i = 0; i < files.length; i += 1) {
      const value = files[i];
      if (!(value instanceof File) || value.size === 0) continue;
      const contentType = toAllowedImageType(value.type);
      if (!contentType) {
        return NextResponse.json(
          { error: `Unsupported image type "${value.type || 'unknown'}". Allowed: PNG, JPEG, WEBP.` },
          { status: 400 }
        );
      }
      const buffer = Buffer.from(await value.arrayBuffer());
      images.push({
        filename: value.name || `reference-${i + 1}.png`,
        contentType,
        data: buffer,
      });
    }

    if (images.length === 0) {
      return NextResponse.json(
        {
          error:
            'Add at least one reference image, select a component with a preview, include foundation tokens (for a generated reference sheet), or generate from the current canvas.',
        },
        { status: 400 }
      );
    }

    const image = await openAiImageEdit({
      prompt: fullPrompt,
      images,
      model: 'gpt-image-2',
      size: '1024x1024',
      actorUserId: userId,
      route: '/api/handoff/ai/generate-design',
      eventType: 'ai.generate_design',
    });

    record(userId, now);
    return NextResponse.json({ image });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI image request failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
