import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { killComponentBuildJob, killComponentGenerationJob, killDesignAssetExtractionJob } from '@/lib/db/queries';

type KillBody =
  | { kind: 'component_build'; id: number }
  | { kind: 'component_generation'; id: number }
  | { kind: 'design_asset_extraction'; id: string };

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await request.json().catch(() => null)) as KillBody | null;
  if (!body?.kind) return NextResponse.json({ error: 'Missing kind' }, { status: 400 });

  try {
    let killed = false;
    if (body.kind === 'component_build') {
      if (!Number.isFinite(body.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      killed = await killComponentBuildJob(body.id);
    } else if (body.kind === 'component_generation') {
      if (!Number.isFinite(body.id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      killed = await killComponentGenerationJob(body.id);
    } else if (body.kind === 'design_asset_extraction') {
      if (typeof body.id !== 'string' || !body.id.trim()) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
      killed = await killDesignAssetExtractionJob(body.id);
    } else {
      return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
    }

    if (!killed) return NextResponse.json({ error: 'Job not found or already in terminal state' }, { status: 409 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to kill job';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
