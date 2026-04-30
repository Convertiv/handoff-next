import { NextResponse, type NextRequest } from 'next/server';
import type { PlaygroundComponent } from '@/components/Playground/types';
import { auth } from '@/lib/auth';
import { getDataProvider } from '@/lib/data';
import { isDynamic } from '@/lib/mode';
import { openAiChatJson } from '@/lib/server/ai-client';
import { buildSystemPrompt, buildUserPrompt, type PageBlockSummary } from '@/components/Playground/Wizard/prompt-builder';
import { parseWizardResponse } from '@/components/Playground/Wizard/response-parser';

const MAX_PER_USER_PER_MINUTE = 10;
const timestampsByUser = new Map<string, number[]>();

function pruneAndCountRecent(userId: string, windowMs: number, now: number): number {
  const arr = timestampsByUser.get(userId) ?? [];
  const cutoff = now - windowMs;
  const next = arr.filter((t) => t > cutoff);
  timestampsByUser.set(userId, next);
  return next.length;
}

function record(userId: string, now: number): void {
  const arr = timestampsByUser.get(userId) ?? [];
  arr.push(now);
  timestampsByUser.set(userId, arr);
}

type Body = {
  description?: string;
  content?: string;
  /** Summary lines of current page blocks for context */
  currentPageSummary?: { id: string; title: string }[];
};

export async function POST(request: NextRequest) {
  if (!isDynamic()) {
    return NextResponse.json({ error: 'Not available' }, { status: 404 });
  }
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    return NextResponse.json({ error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' }, { status: 503 });
  }

  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = Date.now();
  const userId = session.user.id;
  if (pruneAndCountRecent(userId, 60_000, now) >= MAX_PER_USER_PER_MINUTE) {
    return NextResponse.json({ error: 'Too many AI requests; try again in a minute.' }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const description = body.description?.trim() ?? '';
  if (!description) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  try {
    const provider = getDataProvider();
    const list = await provider.getComponents();
    const catalog = list as unknown as PlaygroundComponent[];

    const currentPage: PageBlockSummary[] | undefined =
      body.currentPageSummary && body.currentPageSummary.length > 0 ? body.currentPageSummary : undefined;

    const systemPrompt = buildSystemPrompt(catalog, currentPage);
    const userPrompt = buildUserPrompt(description, body.content, currentPage);
    const raw = await openAiChatJson([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], {
      actorUserId: userId,
      route: '/api/handoff/ai/generate-pattern',
      eventType: 'ai.generate_pattern',
    });

    const { entries, warnings } = parseWizardResponse(raw, catalog);
    record(userId, now);
    return NextResponse.json({ entries, warnings });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'AI request failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
