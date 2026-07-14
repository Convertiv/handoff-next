'use server';

import { auth } from '../../lib/auth';
import { patchPattern, removePattern, writePattern, type PatternWriteActor } from '../../lib/db/pattern-write';

async function requireActor(): Promise<PatternWriteActor> {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const userId = typeof session.user.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  return { userId, historyLabel: session.user.id ?? session.user.email ?? null };
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
