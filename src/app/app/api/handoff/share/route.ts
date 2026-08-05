import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import {
  createShareLink,
  getActiveShareLink,
  getResourceOwner,
  revokeShareLink,
  shareLinkCapabilities,
  type ResourceType,
} from '@/lib/db/grant-queries';
import {
  computePermissions,
  isAuthorizationError,
  toShareCapabilities,
  toVisibility,
  type MutateActor,
} from '@/lib/authz/policy';

const RESOURCE_TYPES = new Set<ResourceType>(['pattern', 'design_artifact']);

type CreateBody = {
  resourceType?: string;
  resourceId?: string;
  expiresAt?: string | null;
  /** `ShareCapability[]`. Omitted = read-only viewer link, this endpoint's original behavior. */
  capabilities?: unknown;
  label?: unknown;
  maxUses?: unknown;
};

/**
 * Fetch the most-recent ACTIVE share link for a resource, or null. Requires
 * `canChangeVisibility` on the resource (owner/admin) — it returns a capability
 * token, so only those who could mint one may read it.
 */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const resourceType = String(request.nextUrl.searchParams.get('resourceType') ?? '').trim() as ResourceType;
  const resourceId = String(request.nextUrl.searchParams.get('resourceId') ?? '').trim();
  if (!RESOURCE_TYPES.has(resourceType) || !resourceId) {
    return NextResponse.json({ error: 'resourceType (pattern|design_artifact) and resourceId are required' }, { status: 400 });
  }

  const owner = await getResourceOwner(resourceType, resourceId);
  if (!owner) {
    return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
  }

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  const perms = computePermissions(
    actor,
    { ownerUserId: owner.ownerUserId, visibility: toVisibility(owner.visibility) },
    null
  );
  if (!perms.canChangeVisibility) {
    return NextResponse.json({ error: 'You do not have permission to view share links for this resource.' }, { status: 403 });
  }

  try {
    const link = await getActiveShareLink(resourceType, resourceId);
    if (!link) return NextResponse.json({ token: null });

    /**
     * A write-capable link's secret is hashed, so there is no URL to hand back — only the id. Say so
     * explicitly (`secretRecoverable: false`) instead of returning the id as `token`, which would look
     * like a working link and 404 for whoever it was sent to. The UI's move is revoke-and-remint.
     */
    const secretRecoverable = link.tokenHash == null;
    return NextResponse.json({
      token: secretRecoverable ? link.token : null,
      id: link.token,
      secretRecoverable,
      capabilities: shareLinkCapabilities(link),
      label: link.label,
      expiresAt: link.expiresAt,
      useCount: link.useCount,
      maxUses: link.maxUses,
      lastUsedAt: link.lastUsedAt,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Fetch failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

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

  /**
   * Capabilities are opt-in. An omitted list keeps this endpoint's original meaning — a read-only
   * viewer link — so existing callers are unaffected by guest authoring existing.
   */
  const capabilities = Array.isArray(body.capabilities) ? toShareCapabilities(body.capabilities) : undefined;
  if (Array.isArray(body.capabilities) && !capabilities?.length) {
    return NextResponse.json({ error: 'capabilities contained no recognized values' }, { status: 400 });
  }

  const maxUses = body.maxUses == null ? null : Number(body.maxUses);
  if (maxUses != null && (!Number.isInteger(maxUses) || maxUses < 1)) {
    return NextResponse.json({ error: 'maxUses must be a positive integer' }, { status: 400 });
  }

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  try {
    const { link, urlToken } = await createShareLink(resourceType, resourceId, actor, {
      expiresAt,
      capabilities,
      label: typeof body.label === 'string' ? body.label : null,
      maxUses,
    });
    return NextResponse.json({
      // For a write-capable link this is the only time the secret exists outside the URL bar.
      token: urlToken,
      id: link.token,
      resourceType,
      resourceId,
      capabilities: shareLinkCapabilities(link),
      expiresAt: link.expiresAt,
      maxUses: link.maxUses,
    });
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
