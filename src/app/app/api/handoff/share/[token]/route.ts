import { NextResponse, type NextRequest } from 'next/server';
import { resolveShareLink } from '@/lib/db/grant-queries';
import { getDbPatternById, getDesignArtifactById } from '@/lib/db/queries';

type RouteContext = { params: Promise<{ token: string }> };

/**
 * PUBLIC read of a resource via an unguessable share token (Phase B). No auth.
 * Valid only when the link is not revoked and not expired. Returns a SAFE subset
 * of the resource (mirrors the artifact public route's safe-field philosophy).
 * Supports both patterns and design artifacts via the link's `resource_type`.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { token } = await context.params;
  const link = await resolveShareLink((token ?? '').trim());
  if (!link) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    if (link.resourceType === 'design_artifact') {
      const row = await getDesignArtifactById(link.resourceId);
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({
        resourceType: 'design_artifact',
        artifact: {
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          imageUrl: row.imageUrl,
          assets: row.assets,
          assetsStatus: row.assetsStatus,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      });
    }

    if (link.resourceType === 'pattern') {
      const row = await getDbPatternById(link.resourceId);
      if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({
        resourceType: 'pattern',
        pattern: {
          id: row.id,
          title: row.title,
          description: row.description,
          group: row.group,
          tags: row.tags,
          components: row.components,
          data: row.data,
          thumbnail: row.thumbnail,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
      });
    }

    return NextResponse.json({ error: 'Unsupported resource type' }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Load failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
