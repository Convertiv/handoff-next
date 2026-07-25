import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDbPatternById } from '@/lib/db/queries';
import { getActorGrant } from '@/lib/db/grant-queries';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';
import { patternRowToDetailResponse } from '@/lib/server/pattern-api-map';

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

  // Detail stays readable as today; `permissions` is added additively. Hard
  // view-enforcement by visibility is deferred to the Stage 3 cutover.
  const userId = typeof session.user.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  const actor: MutateActor = { userId, role: session.user.role ?? null };
  const grant = await getActorGrant('pattern', id, userId);
  const permissions = computePermissions(
    actor,
    { ownerUserId: row.userId ?? null, visibility: toVisibility(row.visibility) },
    grant
  );

  return NextResponse.json({ pattern: patternRowToDetailResponse(row, basePath), permissions });
}
