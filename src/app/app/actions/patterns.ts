'use server';

import { auth } from '../../lib/auth';
import { patchPattern, removePattern, setPatternMetaFields, writePattern, type PatternWriteActor } from '../../lib/db/pattern-write';
import { getDbPatternById } from '../../lib/db/queries';
import { getActorGrant } from '../../lib/db/grant-queries';
import { AuthorizationError, computePermissions, toVisibility, type MutateActor } from '../../lib/authz/policy';

async function requireActor(): Promise<PatternWriteActor> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const userId = typeof session.user.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  const role = typeof session.user.role === 'string' ? session.user.role : null;
  return { userId, role, historyLabel: session.user.id ?? session.user.email ?? null, trigger: 'ui' };
}

export async function createPattern(data: {
  id: string;
  title: string;
  description?: string;
  group?: string;
  components?: unknown[];
  payload?: Record<string, unknown>;
  tags?: unknown[];
  source?: string;
  thumbnail?: string | null;
}) {
  const actor = await requireActor();
  await writePattern(
    {
      id: data.id,
      title: data.title,
      description: data.description,
      group: data.group,
      components: data.components,
      data: data.payload,
      tags: data.tags,
      source: data.source,
      thumbnail: data.thumbnail,
    },
    actor
  );
  return { success: true };
}

export async function updatePattern(
  id: string,
  updates: Partial<{
    title: string;
    description: string;
    group: string;
    components: unknown[];
    data: Record<string, unknown>;
    tags: unknown[];
    source: string;
    thumbnail: string | null;
  }>
) {
  const actor = await requireActor();
  await patchPattern(id, updates, actor);
  return { success: true };
}

export async function deletePattern(id: string) {
  const actor = await requireActor();
  await removePattern(id, actor);
  return { success: true };
}

const ALLOWED_PATTERN_STATUS = new Set(['prototype', 'draft', 'review', 'approved', 'archived']);
const ALLOWED_VISIBILITY = new Set(['private', 'shared', 'team', 'public']);

/**
 * Phase B: set a pattern's sharing visibility and/or lifecycle status, gated by
 * `computePermissions`:
 *   - changing `visibility` requires `canChangeVisibility` (owner/admin);
 *   - `status = 'approved'` requires `canApprove` (admin/maintainer);
 *   - any other `status` change requires `canEdit`.
 * Throws `AuthorizationError` on denial.
 */
export async function setPatternMeta(id: string, meta: { visibility?: string; status?: string }) {
  const actor = await requireActor();
  const row = await getDbPatternById(id);
  if (!row) throw new Error('Pattern not found');

  const mutateActor: MutateActor = { userId: actor.userId, role: actor.role ?? null };
  const grant = await getActorGrant('pattern', id, actor.userId);
  const perms = computePermissions(
    mutateActor,
    { ownerUserId: row.userId ?? null, visibility: toVisibility(row.visibility) },
    grant
  );

  const patch: { visibility?: string; status?: string } = {};

  if (meta.visibility !== undefined && meta.visibility !== row.visibility) {
    if (!ALLOWED_VISIBILITY.has(meta.visibility)) throw new Error('Invalid visibility');
    if (!perms.canChangeVisibility) {
      throw new AuthorizationError('You do not have permission to change this pattern\'s visibility.');
    }
    patch.visibility = meta.visibility;
  }

  if (meta.status !== undefined && meta.status !== row.status) {
    if (!ALLOWED_PATTERN_STATUS.has(meta.status)) throw new Error('Invalid status');
    if (meta.status === 'approved') {
      if (!perms.canApprove) throw new AuthorizationError('Only a maintainer can approve a pattern.');
    } else if (!perms.canEdit) {
      throw new AuthorizationError('You do not have permission to modify this pattern.');
    }
    patch.status = meta.status;
  }

  if (patch.visibility !== undefined || patch.status !== undefined) {
    await setPatternMetaFields(id, patch, actor);
  }
  return { success: true };
}
