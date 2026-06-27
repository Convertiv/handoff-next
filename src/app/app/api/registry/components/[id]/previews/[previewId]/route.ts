import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  deleteComponentPreview,
  updateComponentPreview,
  PreviewValidationFailed,
} from '@/lib/db/component-preview-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; previewId: string }> };

/** PATCH /api/registry/components/:id/previews/:previewId — edit a registry preview. */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { previewId } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const patch: Parameters<typeof updateComponentPreview>[1] = {};
  if (typeof body.title === 'string') patch.title = body.title;
  if (body.values && typeof body.values === 'object' && !Array.isArray(body.values)) {
    patch.values = body.values as Record<string, unknown>;
  }
  if ('semantic' in body) patch.semantic = typeof body.semantic === 'string' ? body.semantic : null;
  if ('rationale' in body) patch.rationale = typeof body.rationale === 'string' ? body.rationale : null;

  try {
    const preview = await updateComponentPreview(previewId, patch);
    if (!preview) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ preview });
  } catch (e) {
    if (e instanceof PreviewValidationFailed) {
      return NextResponse.json({ error: 'validation_failed', errors: e.errors }, { status: 422 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to update preview' }, { status: 400 });
  }
}

/** DELETE /api/registry/components/:id/previews/:previewId — remove a registry preview. */
export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { previewId } = await context.params;
  const ok = await deleteComponentPreview(previewId);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 });
}
