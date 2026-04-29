import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDbPatternById } from '@/lib/db/queries';
import { getDataProvider } from '@/lib/data';
import { isDynamic } from '@/lib/mode';
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

  if (!isDynamic()) {
    const provider = getDataProvider();
    const pattern = await provider.getPattern(id);
    if (!pattern) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const list = await provider.getPatterns();
    const meta = list.find((p) => p.id === id);
    return NextResponse.json({
      pattern: {
        id,
        path: meta?.path ?? `${basePath}/api/pattern/${id}.json`,
        title: pattern.title,
        description: pattern.description ?? null,
        group: pattern.group ?? null,
        tags: pattern.tags ?? [],
        components: pattern.components,
        data: { ...pattern, id, path: meta?.path },
        source: 'build',
        thumbnail: null,
        userId: null,
        createdAt: null,
        updatedAt: null,
      },
    });
  }

  const row = await getDbPatternById(id);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ pattern: patternRowToDetailResponse(row, basePath) });
}
