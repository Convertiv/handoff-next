import { NextResponse, type NextRequest } from 'next/server';
import { countQueuedOrRunningFigmaFetchJobs, getFigmaFetchJob, insertFigmaFetchJob } from '@/lib/db/queries';
import { hasFigmaConnection } from '@/lib/server/figma-auth';
import { spawnFigmaFetchWorker } from '@/lib/server/figma-fetch';
import { logEvent } from '@/lib/server/event-log';

const MAX_FETCHES_PER_USER_PER_MINUTE = 3;
const MAX_CONCURRENT_FETCH_JOBS = 2;

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

export async function POST(_request: NextRequest) {
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
    const now = Date.now();
    const userId = session.user.id;
    const recent = pruneAndCountRecent(userId, 60_000, now);
    if (recent >= MAX_FETCHES_PER_USER_PER_MINUTE) {
      return NextResponse.json({ error: 'Too many fetch requests; try again in a minute.' }, { status: 429 });
    }

    const active = await countQueuedOrRunningFigmaFetchJobs();
    if (active >= MAX_CONCURRENT_FETCH_JOBS) {
      return NextResponse.json({ error: 'Figma fetch queue is full; try again shortly.' }, { status: 429 });
    }

    const connected = await hasFigmaConnection(userId);
    if (!connected) {
      return NextResponse.json({ error: 'Figma is not connected for this user.' }, { status: 400 });
    }

    const jobId = await insertFigmaFetchJob(userId);
    recordPost(userId, now);
    await logEvent({
      category: 'figma',
      eventType: 'figma_fetch.enqueue',
      status: 'success',
      actorUserId: userId,
      route: '/api/handoff/figma/fetch',
      entityType: 'figma_fetch_job',
      entityId: String(jobId),
    });
    spawnFigmaFetchWorker(jobId);
    return NextResponse.json({ jobId, status: 'queued' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Error';
    await logEvent({
      category: 'figma',
      eventType: 'figma_fetch.enqueue',
      status: 'error',
      actorUserId: session.user.id,
      route: '/api/handoff/figma/fetch',
      error: msg,
    });
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

  const jobIdRaw = request.nextUrl.searchParams.get('jobId');
  if (!jobIdRaw) {
    const connected = await hasFigmaConnection(session.user.id);
    return NextResponse.json({
      connected,
      oauthConfigured: Boolean(process.env.AUTH_FIGMA_ID && process.env.AUTH_FIGMA_SECRET),
    });
  }

  const jobId = Number(jobIdRaw);
  if (!Number.isFinite(jobId)) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });
  }

  const row = await getFigmaFetchJob(jobId);
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    status: row.status,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    triggeredByUserId: row.triggeredByUserId,
  });
}
