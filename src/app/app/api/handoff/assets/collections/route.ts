import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { insertAssetCollection, listAssetCollections } from '@/lib/db/queries';
import type { CollectionSourceType } from '@/lib/asset-types';
import { randomUUID } from 'crypto';

export async function GET(_request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const collections = await listAssetCollections();
  return NextResponse.json(collections);
}

type PostBody = {
  name?: string;
  slug?: string;
  description?: string;
  sourceType?: string;
  figmaSectionId?: string;
  figmaFileKey?: string;
  metadata?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as PostBody;
  const name = String(body.name ?? '').trim();
  const slug = String(body.slug ?? '').trim();

  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (!slug) return NextResponse.json({ error: 'slug is required' }, { status: 400 });

  const SOURCE_TYPES = new Set<CollectionSourceType>(['figma', 'manual']);
  const sourceType = (SOURCE_TYPES.has(body.sourceType as CollectionSourceType) ? body.sourceType : 'manual') as CollectionSourceType;

  const collection = await insertAssetCollection({
    id: randomUUID(),
    name,
    slug,
    description: body.description ?? null,
    sourceType,
    figmaSectionId: body.figmaSectionId ?? null,
    figmaFileKey: body.figmaFileKey ?? null,
    metadata: body.metadata ?? {},
  });

  return NextResponse.json(collection, { status: 201 });
}
