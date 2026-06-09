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
      // ── Visual component browser ──────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'show_components',
          description:
            'Display a visual grid of matching components with screenshots so the user can browse options. ' +
            'Use when the user is looking for a component type (e.g. "show me heroes", "what card components do you have?"). ' +
            'Limit to the most relevant matches (max 8). Always set a recommendation when you have a clear best fit.',
          parameters: {
            type: 'object',
            properties: {
              components: {
                type: 'array',
                description: 'The matching components to display',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' },
                    group: { type: 'string' },
                    description: { type: 'string' },
                    screenshotUrl: {
                      type: 'string',
                      description: 'The screenshotUrl / image value from the component list (5th column). Empty string if none.',
                    },
                  },
                  required: ['id', 'title', 'group', 'description', 'screenshotUrl'],
                },
              },
              recommendation: {
                type: 'string',
                description: 'The id of the single most recommended component for the user\'s needs',
              },
              recommendationReason: {
                type: 'string',
                description: 'One sentence explaining why this component is the best fit',
              },
            },
            required: ['components'],
          },
        },
      },

      // ── Direct component navigation ───────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'navigate_component',
          description: 'Navigate the user to a specific component detail page',
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

      // ── Pattern navigation ────────────────────────────────────────────────
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

      // ── Playground ────────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'open_playground',
          description: 'Launch the component playground for code-level experimentation',
          parameters: {
            type: 'object',
            properties: {
              description: { type: 'string', description: 'What to build or experiment with' },
            },
            required: ['description'],
          },
        },
      },

      // ── Design workbench ──────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'open_design_workbench',
          description:
            'Open the AI design workbench to generate a design mockup. ' +
            'Use ONLY after the user has chosen a component AND provided enough content detail. ' +
            'Pass componentId to pre-select the component and generationPrompt to pre-fill the generation request.',
          parameters: {
            type: 'object',
            properties: {
              description: {
                type: 'string',
                description: 'Short label describing what will be generated (shown on the action card)',
              },
              componentId: {
                type: 'string',
                description: 'ID of the component to use as the basis. Leave empty if not component-specific.',
              },
              generationPrompt: {
                type: 'string',
                description:
                  'The full prompt to pre-fill in the workbench. Should be specific: include the component name, ' +
                  'user\'s content (headline, body, CTA), and any special design requirements (background image, layout, etc.).',
              },
            },
            required: ['description'],
          },
        },
      },

      // ── Recent changes ────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'get_recent_changes',
          description:
            'Show a changelog of recent component updates. Call when user asks what changed recently, ' +
            'what was updated, recent pushes, or wants to see the changelog.',
          parameters: {
            type: 'object',
            properties: {
              days: { type: 'number', description: 'How many days back to look. Default 14.' },
              limit: { type: 'number', description: 'Max entries to return. Default 20.' },
            },
            required: [],
          },
        },
      },

      // ── Validation / accessibility ────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'check_validation',
          description:
            'Show accessibility and validation results for a component. Call when user asks about ' +
            'a11y issues, errors, warnings, or validation for a named component.',
          parameters: {
            type: 'object',
            properties: {
              componentId: { type: 'string', description: 'The component ID to check' },
              componentTitle: { type: 'string', description: 'Human-readable component title' },
            },
            required: ['componentId', 'componentTitle'],
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
