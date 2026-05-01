'use server';

import { eq } from 'drizzle-orm';
import { auth } from '../../lib/auth';
import { getDb } from '../../lib/db';
import { insertSyncEvent } from '../../lib/db/sync-queries';
import { editHistory, handoffComponents } from '../../lib/db/schema';
import { isValidComponentId } from '../../lib/component-id';
import { applyHandoffComponentPatch } from '../../lib/server/handoff-component-patch';
import { scaffoldNewComponentPayload, type RendererKind } from '../../lib/server/component-scaffold';
import { scheduleReferenceMaterialsRegenerate } from '../../lib/server/reference-material-schedule';

function sessionUserIdForSync(user: { id?: string | null } | undefined): string | null {
  const id = user?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function requireAdmin(session: { user?: { role?: string | null } } | null) {
  if (!session?.user) throw new Error('Unauthorized');
  if (session.user.role !== 'admin') throw new Error('Forbidden');
}

export async function createComponent(data: {
  id: string;
  title: string;
  description?: string;
  group?: string;
  type?: string;
  renderer?: RendererKind;
  payload?: Record<string, unknown>;
}) {
  const session = await auth();
  requireAdmin(session);
  const db = getDb();

  if (!isValidComponentId(data.id)) {
    throw new Error(
      'Invalid component ID: use 1–128 characters, start with a letter or number, and use only lowercase letters, numbers, and hyphens.'
    );
  }

  const payload =
    data.payload ??
    scaffoldNewComponentPayload({
      id: data.id,
      title: data.title,
      group: data.group ?? '',
      renderer: data.renderer ?? 'handlebars',
      description: data.description,
    });

  const [existing] = await db.select({ id: handoffComponents.id }).from(handoffComponents).where(eq(handoffComponents.id, data.id));
  if (existing) throw new Error(`Component "${data.id}" already exists`);

  await db.insert(handoffComponents).values({
    id: data.id,
    title: data.title,
    description: data.description ?? '',
    group: data.group ?? '',
    type: data.type ?? 'element',
    data: payload as Record<string, unknown>,
    source: 'db',
  });

  await db.insert(editHistory).values({
    entityType: 'component',
    entityId: data.id,
    userId: session.user.id ?? session.user.email ?? null,
    diff: { action: 'create', data },
  });

  await insertSyncEvent({
    entityType: 'component',
    entityId: data.id,
    action: 'create',
    payload: {
      id: data.id,
      title: data.title,
      description: data.description ?? '',
      group: data.group ?? '',
      type: data.type ?? 'element',
      data: payload as Record<string, unknown>,
    },
    userId: sessionUserIdForSync(session.user),
  });

  scheduleReferenceMaterialsRegenerate({ actorUserId: session.user.id ?? undefined, skipLlm: false });

  return { success: true };
}

export async function updateComponent(
  id: string,
  updates: Partial<{ title: string; description: string; group: string; type: string; data: Record<string, unknown> }>
) {
  const session = await auth();
  requireAdmin(session);
  await applyHandoffComponentPatch(session, id, updates);
  scheduleReferenceMaterialsRegenerate({ actorUserId: session.user.id ?? undefined, skipLlm: false });
  return { success: true };
}

export async function deleteComponent(id: string) {
  const session = await auth();
  requireAdmin(session);
  const db = getDb();

  await insertSyncEvent({
    entityType: 'component',
    entityId: id,
    action: 'delete',
    payload: { id },
    userId: sessionUserIdForSync(session.user),
  });

  await db.delete(handoffComponents).where(eq(handoffComponents.id, id));

  await db.insert(editHistory).values({
    entityType: 'component',
    entityId: id,
    userId: session.user.id ?? session.user.email ?? null,
    diff: { action: 'delete' },
  });

  return { success: true };
}
