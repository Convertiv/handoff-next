import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import {
  getDesignGenerationJob,
  deleteDesignGenerationJob,
  getGenerationQueueActivity,
} from '@/lib/db/queries';
import { describeGenerationQueueHealth } from '@/lib/server/generation-queue-health';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }

  const job = await getDesignGenerationJob(jobId);
  if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const isAdmin = session.user.role === 'admin';
  if (job.userId !== session.user.id && !isAdmin) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  /**
   * Whether this job is going to be processed at all. Pollers can only see `pending` and would
   * otherwise wait out their full deadline while the drain is down — see `generation-queue-health`.
   * Never let a health-check failure break the status read the caller actually asked for.
   */
  const queue = await describeGenerationQueueHealth(job, getGenerationQueueActivity).catch((err) => {
    console.error('[design-generation-job] queue health check failed', err);
    return null;
  });

  return NextResponse.json({
    job: {
      id: job.id,
      artifactId: job.artifactId,
      status: job.status,
      stage: job.stage,
      imageUrl: job.imageUrl,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
    ...(queue ? { queue } : {}),
  });
}

/** Remove a generation job (dismiss a failed/stuck job so it stops reappearing). */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const jobId = Number(id);
  if (!Number.isFinite(jobId) || jobId <= 0) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 });
  }

  const deleted = await deleteDesignGenerationJob(jobId, session.user.id);
  if (!deleted) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
