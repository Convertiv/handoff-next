import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { isServerAiConfigured } from '@/lib/server/ai-client';
import { refineProposalBlock, type ProposedBlock } from '@/lib/server/playground-chat';

export const maxDuration = 60;

/**
 * Change one block of a proposal without touching the rest.
 *
 * Non-streaming: a scoped refinement is a handful of rounds and finishes fast enough that a status
 * line would flash rather than inform. The full turn streams because it is 10–30s of real work; this
 * usually is not.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isServerAiConfigured()) {
    return NextResponse.json({ error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' }, { status: 503 });
  }

  let body: { blocks?: unknown; index?: unknown; instruction?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const blocks = Array.isArray(body.blocks)
    ? (body.blocks as ProposedBlock[]).filter((b) => b && typeof b.componentId === 'string')
    : [];
  const index = typeof body.index === 'number' ? body.index : -1;
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';

  if (!blocks.length) return NextResponse.json({ error: 'No proposal to refine.' }, { status: 400 });
  if (index < 0 || index >= blocks.length) return NextResponse.json({ error: 'That block is not in the proposal.' }, { status: 400 });
  if (!instruction) return NextResponse.json({ error: 'Say what should change.' }, { status: 400 });

  try {
    const result = await refineProposalBlock({
      blocks,
      index,
      instruction,
      actorUserId: session.user.id,
      signal: request.signal,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (e) {
    console.error('[ai/playground-chat/refine]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'The request failed.' }, { status: 500 });
  }
}
