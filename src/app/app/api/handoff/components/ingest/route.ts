import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { ingestAllFromConfig, upsertIngestedComponents, type IngestDecision } from '@/lib/server/component-ingest';
import { diffFilesystemVsDatabase } from '@/lib/server/component-diff';

const MAX_INGEST_PER_USER_PER_MINUTE = 10;
const ingestPostTimestampsByUser = new Map<string, number[]>();

function pruneAndCountRecent(userId: string, windowMs: number, now: number): number {
  const arr = ingestPostTimestampsByUser.get(userId) ?? [];
  const cutoff = now - windowMs;
  const next = arr.filter((t) => t > cutoff);
  ingestPostTimestampsByUser.set(userId, next);
  return next.length;
}

function recordPost(userId: string, now: number): void {
  const arr = ingestPostTimestampsByUser.get(userId) ?? [];
  arr.push(now);
  ingestPostTimestampsByUser.set(userId, arr);
}

type IngestBody = {
  componentIds?: string[];
  decisions?: Record<string, IngestDecision>;
  /** When true, return conflicts without writing (default false). */
  dryRun?: boolean;
  /** When true, use filesystem for every modified component (skip per-id decisions). */
  overwriteAll?: boolean;
};

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = Date.now();
  const userId = session.user.id;
  const recent = pruneAndCountRecent(userId, 60_000, now);
  if (recent >= MAX_INGEST_PER_USER_PER_MINUTE) {
    return NextResponse.json({ error: 'Too many ingest requests; try again in a minute.' }, { status: 429 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as IngestBody;
    const all = ingestAllFromConfig();
    const idSet = body.componentIds?.length ? new Set(body.componentIds) : null;
    let results = idSet ? all.filter((r) => idSet.has(r.id)) : all;

    if (results.length === 0) {
      return NextResponse.json(
        { error: 'No matching components found on disk (check handoff.config.js entries.components).' },
        { status: 400 }
      );
    }

    const diffs = await diffFilesystemVsDatabase();
    const modifiedIds = new Set(diffs.filter((d) => d.status === 'modified').map((d) => d.id));
    const decisionsIn = { ...(body.decisions ?? {}) } as Record<string, IngestDecision>;
    if (body.overwriteAll) {
      for (const id of modifiedIds) {
        if (results.some((r) => r.id === id)) decisionsIn[id] = 'filesystem';
      }
    }
    const needsDecision = results.filter((r) => modifiedIds.has(r.id) && !decisionsIn[r.id]);

    if (needsDecision.length > 0 && !body.dryRun) {
      return NextResponse.json(
        {
          error: 'Conflicts require per-component decisions',
          conflicts: diffs.filter((d) => results.some((r) => r.id === d.id) && (d.status === 'modified' || d.status === 'new')),
          hint: 'POST again with overwriteAll: true, or decisions: { [id]: "filesystem" | "keep_db" | "skip" }',
        },
        { status: 409 }
      );
    }

    if (body.dryRun) {
      return NextResponse.json({
        dryRun: true,
        wouldIngest: results.map((r) => r.id),
        diffs: diffs.filter((d) => results.some((res) => res.id === d.id)),
      });
    }

    recordPost(userId, now);

    const out = await upsertIngestedComponents(results, {
      userId: session.user.id,
      historyUserId: session.user.id,
      decisions: decisionsIn,
    });

    return NextResponse.json({
      ingested: out.ingested,
      skipped: out.skipped,
      kept: out.kept,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
