import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDesignArtifactOwnerId, getDesignArtifactStatus } from '@/lib/db/queries';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const artifactId = (id ?? '').trim();
  if (!artifactId) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  try {
    // Ownership check: mirror the full [id] GET route (session required,
    // owner-or-admin), but only read the light owner projection — no JSONB
    // blobs — so the repeated poll stays cheap.
    const owner = await getDesignArtifactOwnerId(artifactId);
    if (!owner) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const isAdmin = session.user.role === 'admin';
    if (owner.userId !== session.user.id && !isAdmin) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const status = await getDesignArtifactStatus(artifactId);
    if (!status) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // Collapse the two underlying statuses into the single dev-handoff answer the detail page
    // renders, so the poll and the MCP surface can never disagree about what stage it's at.
    const { devHandoffStatusForRow } = await import('@/lib/server/dev-handoff');
    return NextResponse.json({ ...status, devHandoff: devHandoffStatusForRow(status) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Load failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
