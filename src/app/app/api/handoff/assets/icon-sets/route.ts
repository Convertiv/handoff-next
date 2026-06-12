import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { insertIconSet, listIconSets } from '@/lib/db/queries';
import { randomUUID } from 'crypto';

export async function GET(_request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sets = await listIconSets();
  return NextResponse.json(sets);
}

type PostBody = {
  name?: string;
  slug?: string;
  description?: string;
  figmaComponentSetId?: string;
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

  const set = await insertIconSet({
    id: randomUUID(),
    name,
    slug,
    description: body.description ?? null,
    figmaComponentSetId: body.figmaComponentSetId ?? null,
    figmaFileKey: body.figmaFileKey ?? null,
  });

  return NextResponse.json(set, { status: 201 });
}
