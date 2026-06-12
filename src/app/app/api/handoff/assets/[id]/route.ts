import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { deleteAsset, getAssetWithUsages, updateAsset } from '@/lib/db/queries';
import { deleteAssetFromS3 } from '@/lib/server/s3-assets';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const asset = await getAssetWithUsages(id);
  if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(asset);
}

type PutBody = {
  title?: string;
  description?: string;
  altText?: string;
  thumbnailUrl?: string;
  collectionId?: string;
  tags?: string[];
  status?: string;
  nativeWidth?: number;
  nativeHeight?: number;
  sourceUrl?: string;
  sourceMetadata?: Record<string, unknown>;
};

export async function PUT(request: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as PutBody;

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.description !== undefined) patch.description = body.description;
  if (body.altText !== undefined) patch.altText = body.altText;
  if (body.thumbnailUrl !== undefined) patch.thumbnailUrl = body.thumbnailUrl;
  if (body.collectionId !== undefined) patch.collectionId = body.collectionId;
  if (body.tags !== undefined) patch.tags = body.tags;
  if (body.status !== undefined && ['pending', 'active'].includes(body.status)) patch.status = body.status;
  if (body.nativeWidth !== undefined) patch.nativeWidth = body.nativeWidth;
  if (body.nativeHeight !== undefined) patch.nativeHeight = body.nativeHeight;
  if (body.sourceUrl !== undefined) patch.sourceUrl = body.sourceUrl;
  if (body.sourceMetadata !== undefined) patch.sourceMetadata = body.sourceMetadata;

  const updated = await updateAsset(id, patch);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const storageKey = await deleteAsset(id);
  if (storageKey === null) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (storageKey) {
    await deleteAssetFromS3(storageKey).catch(() => {});
  }

  return new NextResponse(null, { status: 204 });
}
