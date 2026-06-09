import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isServerAiConfigured, openAiChatStream } from '@/lib/server/ai-client';
import type { OpenAiTool, ChatMessage } from '@/lib/server/ai-client';
import { buildDesignSystemContext } from '@/lib/server/design-system-context';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as {
      messages: { role: 'system' | 'user'; content: string }[];
      pageContext?: { type: 'component' | 'pattern'; id: string };
    };

    if (!isServerAiConfigured()) {
      return NextResponse.json({ error: 'AI not configured' }, { status: 400 });
    }

    const systemPrompt = await buildDesignSystemContext(body.pageContext);
    const systemMsg: ChatMessage = { role: 'system', content: systemPrompt };

    const tools: OpenAiTool[] = [
      {
        type: 'function',
        function: {
          name: 'navigate_component',
          description: 'Navigate the user to a specific component in the design system',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'The component ID to navigate to' },
              title: { type: 'string', description: 'Human-readable component title' },
              reason: { type: 'string', description: 'Why this component is relevant' },
            },
            required: ['id', 'title', 'reason'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'navigate_pattern',
          description: 'Navigate the user to a specific pattern in the design system',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'The pattern ID to navigate to' },
              title: { type: 'string', description: 'Human-readable pattern title' },
              reason: { type: 'string', description: 'Why this pattern is relevant' },
            },
            required: ['id', 'title', 'reason'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'open_playground',
          description: 'Launch the component playground to build or experiment with UI',
          parameters: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'What to build or experiment with in the playground' },
            },
            required: ['description'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'open_design_workbench',
          description: 'Open the AI design workbench to generate design mockups',
          parameters: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'What design mockup to generate' },
            },
            required: ['description'],
          },
        },
      },
    ];

    const stream = await openAiChatStream(
      [systemMsg, ...(body.messages as ChatMessage[])],
      tools,
      {
        actorUserId: (session.user as { id?: string }).id ?? null,
        route: '/api/handoff/ai/chat',
      }
    );

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[ai/chat] error', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
