import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getDesignArtifactById,
  getDesignArtifactSummariesPage,
  getUserDisplays,
  insertDesignArtifact,
  updateDesignArtifact,
  updateDesignArtifactById,
} from '@/lib/db/queries';
import {
  sanitizeConversationHistoryForStorage,
  sanitizeDesignAssetsForStorage,
  sanitizeSourceImagesForStorage,
} from '@/lib/server/design-artifact-persist';
import { scheduleDesignAssetExtraction, scheduleSpecGeneration } from '@/lib/server/design-asset-schedule';
import { isServerAiConfigured, shouldProxyAi } from '@/lib/server/ai-client';
import {
  getActorGrant,
  getActorGrantsForResources,
  listDesignArtifactsByLane,
  type Lane,
} from '@/lib/db/grant-queries';
import { attachPermissions, computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';

// POST/PATCH schedule asset extraction + spec generation via `after()`, which is bounded by
// this invocation's lifetime. Extraction alone is allowed 240s, so declare the ceiling
// explicitly rather than inheriting a default that could strand the job mid-flight.
export const maxDuration = 300;

const ALLOWED_STATUS = new Set(['draft', 'review', 'approved']);
const ALLOWED_VISIBILITY = new Set(['private', 'shared', 'team', 'public']);
const LANES = new Set<Lane>(['yours', 'shared', 'team', 'public']);

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
      // Queue the specification alongside extraction so the derived dev-handoff status reads as
      // continuously in-flight. Left at 'none' it briefly reports "assets extracted, no spec yet"
      // between the two steps, which a poller sees as the work having stopped.
      specStatus: canExtractLocally ? 'pending' : 'none',
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
      ? ' Run `npm run db:migrate`.'
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
  regenerateSpec?: boolean;
  componentSpecMd?: string;
  /** Optional "why" recorded alongside a spec edit in the version history. */
  changeReason?: string;
  visibility?: string;
  status?: string;
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
      // Route through the shared dev-handoff queueing so this path behaves identically to the
      // MCP tool: both statuses reset, stale errors cleared.
      const { markDevHandoffQueued, getDevHandoffStatus } = await import('@/lib/server/dev-handoff');
      const ok = await markDevHandoffQueued(id, { clearAssets: true });
      if (!ok) {
        return NextResponse.json({ error: 'Not found or not owned by you' }, { status: 404 });
      }
      scheduleDesignAssetExtraction(id);
      return NextResponse.json({ id, extractionQueued: true, devHandoff: await getDevHandoffStatus(id) });
    }

    if (body.regenerateSpec === true) {
      if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
        return NextResponse.json({ error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' }, { status: 503 });
      }
      await updateDesignArtifactById(id, { specStatus: 'pending' });
      scheduleSpecGeneration(id);
      return NextResponse.json({ id, specQueued: true });
    }

    if (body.componentSpecMd !== undefined) {
      const specMd = String(body.componentSpecMd);
      const ok = await updateDesignArtifactById(id, { componentSpecMd: specMd });
      if (!ok) return NextResponse.json({ error: 'Not found or not owned by you' }, { status: 404 });

      // A human edit is a spec change and belongs in the history, with an optional "why".
      //
      // Note the asymmetry: the editor writes MARKDOWN, while the structured `componentSpec` is
      // unchanged by this path. The version therefore records the current structured spec alongside
      // the new markdown, so the diff shows the prose edit without falsely implying the structure
      // moved. Making the markdown editor round-trip back into structure is a separate piece of
      // work — see docs/WORKBENCH-STRATEGY.md.
      const { recordSpecVersion } = await import('@/lib/spec/versioning');
      const current = await getDesignArtifactById(id);
      const version = current?.componentSpec
        ? await recordSpecVersion({
            artifactId: id,
            spec: current.componentSpec as never,
            specMd,
            source: 'edited',
            changeReason: typeof body.changeReason === 'string' ? body.changeReason : null,
            createdByUserId: session.user.id,
          })
        : { version: null, unchanged: false };

      return NextResponse.json({ id, specSaved: true, specVersion: version.version });
    }

    // Phase B: visibility + publicAccess + lifecycle setters, gated by computePermissions.
    // One PATCH body may carry any combination of { visibility, status, publicAccess };
    // all applicable changes are validated, gated, and written in a SINGLE update.
    if (body.visibility !== undefined || body.status !== undefined || body.publicAccess !== undefined) {
      const actor: MutateActor = { userId, role: session.user.role ?? null };
      const grant = await getActorGrant('design_artifact', id, userId);
      const perms = computePermissions(
        actor,
        { ownerUserId: row.userId, visibility: toVisibility(row.visibility) },
        grant
      );
      const patch: { visibility?: string; status?: string; publicAccess?: boolean } = {};

      if (body.visibility !== undefined && body.visibility !== row.visibility) {
        if (!ALLOWED_VISIBILITY.has(body.visibility)) {
          return NextResponse.json({ error: 'invalid visibility' }, { status: 400 });
        }
        if (!perms.canChangeVisibility) {
          return NextResponse.json({ error: 'Not permitted to change visibility' }, { status: 403 });
        }
        patch.visibility = body.visibility;
      }

      if (body.publicAccess !== undefined && Boolean(body.publicAccess) !== row.publicAccess) {
        if (!perms.canChangeVisibility) {
          return NextResponse.json({ error: 'Not permitted to change public access' }, { status: 403 });
        }
        patch.publicAccess = Boolean(body.publicAccess);
      }

      if (body.status !== undefined && body.status !== row.status) {
        if (!ALLOWED_STATUS.has(body.status)) {
          return NextResponse.json({ error: 'invalid status' }, { status: 400 });
        }
        if (body.status === 'approved') {
          if (!perms.canApprove) return NextResponse.json({ error: 'Only a maintainer can approve' }, { status: 403 });
        } else if (!perms.canEdit) {
          return NextResponse.json({ error: 'Not permitted to change status' }, { status: 403 });
        }
        patch.status = body.status;
      }

      if (patch.visibility !== undefined || patch.status !== undefined || patch.publicAccess !== undefined) {
        const ok = await updateDesignArtifactById(id, patch);
        if (!ok) return NextResponse.json({ error: 'Not found or not owned by you' }, { status: 404 });
      }
      return NextResponse.json({
        id,
        visibility: patch.visibility ?? row.visibility,
        status: patch.status ?? row.status,
        publicAccess: patch.publicAccess ?? row.publicAccess,
      });
    }

    return NextResponse.json({ error: 'No supported patch fields (use publicAccess, extractAssets, regenerateSpec, componentSpecMd, visibility, or status).' }, { status: 400 });
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
  const cursor = request.nextUrl.searchParams.get('cursor')?.trim() || undefined;
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? '50');
  const laneParam = request.nextUrl.searchParams.get('lane')?.trim() || undefined;
  const isAdmin = session.user.role === 'admin';
  const userId = session.user.id;
  const actor: MutateActor = { userId, role: session.user.role ?? null };

  try {
    // Opt-in lane mode: SQL-level visibility filtering (Phase B, Stage 2).
    if (laneParam && LANES.has(laneParam as Lane)) {
      const page = await listDesignArtifactsByLane({
        lane: laneParam as Lane,
        actorUserId: userId,
        actorRole: session.user.role ?? null,
        cursor,
        limit: Number.isFinite(limit) ? limit : 50,
        status,
      });
      const grants = await getActorGrantsForResources(
        'design_artifact',
        page.rows.map((r) => r.id),
        userId
      );
      const artifacts = await attachOwners(attachPermissions(page.rows, actor, grants), userId);
      return NextResponse.json({ artifacts, nextCursor: page.nextCursor });
    }

    // Default (no lane): unchanged scoping/behaviour. Admins may scope to any user
    // (or all); everyone else is hard-scoped to their own artifacts. `permissions`
    // is added as a harmless additive field.
    const page = await getDesignArtifactSummariesPage({
      status,
      userId: isAdmin ? userIdParam : userId,
      limit: Number.isFinite(limit) ? limit : 50,
      cursor,
    });
    const grants = await getActorGrantsForResources('design_artifact', page.rows.map((r) => r.id), userId);
    const artifacts = await attachOwners(attachPermissions(page.rows, actor, grants), userId);
    return NextResponse.json({ artifacts, nextCursor: page.nextCursor });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'List failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Additive owner attribution: attach `owner` (display id/name/image) + `isMe` to
 * each list item. One batched `getUserDisplays` call (no N+1). Never mutates or
 * drops existing fields.
 */
async function attachOwners<T extends { userId: string | null }>(
  rows: T[],
  currentUserId: string | null
): Promise<(T & { owner: { id: string; name: string | null; image: string | null } | null; isMe: boolean })[]> {
  const ownerIds = [...new Set(rows.map((r) => r.userId).filter((v): v is string => !!v))];
  const displays = await getUserDisplays(ownerIds);
  return rows.map((row) => {
    const d = row.userId ? displays.get(row.userId) : undefined;
    return {
      ...row,
      owner: d ? { id: d.id, name: d.name, image: d.image } : null,
      isMe: currentUserId != null && row.userId === currentUserId,
    };
  });
}
