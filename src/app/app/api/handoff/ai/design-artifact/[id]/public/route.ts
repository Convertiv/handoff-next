import { NextResponse, type NextRequest } from 'next/server';
import { getDesignArtifactById } from '@/lib/db/queries';

type RouteContext = { params: Promise<{ id: string }> };

/** Public read of a design artifact when `public_access` is enabled. No auth. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const artifactId = (id ?? '').trim();
  if (!artifactId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  try {
    const row = await getDesignArtifactById(artifactId);
    if (!row || !row.publicAccess) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json({
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Load failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
