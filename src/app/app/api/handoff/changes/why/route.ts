import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { usePostgres } from '@/lib/db/dialect';
import { resolveChangeWhy, type ChangeEntityType } from '@/lib/server/change-why';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID: ChangeEntityType[] = ['component', 'token', 'page'];

/**
 * POST /api/handoff/changes/why  { entityType, id }
 * Resolves the "why" for a change: returns the human-authored push message if
 * present, otherwise lazily generates (and caches) an AI draft from the diff.
 * Session-gated — generation costs a model call.
 */
export async function POST(request: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!usePostgres()) return NextResponse.json({ summary: null, source: 'none', aiEnabled: false });

  let body: { entityType?: unknown; id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const entityType = body.entityType as ChangeEntityType;
  const id = Number(body.id);
  if (!VALID.includes(entityType) || !Number.isInteger(id)) {
    return NextResponse.json({ error: 'Expected { entityType: component|token|page, id: number }' }, { status: 400 });
  }

  const result = await resolveChangeWhy({
    entityType,
    id,
    actorUserId: (session.user as { id?: string }).id ?? null,
  });
  return NextResponse.json(result);
}
