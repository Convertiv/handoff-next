import { NextResponse } from 'next/server';
import type { SyncEntityType, SyncUploadBody } from '@handoff/types/handoff-sync';

export async function POST(request: Request) {
  const { applyUploadedChange } = await import('@/lib/db/sync-queries');
  const { verifySyncAuth } = await import('@/lib/sync-auth');

  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

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
  let hadComponentChanges = false;

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
        userId: authz.userId,
      });
      applied.push(`${ch.entityType}:${ch.entityId}:${ch.action}`);
      if (ch.entityType === 'component') hadComponentChanges = true;
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Upload failed';
    return NextResponse.json({ error: message, applied }, { status: 500 });
  }

  // After a component push, recompute the health snapshot across ALL components
  // and append a row to handoff_validation_run for trend tracking.
  // We do this async (fire-and-forget style, caught) so a snapshot failure
  // never causes the push response to fail.
  if (hadComponentChanges) {
    recordValidationSnapshot().catch(() => {});
  }

  return NextResponse.json({ ok: true, appliedCount: applied.length, applied });
}

async function recordValidationSnapshot(): Promise<void> {
  try {
    const { getDataProvider } = await import('@/lib/data/provider');
    const { computeHealthSummary, summaryToRunRecord } = await import('@/lib/health-types');
    const { insertValidationRun } = await import('@/lib/db/validation-queries');

    const provider = await getDataProvider();
    const components = await provider.getComponents();

    // Only record a snapshot if at least one component has validation results
    const hasResults = components.some((c) => (c as any).validationResults?.length > 0);
    if (!hasResults) return;

    const summary = computeHealthSummary(
      components.map((c) => ({
        id: c.id,
        title: c.title,
        group: (c as any).group ?? '',
        image: (c as any).image,
        path: (c as any).path ?? `/system/component/${c.id}`,
        validationResults: (c as any).validationResults,
      })),
      null // manifest not needed for snapshot recording
    );

    await insertValidationRun(summaryToRunRecord(summary, 'push'));
  } catch {
    // Never surface snapshot errors to the caller
  }
}
