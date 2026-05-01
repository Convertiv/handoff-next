import { NextResponse } from 'next/server';
import type { SyncEntityType, SyncUploadBody } from '@handoff/types/handoff-sync';

export const dynamic = 'force-static';

export async function POST(request: Request) {
  const { applyUploadedChange } = await import('@/lib/db/sync-queries');
  const { verifySyncBearer } = await import('@/lib/sync-auth');

  const unauthorized = verifySyncBearer(request);
  if (unauthorized) return unauthorized;

  let body: SyncUploadBody;
  try {
    body = (await request.json()) as SyncUploadBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body?.changes || !Array.isArray(body.changes)) {
    return NextResponse.json({ error: 'Expected { changes: [...] }' }, { status: 400 });
  }

  const applied: string[] = [];
  try {
    for (const ch of body.changes) {
      if (!ch || typeof ch.entityType !== 'string' || typeof ch.entityId !== 'string' || typeof ch.action !== 'string') {
        return NextResponse.json({ error: 'Invalid change entry' }, { status: 400 });
      }
      await applyUploadedChange({
        entityType: ch.entityType as SyncEntityType,
        entityId: ch.entityId,
        action: ch.action as 'create' | 'update' | 'delete',
        data: (ch.data as Record<string, unknown>) ?? null,
        userId: null,
      });
      applied.push(`${ch.entityType}:${ch.entityId}:${ch.action}`);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    return NextResponse.json({ error: message, applied }, { status: 500 });
  }

  return NextResponse.json({ ok: true, appliedCount: applied.length, applied });
}
