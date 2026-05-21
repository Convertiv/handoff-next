import { NextResponse, type NextRequest } from 'next/server';
import { getReferenceMaterialById, listReferenceMaterials } from '@/lib/db/queries';
import { isReferenceMaterialId } from '@/lib/server/reference-material-ids';
import { requirePostgresForMcp, verifyHandoffApiAuth } from '@/lib/mcp-auth';

/**
 * Reference materials for MCP clients and integrations (JWT with reference:read or legacy sync secret).
 * Admin UI continues to use /api/handoff/admin/reference-materials for regenerate.
 */
export async function GET(request: NextRequest) {
  const pgErr = requirePostgresForMcp();
  if (pgErr) return pgErr;

  const auth = verifyHandoffApiAuth(request, { requireScopes: ['reference:read'] });
  if (auth instanceof NextResponse) return auth;

  const id = new URL(request.url).searchParams.get('id')?.trim();
  try {
    if (id) {
      if (!isReferenceMaterialId(id)) {
        return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      }
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
