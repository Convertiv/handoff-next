import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { startDesignFromBrief } from '@/lib/server/design-from-brief';

/**
 * Start a design from a brief — spec-first.
 *
 * Creates the artifact with no image and queues `spec → assets → composite`, so the design is a
 * rendering of its specification rather than the specification being a report of an image. Returns as
 * soon as the pipeline is enqueued; the stages run one per invocation on the design-jobs cron, since
 * together they far exceed a single request's budget.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { brief?: string; title?: string; componentIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body with a "brief" field.' }, { status: 400 });
  }

  const brief = typeof body.brief === 'string' ? body.brief : '';
  if (!brief.trim()) return NextResponse.json({ error: 'Describe what you want designed.' }, { status: 400 });

  const result = await startDesignFromBrief({
    brief,
    title: typeof body.title === 'string' ? body.title : undefined,
    userId: session.user.id,
    componentGuides: Array.isArray(body.componentIds) ? body.componentIds : [],
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
