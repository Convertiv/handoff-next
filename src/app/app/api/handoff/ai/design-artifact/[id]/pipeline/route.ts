import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { getDesignArtifactById } from '@/lib/db/queries';
import { getActorGrant } from '@/lib/db/grant-queries';
import { computePermissions, toVisibility, type MutateActor } from '@/lib/authz/policy';
import { getLatestDevPipelineProgress, startDevPipeline, type DevPipelineIntent } from '@/lib/server/dev-pipeline';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Start and poll the asset-first design pipeline from the browser.
 *
 * The pipeline was reachable only over MCP, which meant the workbench itself could not run asset-first
 * generation — the UI's "Transition to dev" button still went through the old spec-only path. This is
 * the route the dashboard needs.
 *
 * Deliberately thin: it authorizes, delegates to `startDevPipeline`, and returns the pipeline id. The
 * work happens on the design-jobs cron, one stage per invocation, because a single stage takes 1–2
 * minutes and cannot be awaited inside a request.
 */

async function authorize(artifactId: string, need: 'view' | 'edit') {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  const row = await getDesignArtifactById(artifactId);
  if (!row) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };

  const actor: MutateActor = { userId: session.user.id, role: session.user.role ?? null };
  const grant = await getActorGrant('design_artifact', artifactId, session.user.id);
  const perms = computePermissions(actor, { ownerUserId: row.userId, visibility: toVisibility(row.visibility) }, grant);

  // 404 rather than 403 on denial, matching the other artifact routes so ids can't be probed.
  const allowed = need === 'edit' ? perms.canEdit : perms.canView;
  if (!allowed) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  return { userId: session.user.id };
}

const INTENTS: DevPipelineIntent[] = ['assets-only', 'assets-and-composite', 'spec-only', 'full'];

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const artifactId = (id ?? '').trim();
  if (!artifactId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  // Spends AI credits and — for composite intents — replaces the artifact's image.
  const gate = await authorize(artifactId, 'edit');
  if ('error' in gate) return gate.error;

  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    return NextResponse.json({ error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' }, { status: 503 });
  }

  let intent: DevPipelineIntent = 'assets-only';
  try {
    const body = (await request.json()) as { intent?: string };
    if (body?.intent && INTENTS.includes(body.intent as DevPipelineIntent)) intent = body.intent as DevPipelineIntent;
  } catch {
    /* empty body is fine — defaults to assets-only, the non-destructive choice */
  }

  const result = await startDevPipeline({ artifactId, intent });
  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ...result, intent });
}

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const artifactId = (id ?? '').trim();
  if (!artifactId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

  const gate = await authorize(artifactId, 'view');
  if ('error' in gate) return gate.error;

  const progress = await getLatestDevPipelineProgress(artifactId);
  // No pipeline is a normal state, not an error — the UI shows nothing rather than a failure.
  return NextResponse.json({ pipeline: progress });
}
