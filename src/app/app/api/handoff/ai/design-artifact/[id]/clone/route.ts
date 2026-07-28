import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDesignArtifactById, insertDesignArtifact } from '@/lib/db/queries';
import { getActorGrant } from '@/lib/db/grant-queries';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * True clone of a design artifact into an OWNED private copy.
 *
 * Authz: the actor must be able to VIEW the source (owner, admin, team/public
 * visibility, or an explicit grant). The copy resets all sharing/lifecycle state
 * (private / draft / no public access) and carries NO share links or grants.
 */
export async function POST(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const source = await getDesignArtifactById(id);
  if (!source) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const userId = session.user.id;
  const actor: MutateActor = { userId, role: session.user.role ?? null };
  const grant = await getActorGrant('design_artifact', id, userId);
  const perms = computePermissions(
    actor,
    { ownerUserId: source.userId, visibility: toVisibility(source.visibility) },
    grant
  );
  if (!perms.canView) {
    return NextResponse.json({ error: 'Not permitted to view this artifact' }, { status: 403 });
  }

  try {
    const newId = await insertDesignArtifact({
      title: `Copy of ${source.title || id}`,
      description: source.description ?? '',
      userId,
      imageUrl: source.imageUrl ?? '',
      sourceImages: source.sourceImages,
      componentGuides: source.componentGuides,
      foundationContext: source.foundationContext,
      conversationHistory: source.conversationHistory,
      assets: source.assets,
      assetsStatus: source.assetsStatus,
      componentSpec: source.componentSpec,
      componentSpecMd: source.componentSpecMd ?? undefined,
      specStatus: source.specStatus,
      // Reset sharing/lifecycle on the copy.
      status: 'draft',
      visibility: 'private',
      publicAccess: false,
    });
    if (!newId) {
      return NextResponse.json({ error: 'Failed to clone' }, { status: 500 });
    }
    return NextResponse.json({ id: newId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Clone failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
