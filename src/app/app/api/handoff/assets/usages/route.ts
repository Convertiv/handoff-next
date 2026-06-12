import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getAssetUsages, getComponentAssetUsages, upsertAssetUsage } from '@/lib/db/queries';
import type { AssetUsageType } from '@/lib/asset-types';

const USAGE_TYPES = new Set<AssetUsageType>(['thumbnail', 'design_preview', 'prop_default', 'documentation', 'icon']);

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const p = request.nextUrl.searchParams;
  const assetId = p.get('assetId');
  const componentId = p.get('componentId');

  if (!assetId && !componentId) {
    return NextResponse.json({ error: 'assetId or componentId is required' }, { status: 400 });
  }

  const usages = assetId
    ? await getAssetUsages(assetId)
    : await getComponentAssetUsages(componentId!);

  return NextResponse.json(usages);
}

type PostBody = {
  assetId?: string;
  componentId?: string;
  usageType?: string;
  propKey?: string;
  figmaContainerWidth?: number;
  figmaContainerHeight?: number;
  recommendedWidth?: number;
  recommendedHeight?: number;
  notes?: string;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PostBody;
  const assetId = String(body.assetId ?? '').trim();
  const componentId = String(body.componentId ?? '').trim();
  const usageType = String(body.usageType ?? '').trim() as AssetUsageType;

  if (!assetId) return NextResponse.json({ error: 'assetId is required' }, { status: 400 });
  if (!componentId) return NextResponse.json({ error: 'componentId is required' }, { status: 400 });
  if (!USAGE_TYPES.has(usageType)) return NextResponse.json({ error: 'invalid usageType' }, { status: 400 });

  const usage = await upsertAssetUsage({
    assetId,
    componentId,
    usageType,
    propKey: body.propKey ?? null,
    figmaContainerWidth: body.figmaContainerWidth ?? null,
    figmaContainerHeight: body.figmaContainerHeight ?? null,
    recommendedWidth: body.recommendedWidth ?? null,
    recommendedHeight: body.recommendedHeight ?? null,
    notes: body.notes ?? null,
  });

  return NextResponse.json(usage, { status: 201 });
}
