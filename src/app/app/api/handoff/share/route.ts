import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { createShareLink, revokeShareLink, type ResourceType } from '@/lib/db/grant-queries';
import { isAuthorizationError, type MutateActor } from '@/lib/authz/policy';

const RESOURCE_TYPES = new Set<ResourceType>(['pattern', 'design_artifact']);

type CreateBody = {
  resourceType?: string;
  resourceId?: string;
  expiresAt?: string | null;
};

/** Create an unguessable share link. Requires `canChangeVisibility` on the resource. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const resourceType = String(body.resourceType ?? '').trim() as ResourceType;
  const resourceId = String(body.resourceId ?? '').trim();
  if (!RESOURCE_TYPES.has(resourceType) || !resourceId) {
    return NextResponse.json({ error: 'resourceType (pattern|design_artifact) and resourceId are required' }, { status: 400 });
  }

  let expiresAt: Date | null = null;
  if (body.expiresAt) {
    const d = new Date(body.expiresAt);
    if (Number.isNaN(d.getTime())) return NextResponse.json({ error: 'invalid expiresAt' }, { status: 400 });
    expiresAt = d;
  }

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  try {
    const link = await createShareLink(resourceType, resourceId, actor, { expiresAt });
    return NextResponse.json({ token: link.token, resourceType, resourceId, expiresAt: link.expiresAt });
  } catch (e) {
    if (isAuthorizationError(e)) return NextResponse.json({ error: e.message }, { status: 403 });
    const msg = e instanceof Error ? e.message : 'Create failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Revoke a share link by token. Requires `canChangeVisibility` on the resource. */
export async function DELETE(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const token = request.nextUrl.searchParams.get('token')?.trim() || '';
  if (!token) {
    return NextResponse.json({ error: 'token is required' }, { status: 400 });
  }

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  try {
    const revoked = await revokeShareLink(token, actor);
    if (!revoked) return NextResponse.json({ error: 'Not found or already revoked' }, { status: 404 });
    return NextResponse.json({ revoked: true, token });
  } catch (e) {
    if (isAuthorizationError(e)) return NextResponse.json({ error: e.message }, { status: 403 });
    const msg = e instanceof Error ? e.message : 'Revoke failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
