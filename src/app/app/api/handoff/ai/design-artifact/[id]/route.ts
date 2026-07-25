import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDesignArtifactById } from '@/lib/db/queries';
import { getActorGrant } from '@/lib/db/grant-queries';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const artifactId = (id ?? '').trim();
  if (!artifactId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  try {
    const row = await getDesignArtifactById(artifactId);
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const isAdmin = session.user.role === 'admin';
    // Existing owner/admin gate kept as-is; hard view-enforcement by visibility is
    // deferred to the Stage 3 cutover.
    if (row.userId !== session.user.id && !isAdmin) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
    const grant = await getActorGrant('design_artifact', row.id, session.user.id);
    const permissions = computePermissions(
      actor,
      { ownerUserId: row.userId, visibility: toVisibility(row.visibility) },
      grant
    );
    return NextResponse.json({ artifact: row, permissions });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Load failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
