import { NextResponse, type NextRequest } from 'next/server';
import type { PushComponentPropertiesRequest } from 'handoff-figma-plugin/contract';
import { authOrCloudToken } from '@/lib/sync-auth';
import { pushPluginComponentProperties } from '@/lib/server/figma-sync-service';

export async function POST(request: NextRequest) {
  const ctx = await authOrCloudToken(request, { allowServiceBearer: true });
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.userId !== 'cloud-proxy' && ctx.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Partial<PushComponentPropertiesRequest>;
    const payload: PushComponentPropertiesRequest = {
      componentSetId: String(body.componentSetId ?? '').trim(),
      componentSetName: typeof body.componentSetName === 'string' ? body.componentSetName : null,
      handoffComponentId: typeof body.handoffComponentId === 'string' ? body.handoffComponentId : null,
      figmaComponentKey: typeof body.figmaComponentKey === 'string' ? body.figmaComponentKey : null,
      properties: Array.isArray(body.properties) ? body.properties : [],
      images: Array.isArray(body.images) ? body.images : [],
    };

    if (!payload.componentSetId) {
      return NextResponse.json({ error: 'componentSetId is required' }, { status: 400 });
    }

    const response = await pushPluginComponentProperties(payload);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync plugin component properties';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
