import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { deleteAssetUsage } from '@/lib/db/queries';

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, ctx: Ctx) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId < 1) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  await deleteAssetUsage(numericId);
  return new NextResponse(null, { status: 204 });
}
