import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SyncBody = {
  action?: 'create_component' | 'sync_metadata';
  componentId?: string;
  figmaComponentKey?: string;
  figmaSlug?: string;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = (await request.json()) as SyncBody;
    if (body.action === 'create_component') {
      const componentId = String(body.componentId ?? body.figmaSlug ?? '').trim();
      if (!componentId) {
        return NextResponse.json({ error: 'Missing componentId' }, { status: 400 });
      }
      const { scaffoldFigmaComponent } = await import('@/lib/server/figma-sync-service');
      const response = await scaffoldFigmaComponent(componentId, session.user.id, body.figmaComponentKey, body.figmaSlug);
      return NextResponse.json(response);
    }

    if (body.action === 'sync_metadata') {
      const componentId = String(body.componentId ?? '').trim();
      if (!componentId) {
        return NextResponse.json({ error: 'Missing componentId' }, { status: 400 });
      }
      const { syncFigmaMetadataIntoComponent } = await import('@/lib/server/figma-sync-service');
      const response = await syncFigmaMetadataIntoComponent(componentId, session.user.id, body.figmaComponentKey);
      return NextResponse.json(response);
    }

    return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
