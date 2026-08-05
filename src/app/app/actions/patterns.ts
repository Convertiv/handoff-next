'use server';

import { auth } from '../../lib/auth';
import {
  applyPatternMeta,
  patchPattern,
  removePattern,
  reviewPattern,
  writePattern,
  type PatternWriteActor,
} from '../../lib/db/pattern-write';
import { getActorGrant } from '../../lib/db/grant-queries';

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

/**
 * Phase B: set a pattern's sharing visibility and/or lifecycle status.
 *
 * The gate itself lives in the write core (`applyPatternMeta` → `decidePatternMetaChange`) rather than
 * here, so the MCP and HTTP surfaces enforce the same rules instead of each re-deriving them — that
 * duplication is exactly what blocked an MCP status setter. This stays a thin session wrapper: resolve
 * the actor and their grant, then delegate.
 */
export async function setPatternMeta(id: string, meta: { visibility?: string; status?: string }) {
  const actor = await requireActor();
  const grant = await getActorGrant('pattern', id, actor.userId);
  await applyPatternMeta(id, meta, actor, grant);
  return { success: true };
}

/** Record a reviewer's verdict on a submitted page. Maintainer-gated inside the write core. */
export async function reviewPatternSubmission(
  id: string,
  decision: 'approve' | 'reject',
  message?: string | null
) {
  const actor = await requireActor();
  const grant = await getActorGrant('pattern', id, actor.userId);
  const result = await reviewPattern(id, decision, actor, { message, grant });
  return { success: true, status: result.status };
}
