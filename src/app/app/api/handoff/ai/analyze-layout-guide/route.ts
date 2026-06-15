import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { authOrCloudToken, rateLimitUserId } from '@/lib/sync-auth';
import {
  openAiChatJson,
  openAiImageEdit,
  shouldProxyAi,
  type ImageContent,
  type ImageEditInput,
} from '@/lib/server/ai-client';
import { proxyAiToCloud } from '@/lib/server/ai-proxy';

export const runtime = 'nodejs';

const MAX_PER_USER_PER_MINUTE = 10;
const timestampsByUser = new Map<string, number[]>();
const WIREFRAME_STYLE_REFERENCE_FILES = ['wireframe-example-1.png', 'wireframe-example-2.png'];
const LAYOUT_GUIDE_PROMPT =
  'Analyze the attached screenshot of a web section and describe only its layout structure for wireframing. Ignore all actual copy, brand names, colors, typography, imagery style, and visual design details. Focus on the web elements, their hierarchy, alignment, grouping, spacing, and approximate word-count ranges for text areas. Return the result as one concise paragraph. Include structural elements such as cards, columns, rows, headings, logo/image placeholders, text blocks, buttons, lists, and repeated content items. For each text element, estimate the word-count range by counting the visible words in the screenshot and allowing a small ± range. Do not describe the content meaning or exact wording.';
const WIREFRAME_PROMPT =
  'Create a low-fidelity grayscale wireframe of the first attached image, which is the source web section screenshot. Additional attached images are internal wireframe style references only; use them for line weight, placeholder treatment, grayscale tone, spacing feel, and overall wireframe style, but do not copy their content or layout. Preserve only the source screenshot layout structure, hierarchy, alignment, grouping, spacing, and approximate element sizes. Replace all real copy with simple placeholder lines or word-count blocks. Represent every visible button as a wireframed button placeholder labeled "CTA"; do not preserve the original button text. Do not convert plain links or general CTA-like text into buttons unless they are visually presented as buttons in the screenshot. Replace every image, photo, illustration, logo, icon, decorative graphic, product visual, avatar, chart visual, and other non-text visual element with a plain rectangular placeholder labeled "Image"; do not redraw, trace, approximate, or recreate the visual itself as a wireframe. Do not add artificial horizontal or vertical divider lines to separate sections; only include lines, borders, or rules if they are necessary to represent actual content containers or visible content elements. Focus on representing the content blocks and their layout, not drawing section separators. Remove all brand styling, colors, typography, imagery style, and visual design details. If the section contains prominent numeric stats, metrics, or large-number counters, preserve those visible numbers as numbers in the wireframe so the stat layout remains clear; nearby labels should still become generic placeholder text. Use simple black, gray, and white boxes and lines only. Do not reproduce exact text, brand names, or brand marks.';

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

function allowedMime(type: string): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (type === 'image/png' || type === 'image/jpeg' || type === 'image/webp') return type;
  return null;
}

function parseDescription(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { description?: unknown };
    return typeof parsed.description === 'string' ? parsed.description.trim() : '';
  } catch {
    return raw.trim();
  }
}

function buildWireframePrompt(layoutDescription: string): string {
  return [
    WIREFRAME_PROMPT,
    'Layout analysis of the source screenshot (use this to confirm structure, element types, counts, and hierarchy; the screenshot remains the primary visual reference):',
    layoutDescription,
  ].join('\n\n');
}

async function loadWireframeStyleReferences(): Promise<ImageEditInput[]> {
  const styleDirFromRepoRoot = 'src/app/app/api/handoff/ai/analyze-layout-guide/wireframe-style';
  const styleDirCandidates = [
    path.join(process.cwd(), styleDirFromRepoRoot),
    path.resolve(process.cwd(), '../..', styleDirFromRepoRoot),
  ];

  return Promise.all(
    WIREFRAME_STYLE_REFERENCE_FILES.map(async (filename) => {
      for (const styleDir of styleDirCandidates) {
        try {
          return {
            filename,
            contentType: 'image/png' as const,
            data: await readFile(path.join(styleDir, filename)),
          };
        } catch (e) {
          const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';
          if (code !== 'ENOENT') throw e;
        }
      }
      throw new Error(`Missing wireframe style reference: ${filename}`);
    })
  );
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
    const image = formData.get('image');
    if (!(image instanceof File) || image.size === 0) {
      return NextResponse.json({ error: 'image is required' }, { status: 400 });
    }

    const mime = allowedMime(image.type);
    if (!mime) {
      return NextResponse.json({ error: `image must be PNG, JPEG, or WEBP (got ${image.type || 'unknown'}).` }, { status: 400 });
    }

    record(userId, now);
    const imageBuffer = Buffer.from(await image.arrayBuffer());
    const b64 = imageBuffer.toString('base64');
    const imagePart: ImageContent = {
      type: 'image_url',
      image_url: { url: `data:${mime};base64,${b64}`, detail: 'high' },
    };
    const imageInput: ImageEditInput = {
      filename: image.name || 'layout-guide.png',
      contentType: mime,
      data: imageBuffer,
    };

    const raw = await openAiChatJson(
      [
        {
          role: 'system',
          content: 'Return JSON only with this exact shape: {"description":"<one concise paragraph>"}.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: LAYOUT_GUIDE_PROMPT },
            imagePart,
          ],
        },
      ],
      {
        actorUserId: ctx.userId !== 'cloud-proxy' ? ctx.userId : undefined,
        route: '/api/handoff/ai/analyze-layout-guide',
        eventType: 'ai.layout_guide_analyze',
        model: process.env.HANDOFF_VISION_MODEL?.trim() || 'gpt-4o',
        maxTokens: 700,
      }
    );

    const description = parseDescription(raw);
    if (!description) {
      return NextResponse.json({ error: 'OpenAI did not return a layout description.' }, { status: 502 });
    }

    const wireframeImage = await openAiImageEdit({
      prompt: buildWireframePrompt(description),
      images: [imageInput, ...(await loadWireframeStyleReferences())],
      model: 'gpt-image-2',
      size: 'auto',
      quality: 'low',
      actorUserId: userId,
      route: '/api/handoff/ai/analyze-layout-guide',
      eventType: 'ai.layout_guide_wireframe',
    });

    return NextResponse.json({ description, wireframeImage });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Layout analysis failed.' }, { status: 500 });
  }
}
