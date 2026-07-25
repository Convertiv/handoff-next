import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getDbPatternsFiltered, getUserDisplays } from '@/lib/db/queries';
import { getActorGrantsForResources, listPatternsByLane, type Lane, type PatternLaneRow } from '@/lib/db/grant-queries';
import { attachPermissions, type MutateActor } from '@/lib/authz/policy';
import { patternRowToListEntry } from '@/lib/server/pattern-api-map';

const LANES = new Set<Lane>(['yours', 'shared', 'team', 'public']);

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
  const laneParam = searchParams.get('lane')?.trim() || undefined;
  const cursor = searchParams.get('cursor')?.trim() || undefined;
  const limitRaw = Number(searchParams.get('limit') ?? '50');
  const userId = typeof session.user.id === 'string' && session.user.id.length > 0 ? session.user.id : null;
  const actor: MutateActor = { userId, role: session.user.role ?? null };

  // Opt-in lane mode: SQL-level visibility filtering + cursor pagination (Stage 2).
  if (laneParam && LANES.has(laneParam as Lane)) {
    const page = await listPatternsByLane({
      lane: laneParam as Lane,
      actorUserId: userId,
      actorRole: session.user.role ?? null,
      cursor,
      limit: Number.isFinite(limitRaw) ? limitRaw : 50,
      source,
      q,
      group,
    });
    const grants = await getActorGrantsForResources('pattern', page.rows.map((r) => r.id), userId);
    const withPerms = attachPermissions(page.rows, actor, grants);
    const displays = await getUserDisplays(
      [...new Set(withPerms.map((r) => r.userId).filter((v): v is string => !!v))]
    );
    const patterns = withPerms.map((row) => {
      const d = row.userId ? displays.get(row.userId) : undefined;
      return {
        ...patternRowToListEntry(row, basePath),
        permissions: row.permissions,
        owner: d ? { id: d.id, name: d.name, image: d.image } : null,
        isMe: userId != null && row.userId === userId,
      };
    });
    return NextResponse.json({ patterns, nextCursor: page.nextCursor });
  }

  // Default (no lane): unchanged query + envelope. `permissions` added additively.
  const rows = (await getDbPatternsFiltered({ source, q, group })) as PatternLaneRow[];
  const grants = await getActorGrantsForResources('pattern', rows.map((r) => r.id), userId);
  const withPerms = attachPermissions(rows, actor, grants);
  const displays = await getUserDisplays(
    [...new Set(withPerms.map((r) => r.userId).filter((v): v is string => !!v))]
  );
  const patterns = withPerms.map((row) => {
    const d = row.userId ? displays.get(row.userId) : undefined;
    return {
      ...patternRowToListEntry(row, basePath),
      permissions: row.permissions,
      owner: d ? { id: d.id, name: d.name, image: d.image } : null,
      isMe: userId != null && row.userId === userId,
    };
  });
  return NextResponse.json({ patterns });
}
