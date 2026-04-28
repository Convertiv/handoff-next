import { NextResponse, type NextRequest } from 'next/server';
import { countQueuedOrBuildingJobs } from '@/lib/db/queries';
import { getBuildJob, insertBuildJob, spawnComponentBuildWorker } from '@/lib/server/component-builder';

const MAX_BUILDS_PER_USER_PER_MINUTE = 5;
const MAX_CONCURRENT_QUEUED_OR_BUILDING = 3;

/** In-memory sliding window of POST timestamps per user id (admin-only callers). */
const postTimestampsByUser = new Map<string, number[]>();

function pruneAndCountRecent(userId: string, windowMs: number, now: number): number {
  const arr = postTimestampsByUser.get(userId) ?? [];
  const cutoff = now - windowMs;
  const next = arr.filter((t) => t > cutoff);
  postTimestampsByUser.set(userId, next);
  return next.length;
}

function recordPost(userId: string, now: number): void {
  const arr = postTimestampsByUser.get(userId) ?? [];
  arr.push(now);
  postTimestampsByUser.set(userId, arr);
}

export async function POST(request: NextRequest) {
  if (process.env.HANDOFF_MODE !== 'dynamic') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = (await request.json()) as { componentId?: string };
    const componentId = String(body.componentId ?? '').trim();
    if (!componentId) {
      return NextResponse.json({ error: 'Missing componentId' }, { status: 400 });
    }

    const now = Date.now();
    const userId = session.user.id;
    const recent = pruneAndCountRecent(userId, 60_000, now);
    if (recent >= MAX_BUILDS_PER_USER_PER_MINUTE) {
      return NextResponse.json({ error: 'Too many build requests; try again in a minute.' }, { status: 429 });
    }

    const active = await countQueuedOrBuildingJobs();
    if (active >= MAX_CONCURRENT_QUEUED_OR_BUILDING) {
      return NextResponse.json({ error: 'Build queue is full; try again shortly.' }, { status: 429 });
    }

    const jobId = await insertBuildJob(componentId);
    recordPost(userId, now);
    spawnComponentBuildWorker(jobId);
    return NextResponse.json({ jobId, status: 'queued' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (process.env.HANDOFF_MODE !== 'dynamic') {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  const { auth } = await import('@/lib/auth');
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const jobId = Number(request.nextUrl.searchParams.get('jobId') ?? '');
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  const row = await getBuildJob(jobId);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    componentId: row.componentId,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  });
}
