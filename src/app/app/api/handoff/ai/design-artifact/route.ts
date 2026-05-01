import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getDesignArtifactById,
  getDesignArtifacts,
  insertDesignArtifact,
  updateDesignArtifact,
  updateDesignArtifactById,
} from '@/lib/db/queries';
import {
  sanitizeConversationHistoryForStorage,
  sanitizeDesignAssetsForStorage,
  sanitizeSourceImagesForStorage,
} from '@/lib/server/design-artifact-persist';
import { scheduleDesignAssetExtraction } from '@/lib/server/design-asset-schedule';
import { isServerAiConfigured, shouldProxyAi } from '@/lib/server/ai-client';

const ALLOWED_STATUS = new Set(['draft', 'review', 'approved']);

type PostBody = {
  id?: string;
  title?: string;
  description?: string;
  status?: string;
  imageUrl?: string;
  sourceImages?: unknown;
  componentGuides?: unknown;
  foundationContext?: unknown;
  conversationHistory?: unknown;
  metadata?: unknown;
  assets?: unknown;
  assetsStatus?: string;
  publicAccess?: boolean;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PostBody;
  const title = String(body.title ?? '').trim();
  const description = String(body.description ?? '').trim();
  const imageUrl = String(body.imageUrl ?? '').trim();
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (!imageUrl) {
    return NextResponse.json({ error: 'imageUrl is required' }, { status: 400 });
  }

  const status = body.status?.trim() ?? 'review';
  if (!ALLOWED_STATUS.has(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  const userId = session.user.id;

  const sourceImages = sanitizeSourceImagesForStorage(body.sourceImages);
  const conversationHistory = sanitizeConversationHistoryForStorage(body.conversationHistory);

  try {
    if (body.id?.trim()) {
      const id = body.id.trim();
      const patch: Parameters<typeof updateDesignArtifact>[2] = {
        title,
        description,
        status,
        imageUrl,
        sourceImages,
        componentGuides: body.componentGuides,
        foundationContext: body.foundationContext,
        conversationHistory,
        metadata: body.metadata,
      };
      if (body.assets !== undefined) {
        patch.assets = sanitizeDesignAssetsForStorage(body.assets) as typeof patch.assets;
      }
      if (body.assetsStatus !== undefined) patch.assetsStatus = body.assetsStatus;
      if (body.publicAccess !== undefined) patch.publicAccess = Boolean(body.publicAccess);
      const ok = await updateDesignArtifact(id, userId, patch);
      if (!ok) {
        return NextResponse.json({ error: 'Not found or not owned by you' }, { status: 404 });
      }
      return NextResponse.json({ id, updated: true });
    }

    const canExtractLocally = Boolean(process.env.HANDOFF_AI_API_KEY?.trim());
    const id = await insertDesignArtifact({
      title,
      description,
      status,
      userId,
      imageUrl,
      sourceImages,
      componentGuides: body.componentGuides,
      foundationContext: body.foundationContext,
      conversationHistory,
      metadata: body.metadata,
      assets: [],
      assetsStatus: canExtractLocally ? 'pending' : 'none',
      publicAccess: false,
    });
    if (!id) {
      return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
    }
    if (canExtractLocally) {
      scheduleDesignAssetExtraction(id);
    }
    return NextResponse.json({ id, created: true });
  } catch (e) {
    console.error('[design-artifact] insert/update failed', e);
    const msg = e instanceof Error ? e.message : 'Save failed';
    const cause = e && typeof e === 'object' && 'cause' in e ? (e as { cause?: { message?: string; detail?: string; code?: string } }).cause : undefined;
    const missingTable =
      cause?.code === '42P01' || msg.includes('handoff_design_artifact') || cause?.message?.includes('handoff_design_artifact');
    const hint = missingTable
      ? ' Run `npm run db:migrate` (migrations 0010_design_artifact_if_missing / 0011_design_artifact_assets_and_sharing).'
      : msg.includes('value too long') || msg.includes('22001')
        ? ' Payload too long for a column; try saving with fewer bench images or a shorter iteration history.'
        : '';
    return NextResponse.json({ error: `${msg}${cause?.detail ? ` (${cause.detail})` : ''}${hint}` }, { status: 500 });
  }
}

type PatchBody = {
  id?: string;
  publicAccess?: boolean;
  extractAssets?: boolean;
};

export async function PATCH(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const id = String(body.id ?? '').trim();
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const userId = session.user.id;
  const row = await getDesignArtifactById(id);
  const isAdmin = session.user.role === 'admin';
  if (!row || (row.userId !== userId && !isAdmin)) {
    return NextResponse.json({ error: 'Not found or not owned by you' }, { status: 404 });
  }

  try {
    if (body.extractAssets === true) {
      if (!isServerAiConfigured()) {
        return NextResponse.json(
          { error: 'Server AI is not configured (HANDOFF_AI_API_KEY or HANDOFF_CLOUD_URL + HANDOFF_CLOUD_TOKEN).' },
          { status: 503 }
        );
      }

      if (shouldProxyAi()) {
        const base = process.env.HANDOFF_CLOUD_URL?.trim().replace(/\/$/, '');
        const token = process.env.HANDOFF_CLOUD_TOKEN?.trim();
        if (!base || !token) {
          return NextResponse.json({ error: 'Cloud AI proxy is not configured.' }, { status: 503 });
        }
        const extractUrl = `${base}/api/handoff/ai/design-artifact-extract`;
        let upstream: Response;
        try {
          upstream = await fetch(extractUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ imageUrl: row.imageUrl }),
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Fetch failed';
          return NextResponse.json({ error: `Cloud extract unreachable: ${msg}` }, { status: 502 });
        }
        const remote = (await upstream.json().catch(() => ({}))) as {
          assets?: unknown;
          assetsStatus?: string;
          extractionError?: string | null;
          error?: string;
        };
        if (!upstream.ok) {
          return NextResponse.json(
            { error: remote.error || `Cloud extract failed (${upstream.status})` },
            { status: upstream.status >= 400 ? upstream.status : 502 }
          );
        }
        const assets = Array.isArray(remote.assets) ? sanitizeDesignAssetsForStorage(remote.assets) : [];
        const assetsStatus = remote.assetsStatus === 'done' || remote.assetsStatus === 'failed' ? remote.assetsStatus : 'failed';
        const prevMeta =
          row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
            ? { ...(row.metadata as Record<string, unknown>) }
            : {};
        if (remote.extractionError) prevMeta.assetsExtractionError = remote.extractionError;
        else delete prevMeta.assetsExtractionError;

        const ok = await updateDesignArtifactById(id, {
          assets: assets as typeof row.assets,
          assetsStatus,
          metadata: prevMeta,
        });
        if (!ok) {
          return NextResponse.json({ error: 'Not found or not owned by you' }, { status: 404 });
        }
        return NextResponse.json({
          id,
          extractionQueued: false,
          extractionImmediate: true,
          assets,
          assetsStatus,
        });
      }

      if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
        return NextResponse.json({ error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' }, { status: 503 });
      }
      const ok = await updateDesignArtifactById(id, {
        assets: [],
        assetsStatus: 'pending',
      });
      if (!ok) {
        return NextResponse.json({ error: 'Not found or not owned by you' }, { status: 404 });
      }
      scheduleDesignAssetExtraction(id);
      return NextResponse.json({ id, extractionQueued: true });
    }

    if (body.publicAccess !== undefined) {
      const ok = await updateDesignArtifactById(id, {
        publicAccess: Boolean(body.publicAccess),
      });
      if (!ok) {
        return NextResponse.json({ error: 'Not found or not owned by you' }, { status: 404 });
      }
      return NextResponse.json({ id, publicAccess: Boolean(body.publicAccess) });
    }

    return NextResponse.json({ error: 'No supported patch fields (use publicAccess or extractAssets).' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Patch failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const status = request.nextUrl.searchParams.get('status')?.trim() || undefined;
  const userIdParam = request.nextUrl.searchParams.get('userId')?.trim() || undefined;
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '50');
  const isAdmin = session.user.role === 'admin';

  try {
    const rows = isAdmin
      ? await getDesignArtifacts({
          status,
          userId: userIdParam,
          limit: Number.isFinite(limit) ? limit : 50,
        })
      : await getDesignArtifacts({
          status,
          userId: session.user.id,
          limit: Number.isFinite(limit) ? limit : 50,
        });
    return NextResponse.json({ artifacts: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'List failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
