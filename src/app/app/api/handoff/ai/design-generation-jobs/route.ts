import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getActiveDesignGenerationJobsForUser } from '@/lib/db/queries';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jobs = await getActiveDesignGenerationJobsForUser(session.user.id);

  return NextResponse.json({
    jobs: jobs.map((j) => ({
      id: j.id,
      artifactId: j.artifactId,
      status: j.status,
      stage: j.stage,
      imageUrl: j.imageUrl,
      error: j.error,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
    })),
  });
}
