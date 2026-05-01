import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDbPatternById } from '@/lib/db/queries';
import { patternRowToDetailResponse } from '@/lib/server/pattern-api-map';

export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await context.params;
  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';

  const row = await getDbPatternById(id);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ pattern: patternRowToDetailResponse(row, basePath) });
}
