import { NextResponse } from 'next/server';
import { verifySyncAuth } from '@/lib/sync-auth';
import { replaceImageSlotsForComponents, type ImageSlotInput } from '@/lib/db/registry-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/registry/image-slots
 *
 * Upsert image sizing specs for one or more components. The request replaces
 * all existing slots for the supplied componentIds then inserts the new set —
 * so re-pushing is always idempotent (safe to run on every push:all).
 *
 * Body: {
 *   componentIds: string[]          — components whose slots are being replaced
 *   slots: ImageSlotInput[]         — all slots for those components
 * }
 */
export async function POST(request: Request): Promise<Response> {
  const authz = verifySyncAuth(request, { requireWrite: true });
  if (authz instanceof NextResponse) return authz;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const componentIds = Array.isArray(body.componentIds)
    ? (body.componentIds as string[]).filter((s) => typeof s === 'string')
    : [];
  const rawSlots = Array.isArray(body.slots) ? (body.slots as unknown[]) : [];

  if (componentIds.length === 0) {
    return NextResponse.json({ error: 'componentIds must be a non-empty array' }, { status: 400 });
  }

  const slots: ImageSlotInput[] = rawSlots
    .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
    .map((s) => ({
      id: String(s.id ?? ''),
      componentId: String(s.componentId ?? ''),
      slotName: String(s.slotName ?? ''),
      nodeId: typeof s.nodeId === 'string' ? s.nodeId : null,
      variantKey: typeof s.variantKey === 'string' ? s.variantKey : null,
      recommendedWidth: typeof s.recommendedWidth === 'number' ? s.recommendedWidth : null,
      recommendedHeight: typeof s.recommendedHeight === 'number' ? s.recommendedHeight : null,
      aspectRatioW: typeof s.aspectRatioW === 'number' ? s.aspectRatioW : null,
      aspectRatioH: typeof s.aspectRatioH === 'number' ? s.aspectRatioH : null,
      scaleMode: typeof s.scaleMode === 'string' ? s.scaleMode : null,
      isResponsive: Boolean(s.isResponsive),
      minWidth: typeof s.minWidth === 'number' ? s.minWidth : null,
      minHeight: typeof s.minHeight === 'number' ? s.minHeight : null,
    }))
    .filter((s) => s.id && s.componentId && s.slotName);

  try {
    await replaceImageSlotsForComponents(componentIds, slots);
    return NextResponse.json({ ok: true, componentCount: componentIds.length, slotCount: slots.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to upsert image slots' },
      { status: 500 },
    );
  }
}
