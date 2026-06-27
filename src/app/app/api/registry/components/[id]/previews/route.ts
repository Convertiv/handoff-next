import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  createComponentPreview,
  listComponentPreviews,
  PreviewValidationFailed,
} from '@/lib/db/component-preview-queries';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** GET /api/registry/components/:id/previews — list registry-authored previews. */
export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;
  const previews = await listComponentPreviews(id);
  return NextResponse.json({ previews });
}

/** POST /api/registry/components/:id/previews — create a registry-authored preview. */
export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { id } = await context.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const title = typeof body.title === 'string' ? body.title : '';
  if (!title.trim()) return NextResponse.json({ error: 'title is required' }, { status: 400 });
  const values =
    body.values && typeof body.values === 'object' && !Array.isArray(body.values)
      ? (body.values as Record<string, unknown>)
      : {};

  try {
    const preview = await createComponentPreview({
      componentId: id,
      title,
      values,
      previewKey: typeof body.previewKey === 'string' ? body.previewKey : undefined,
      semantic: typeof body.semantic === 'string' ? body.semantic : null,
      rationale: typeof body.rationale === 'string' ? body.rationale : null,
      source: body.source === 'llm' ? 'llm' : 'manual',
      authorId: (session.user as { id?: string }).id ?? null,
    });
    return NextResponse.json({ preview }, { status: 201 });
  } catch (e) {
    if (e instanceof PreviewValidationFailed) {
      return NextResponse.json({ error: 'validation_failed', errors: e.errors }, { status: 422 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to create preview' }, { status: 400 });
  }
}
