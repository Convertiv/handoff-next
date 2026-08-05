import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';
import { getResourceOwner, listShareLinks, type ResourceType } from '@/lib/db/grant-queries';

const RESOURCE_TYPES = new Set<ResourceType>(['pattern', 'design_artifact']);

/**
 * Every active share link for a resource, with usage.
 *
 * Gated on `canChangeVisibility` — the same right that mints and revokes a link, so seeing who a resource
 * has been shared with requires being able to change that. Returns `ShareLinkSummary`, which cannot carry a
 * secret by construction; the full URL is shown exactly once, at creation.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const p = request.nextUrl.searchParams;
  const resourceType = String(p.get('resourceType') ?? '').trim() as ResourceType;
  const resourceId = String(p.get('resourceId') ?? '').trim();
  if (!RESOURCE_TYPES.has(resourceType) || !resourceId) {
    return NextResponse.json(
      { error: 'resourceType (pattern|design_artifact) and resourceId are required' },
      { status: 400 }
    );
  }

  const owner = await getResourceOwner(resourceType, resourceId);
  if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  const perms = computePermissions(
    actor,
    { ownerUserId: owner.ownerUserId, visibility: toVisibility(owner.visibility) },
    null
  );
  if (!perms.canChangeVisibility) {
    return NextResponse.json({ error: 'You do not have permission to view links for this resource.' }, { status: 403 });
  }

  try {
    return NextResponse.json({ links: await listShareLinks(resourceType, resourceId) });
  } catch (e) {
    console.error('[share/links]', e);
    return NextResponse.json({ error: 'Could not load share links.' }, { status: 500 });
  }
}
