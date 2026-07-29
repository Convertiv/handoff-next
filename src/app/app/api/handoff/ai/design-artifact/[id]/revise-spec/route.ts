import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDesignArtifactById } from '@/lib/db/queries';
import { getActorGrant } from '@/lib/db/grant-queries';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';
import { patchSpecFromRequest } from '@/lib/server/spec-patcher';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Apply a plain-language change to a design's specification.
 *
 * This is the revision half of the spec-driven loop: the tweak edits the spec, the diff shows what
 * moved, and a new version records why. Fast enough to await inside the request — one model call
 * against a few KB of JSON — unlike the generation stages, which have to go through the cron queue.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const artifactId = (id ?? '').trim();
  if (!artifactId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const row = await getDesignArtifactById(artifactId);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  const grant = await getActorGrant('design_artifact', artifactId, session.user.id);
  const perms = computePermissions(actor, { ownerUserId: row.userId, visibility: toVisibility(row.visibility) }, grant);
  // Editing the spec is an edit. 404 on denial, matching the sibling routes so ids can't be probed.
  if (!perms.canEdit) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  let requestText = '';
  try {
    const body = (await request.json()) as { request?: string };
    requestText = typeof body?.request === 'string' ? body.request : '';
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a "request" field.' }, { status: 400 });
  }
  if (!requestText.trim()) return NextResponse.json({ error: 'Describe the change you want.' }, { status: 400 });

  const result = await patchSpecFromRequest({ artifactId, request: requestText, actorUserId: session.user.id });
  // A routed-away request (art-direction / unsure) is a successful answer, not a failure — only a real
  // error gets a non-200, so the UI can show the reasoning instead of an error banner.
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
