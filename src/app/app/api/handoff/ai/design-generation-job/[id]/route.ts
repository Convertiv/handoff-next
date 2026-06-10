import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDesignGenerationJob } from '@/lib/db/queries';

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
  });
}
