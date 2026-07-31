import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { isServerAiConfigured } from '@/lib/server/ai-client';
import { insertDesignGenerationJob } from '@/lib/db/queries';
import { getDesignWorkspace } from '@/lib/server/design-workspace';
import {
  buildImagePrompt,
  parseSize,
  sizeForDimensions,
  validateImageBrief,
  type ImageDimensionRules,
} from '@/lib/image-generation-request';

/**
 * Generate one image for a single block field.
 *
 * The block editor's counterpart to the chat's `request_image` tool: same queue, same worker, same
 * asset library. The difference is that the editor knows exactly which field is being filled, so there
 * is no placeholder to match on the way back — the caller polls
 * `/api/handoff/ai/design-generation-job/[id]` and writes the result straight into that field.
 *
 * Enqueue-only, and fast: the work happens in the cron drain because generation is 25s-4min. See
 * `docs/PLAYGROUND-ASSETS.md`.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isServerAiConfigured()) {
    return NextResponse.json({ error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' }, { status: 503 });
  }

  let body: { brief?: unknown; title?: unknown; altText?: unknown; dimensions?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const validated = validateImageBrief(body.brief);
  if (validated.ok === false) return NextResponse.json({ error: validated.error }, { status: 400 });

  // The block declares what shape its image slot wants, so a 16:9 hero does not get a square photo.
  const dimensions = (body.dimensions ?? null) as ImageDimensionRules | null;
  const size = sizeForDimensions(dimensions);
  const [width, height] = parseSize(size);

  // House style, so a generated photo belongs to the same system as everything around it. Best-effort:
  // a workspace read that fails should not block a generation the user asked for.
  const workspace = await getDesignWorkspace().catch(() => null);

  const title =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 120)
      : validated.brief.slice(0, 60);

  const jobId = await insertDesignGenerationJob({
    artifactId: null,
    userId: session.user.id,
    requestParams: {
      intent: 'asset',
      prompt: buildImagePrompt(validated.brief, workspace?.designMd ?? ''),
      brief: validated.brief,
      title,
      altText: typeof body.altText === 'string' && body.altText.trim() ? body.altText.trim() : title,
      size,
      quality: 'medium',
      tags: ['playground', 'block-editor'],
    },
  });

  return NextResponse.json({ jobId, size, width, height, title });
}
