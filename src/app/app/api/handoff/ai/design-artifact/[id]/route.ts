import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { isDynamic } from '@/lib/mode';
import { getDesignArtifactById } from '@/lib/db/queries';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  if (!isDynamic()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
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
    const row = await getDesignArtifactById(artifactId);
    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const isAdmin = session.user.role === 'admin';
    if (row.userId !== session.user.id && !isAdmin) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ artifact: row });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Load failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
