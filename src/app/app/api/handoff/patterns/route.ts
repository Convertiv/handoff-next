import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDbPatternsFiltered } from '@/lib/db/queries';
import { getDataProvider } from '@/lib/data';
import { isDynamic } from '@/lib/mode';
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

  if (!isDynamic()) {
    const provider = getDataProvider();
    const patterns = await provider.getPatterns();
    let list = patterns.map((p) => ({
      ...p,
      _source: 'build',
      _thumbnail: null as string | null,
      _userId: null as string | null,
      _createdAt: null as string | null,
      _updatedAt: null as string | null,
      _componentCount: Array.isArray(p.components) ? p.components.length : 0,
    }));
    if (source === 'playground') {
      list = [];
    }
    if (group) {
      list = list.filter((p) => (p.group || '') === group);
    }
    if (q?.trim()) {
      const t = q.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.title.toLowerCase().includes(t) ||
          (p.description && p.description.toLowerCase().includes(t)) ||
          p.id.toLowerCase().includes(t)
      );
    }
    return NextResponse.json({ patterns: list });
  }

  const rows = await getDbPatternsFiltered({ source, q, group });
  const patterns = rows.map((row) => patternRowToListEntry(row, basePath));
  return NextResponse.json({ patterns });
}
