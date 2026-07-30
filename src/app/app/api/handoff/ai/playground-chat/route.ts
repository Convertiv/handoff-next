import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { isServerAiConfigured } from '@/lib/server/ai-client';
import { runPlaygroundChatTurn, type PlaygroundChatMessage } from '@/lib/server/playground-chat';

/** Several tool round-trips per turn; stated so a slow one isn't surprising. */
export const maxDuration = 120;

/**
 * One turn of the playground's build-a-page conversation.
 *
 * Non-streaming on purpose. The tool loop runs server-side — search the catalog, scaffold args, search
 * assets — and only the final answer is useful to the client. Streaming would surface tokens while the
 * interesting work (which blocks, which assets) happened invisibly between them.
 */
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isServerAiConfigured()) {
    return NextResponse.json({ error: 'Server AI is not configured (HANDOFF_AI_API_KEY).' }, { status: 503 });
  }

  let body: { messages?: unknown; attachedAssetIds?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 });
  }

  const messages = Array.isArray(body.messages)
    ? (body.messages as PlaygroundChatMessage[]).filter(
        (m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'
      )
    : [];
  if (!messages.length) return NextResponse.json({ error: 'No messages.' }, { status: 400 });

  const attachedAssetIds = Array.isArray(body.attachedAssetIds)
    ? (body.attachedAssetIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];

  try {
    const turn = await runPlaygroundChatTurn({ messages, attachedAssetIds, actorUserId: session.user.id });
    return NextResponse.json(turn);
  } catch (e) {
    console.error('[ai/playground-chat]', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'The request failed.' }, { status: 500 });
  }
}
