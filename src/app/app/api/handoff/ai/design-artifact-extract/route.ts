import { NextResponse, type NextRequest } from 'next/server';
import { authOrCloudToken } from '@/lib/sync-auth';
import { extractDesignAssetsFromCompositeImage } from '@/lib/server/design-asset-extractor';

export const dynamic = 'force-dynamic';

type Body = {
  imageUrl?: string;
};

/**
 * Synchronous design asset extraction (OpenAI image edits). Used by the cloud when
 * HANDOFF_AI_API_KEY is set, and by local instances via proxy (bearer auth).
 */
export async function POST(request: NextRequest) {
  const ctx = await authOrCloudToken(request);
  if (ctx instanceof NextResponse) return ctx;

  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    return NextResponse.json({ error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const imageUrl = String(body.imageUrl ?? '').trim();
  if (!imageUrl) {
    return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
  }

  const result = await extractDesignAssetsFromCompositeImage({
    imageUrl,
    actorUserId: ctx.userId === 'cloud-proxy' ? null : ctx.userId,
  });

  return NextResponse.json({
    assets: result.assets,
    assetsStatus: result.assetsStatus,
    extractionError: result.extractionError,
  });
}
