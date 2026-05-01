import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDbPatternsFiltered } from '@/lib/db/queries';
import { patternRowToListEntry } from '@/lib/server/pattern-api-map';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const basePath = process.env.HANDOFF_APP_BASE_PATH ?? '';
  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source') ?? undefined;
  const q = searchParams.get('q') ?? undefined;
  const group = searchParams.get('group') ?? undefined;

  const rows = await getDbPatternsFiltered({ source, q, group });
  const patterns = rows.map((row) => patternRowToListEntry(row, basePath));
  return NextResponse.json({ patterns });
}
