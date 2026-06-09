import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { usePostgres } from '@/lib/db/dialect';

export async function GET(request: Request) {
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!usePostgres()) {
    return NextResponse.json({ results: [] });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('id')?.trim() ?? '';
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }
  try {
    const { getDb } = await import('@/lib/db');
    const { handoffComponents } = await import('@/lib/db/schema');
    const db = getDb();
    const [row] = await db
      .select({ data: handoffComponents.data })
      .from(handoffComponents)
      .where(eq(handoffComponents.id, id))
      .limit(1);
    const vr = (row?.data as Record<string, unknown> | null | undefined)?.validationResults;
    return NextResponse.json({ id, results: Array.isArray(vr) ? vr : [] });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Error' },
      { status: 500 }
    );
  }
}
