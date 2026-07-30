import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { isServerAiConfigured } from '@/lib/server/ai-client';
import { runPlaygroundChatTurn, type PlaygroundChatEvent, type PlaygroundChatMessage } from '@/lib/server/playground-chat';

/** Several tool round-trips per turn; stated so a slow one isn't surprising. */
export const maxDuration = 120;

/**
 * One turn of the build-a-page conversation, streamed as newline-delimited JSON events.
 *
 * **Events, not tokens.** A turn spends 10–30s searching the catalog, scaffolding props and looking
 * for imagery; the model's prose is the least interesting part of that. Streaming what it is *doing*
 * is what tells a user it isn't stuck. Matches the event convention of `openAiChatStream`.
 *
 * The tool loop itself knows nothing about HTTP — it takes an `onEvent` callback — so it stays
 * testable and could be driven from somewhere other than a request.
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: PlaygroundChatEvent | { type: 'done' }) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The client went away mid-write. The abort signal below stops the loop; nothing to do here.
        }
      };

      try {
        await runPlaygroundChatTurn({
          messages,
          attachedAssetIds,
          actorUserId: session.user!.id,
          onEvent: send,
          signal: request.signal,
        });
      } catch (e) {
        console.error('[ai/playground-chat]', e);
        // Once the first byte is out the status code is fixed, so failures have to travel in-band.
        send({ type: 'error', message: e instanceof Error ? e.message : 'The request failed.' });
      } finally {
        send({ type: 'done' });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      // Without this a proxy buffers the whole stream and delivers it at the end, which is exactly the
      // opacity the streaming was added to remove.
      'X-Accel-Buffering': 'no',
    },
  });
}
