import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { deleteDesignArtifactById, getDesignArtifactById, getUserDisplays } from '@/lib/db/queries';
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
    const displays = await getUserDisplays([row.userId]);
    const d = displays.get(row.userId);
    const owner = d ? { id: d.id, name: d.name, image: d.image } : null;
    const isMe = row.userId === session.user.id;
    return NextResponse.json({ artifact: row, permissions, owner, isMe });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Load failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * Hard-delete a design artifact.
 *
 * Gated on `permissions.canDelete`, which the policy already computes and which nothing previously
 * consumed for artifacts — there was no delete path anywhere in the product (no route, no query, no
 * MCP tool), so a workbench library could only ever grow.
 *
 * Denials report 404 rather than 403, matching the GET above, so a non-owner cannot probe which
 * artifact ids exist. Deliberately not exposed over MCP: destructive, and an agent has no business
 * removing someone's work without a human in the loop.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
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

    const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
    const grant = await getActorGrant('design_artifact', row.id, session.user.id);
    const permissions = computePermissions(
      actor,
      { ownerUserId: row.userId, visibility: toVisibility(row.visibility) },
      grant
    );
    if (!permissions.canDelete) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const deleted = await deleteDesignArtifactById(artifactId);
    if (!deleted) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ id: artifactId, deleted: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Delete failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
