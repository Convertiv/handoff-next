import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { insertAsset } from '@/lib/db/queries';
import type { AssetSourceType, AssetType } from '@/lib/asset-types';
import { randomUUID } from 'crypto';

type Body = {
  assetId?: string;
  storageKey?: string;
  publicUrl?: string;
  title?: string;
  description?: string;
  altText?: string;
  assetType?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  nativeWidth?: number;
  nativeHeight?: number;
  collectionId?: string;
  tags?: string[];
  sourceType?: string;
  sourceUrl?: string;
  sourceMetadata?: Record<string, unknown>;
};

const ASSET_TYPES = new Set<AssetType>(['logo', 'icon', 'image', 'video']);
const SOURCE_TYPES = new Set<AssetSourceType>(['figma', 'upload', 'url', 'wordpress', 'cloudinary']);

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const storageKey = String(body.storageKey ?? '').trim();
  const publicUrl = String(body.publicUrl ?? '').trim();
  const title = String(body.title ?? '').trim();
  const assetType = String(body.assetType ?? '').trim() as AssetType;
  const mimeType = String(body.mimeType ?? '').trim();

  if (!storageKey || !publicUrl) {
    return NextResponse.json({ error: 'storageKey and publicUrl are required' }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }
  if (!ASSET_TYPES.has(assetType)) {
    return NextResponse.json({ error: 'invalid assetType' }, { status: 400 });
  }

  const sourceType = (SOURCE_TYPES.has(body.sourceType as AssetSourceType) ? body.sourceType : 'upload') as AssetSourceType;

  const asset = await insertAsset({
    id: body.assetId ?? randomUUID(),
    title,
    description: body.description ?? null,
    altText: body.altText ?? null,
    assetType,
    mimeType: mimeType || null,
    fileSizeBytes: body.fileSizeBytes ?? null,
    nativeWidth: body.nativeWidth ?? null,
    nativeHeight: body.nativeHeight ?? null,
    storageUrl: publicUrl,
    storageKey,
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
