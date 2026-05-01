import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { authOrCloudToken } from '@/lib/sync-auth';
import { getDb } from '@/lib/db';
import { shouldProxyAi } from '@/lib/server/ai-client';
import { proxyAiToCloud } from '@/lib/server/ai-proxy';
import {
  getComponentGenerationJob,
  getDesignArtifactById,
  getLatestComponentGenerationJobForArtifact,
  insertComponentGenerationJob,
} from '@/lib/db/queries';
import { handoffComponents } from '@/lib/db/schema';
import { isValidComponentId } from '@/lib/component-id';
import { scheduleComponentGenerationJob } from '@/lib/server/component-generation-schedule';
import type { RendererKind } from '@/lib/server/component-scaffold';

const RENDERERS: RendererKind[] = ['handlebars', 'react', 'csf'];

function isRenderer(s: string): s is RendererKind {
  return (RENDERERS as readonly string[]).includes(s);
}

type PostBody = {
  artifactId?: string;
  componentName?: string;
  renderer?: string;
  behaviorPrompt?: string;
  a11yStandard?: string;
  useExtractedAssets?: boolean;
  maxIterations?: number;
};

export async function POST(request: NextRequest) {
  const ctx = await authOrCloudToken(request);
  if (ctx instanceof NextResponse) return ctx;

  if (shouldProxyAi()) {
    return proxyAiToCloud(request, { actingUserId: ctx.userId !== 'cloud-proxy' ? ctx.userId : undefined });
  }

  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    return NextResponse.json({ error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as PostBody;
  const artifactId = body.artifactId?.trim();
  const componentName = body.componentName?.trim().toLowerCase();
  const renderer = body.renderer?.trim() || 'handlebars';

  if (!artifactId) {
    return NextResponse.json({ error: 'artifactId is required' }, { status: 400 });
  }
  if (!componentName || !isValidComponentId(componentName)) {
    return NextResponse.json({ error: 'componentName must be a valid component id (lowercase, hyphens).' }, { status: 400 });
  }
  if (!isRenderer(renderer)) {
    return NextResponse.json({ error: `renderer must be one of: ${RENDERERS.join(', ')}` }, { status: 400 });
  }

  const artifact = await getDesignArtifactById(artifactId);
  if (!artifact) {
    return NextResponse.json({ error: 'Design not found' }, { status: 404 });
  }
  const isAdmin = ctx.role === 'admin';
  if (artifact.userId !== ctx.userId && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const db = getDb();
  const [existing] = await db.select({ id: handoffComponents.id }).from(handoffComponents).where(eq(handoffComponents.id, componentName));
  if (existing) {
    return NextResponse.json({ error: `Component "${componentName}" already exists.` }, { status: 409 });
  }

  const a11y = body.a11yStandard?.trim() || 'none';
  if (!['none', 'wcag-aa', 'wcag-aaa'].includes(a11y)) {
    return NextResponse.json({ error: 'a11yStandard must be none, wcag-aa, or wcag-aaa' }, { status: 400 });
  }

  const jobId = await insertComponentGenerationJob({
    artifactId,
    userId: ctx.userId,
    componentId: componentName,
    renderer,
    maxIterations: Math.min(Math.max(Number(body.maxIterations) || 3, 1), 5),
    a11yStandard: a11y,
    behaviorPrompt: body.behaviorPrompt?.trim() ?? '',
    useExtractedAssets: body.useExtractedAssets !== false,
  });

  scheduleComponentGenerationJob(jobId);
  return NextResponse.json({ jobId });
}

export async function GET(request: NextRequest) {
  const ctx = await authOrCloudToken(request);
  if (ctx instanceof NextResponse) return ctx;

  if (shouldProxyAi()) {
    return proxyAiToCloud(request, { actingUserId: ctx.userId !== 'cloud-proxy' ? ctx.userId : undefined });
  }

  const { searchParams } = new URL(request.url);
  const jobId = Number(searchParams.get('jobId') || '');
  const artifactId = searchParams.get('artifactId')?.trim();

  if (Number.isFinite(jobId) && jobId > 0) {
    const job = await getComponentGenerationJob(jobId);
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const isAdmin = ctx.role === 'admin';
    if (job.userId !== ctx.userId && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ job });
  }

  if (artifactId) {
    const artifact = await getDesignArtifactById(artifactId);
    if (!artifact) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 });
    const isAdmin = ctx.role === 'admin';
    if (artifact.userId !== ctx.userId && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const job = await getLatestComponentGenerationJobForArtifact(artifactId);
    return NextResponse.json({ job: job ?? null });
  }

  return NextResponse.json({ error: 'Provide jobId or artifactId' }, { status: 400 });
}
