import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getDbPatternById } from '@/lib/db/queries';
import { editHistory, handoffPatterns } from '@/lib/db/schema';
import { insertSyncEvent } from '@/lib/db/sync-queries';
import { isDynamic } from '@/lib/mode';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

function sessionUserIdForSync(user: { id?: string | null } | undefined): string | null {
  const id = user?.id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export async function POST(_request: Request, context: RouteContext) {
  if (!isDynamic()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const row = await getDbPatternById(id);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const newId = `${id}-copy-${Date.now()}`;
  const title = `Copy of ${row.title || id}`;

  const db = getDb()!;
  await db.insert(handoffPatterns).values({
    id: newId,
    path: row.path,
    title,
    description: row.description ?? '',
    group: row.group ?? '',
    tags: row.tags,
    components: row.components,
    data: row.data,
    userId: session.user.id ?? null,
    source: 'playground',
    thumbnail: row.thumbnail,
  });

  await db.insert(editHistory).values({
    entityType: 'pattern',
    entityId: newId,
    userId: session.user.id ?? session.user.email ?? null,
    diff: { action: 'clone', fromId: id },
  });

  await insertSyncEvent({
    entityType: 'pattern',
    entityId: newId,
    action: 'create',
    payload: { id: newId, title, clonedFrom: id },
    userId: sessionUserIdForSync(session.user),
  });

  const [created] = await db.select().from(handoffPatterns).where(eq(handoffPatterns.id, newId));
  return NextResponse.json({ id: newId, pattern: created });
}
