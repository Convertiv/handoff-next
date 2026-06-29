import { NextResponse } from 'next/server';
import { usePostgres } from '@/lib/db/dialect';
import { isServerAiConfigured } from '@/lib/server/ai-client';

export async function GET(request: Request) {
  if (!usePostgres()) {
    return NextResponse.json({ changes: [], total: 0, aiEnabled: false });
  }
  const aiEnabled = isServerAiConfigured();
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
  const sinceParam = url.searchParams.get('since');
  let since: Date | undefined;
  if (sinceParam) {
    const d = new Date(sinceParam);
    if (!isNaN(d.getTime())) since = d;
  }
  try {
    const { getUnifiedChangelog } = await import('@/lib/db/changelog-queries');
    const changes = await getUnifiedChangelog(limit, since);
    return NextResponse.json({ changes, total: changes.length, aiEnabled });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
