import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getReferenceMaterialById, listReferenceMaterials } from '@/lib/db/queries';
import { regenerateAllReferenceMaterialsPersisted, regenerateReferenceMaterialPersisted } from '@/lib/server/reference-material-persist';
import { isReferenceMaterialId } from '@/lib/server/reference-material-ids';

/** Admin: list generated reference materials, or `?id=` for full content. */
export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const id = new URL(request.url).searchParams.get('id')?.trim();
  try {
    if (id) {
      const row = await getReferenceMaterialById(id);
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ material: row });
    }
    const rows = await listReferenceMaterials();
    return NextResponse.json({
      materials: rows.map((r) => ({
        id: r.id,
        contentLength: r.content.length,
        generatedAt: r.generatedAt,
        metadata: r.metadata,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to list';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

type PostBody = { id?: string; all?: boolean; skipLlm?: boolean };

/** Admin: regenerate one or all reference materials. */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as PostBody;
  const skipLlm = body.skipLlm === true;
  const actorUserId = session.user.id;

  try {
    if (body.all) {
      await regenerateAllReferenceMaterialsPersisted({ actorUserId, skipLlm });
      return NextResponse.json({ ok: true, scope: 'all' });
    }
    const id = body.id?.trim();
    if (!id || !isReferenceMaterialId(id)) {
      return NextResponse.json({ error: 'Provide { "all": true } or { "id": "catalog" | ... }' }, { status: 400 });
    }
    await regenerateReferenceMaterialPersisted(id, { actorUserId, skipLlm });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Regenerate failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
