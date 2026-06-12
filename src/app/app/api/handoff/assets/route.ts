import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { insertAsset, listAssets } from '@/lib/db/queries';
import type { AssetSourceType, AssetType } from '@/lib/asset-types';
import { randomUUID } from 'crypto';

const ASSET_TYPES = new Set<AssetType>(['logo', 'icon', 'image', 'video']);
const SOURCE_TYPES = new Set<AssetSourceType>(['figma', 'upload', 'url', 'wordpress', 'cloudinary']);

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const p = request.nextUrl.searchParams;
  const filter = {
    assetType: p.get('assetType') as AssetType | undefined ?? undefined,
    collectionId: p.get('collectionId') ?? undefined,
    iconSetId: p.get('iconSetId') ?? undefined,
    status: (p.get('status') as 'pending' | 'active' | undefined) ?? undefined,
    search: p.get('search') ?? undefined,
    tags: p.get('tags') ? p.get('tags')!.split(',') : undefined,
    limit: p.get('limit') ? Number(p.get('limit')) : undefined,
    offset: p.get('offset') ? Number(p.get('offset')) : undefined,
  };

  const assets = await listAssets(filter);
  return NextResponse.json(assets);
}

type PostBody = {
  title?: string;
  description?: string;
  altText?: string;
  assetType?: string;
  mimeType?: string;
  storageUrl?: string;
  collectionId?: string;
  tags?: string[];
  sourceType?: string;
  sourceUrl?: string;
  sourceMetadata?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PostBody;
  const title = String(body.title ?? '').trim();
  const storageUrl = String(body.storageUrl ?? '').trim();
  const assetType = String(body.assetType ?? '').trim() as AssetType;

  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
  if (!storageUrl) return NextResponse.json({ error: 'storageUrl is required' }, { status: 400 });
  if (!ASSET_TYPES.has(assetType)) return NextResponse.json({ error: 'invalid assetType' }, { status: 400 });

  const sourceType = (SOURCE_TYPES.has(body.sourceType as AssetSourceType) ? body.sourceType : 'url') as AssetSourceType;

  const asset = await insertAsset({
    id: randomUUID(),
    title,
    description: body.description ?? null,
    altText: body.altText ?? null,
    assetType,
    mimeType: body.mimeType ?? null,
    fileSizeBytes: null,
    nativeWidth: null,
    nativeHeight: null,
    storageUrl,
    storageKey: null,
    thumbnailUrl: null,
    svgContent: null,
    iconSetId: null,
    iconVariant: null,
    collectionId: body.collectionId ?? null,
    sourceType,
    sourceUrl: body.sourceUrl ?? null,
    sourceMetadata: body.sourceMetadata ?? {},
    tags: body.tags ?? [],
    status: 'active',
    createdBy: session.user.id,
  });

  return NextResponse.json(asset, { status: 201 });
}
