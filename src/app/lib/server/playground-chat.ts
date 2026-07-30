import 'server-only';

import { getDataProvider } from '@/lib/data';
import { openAiChatTools, type OpenAiTool } from '@/lib/server/ai-client';
import { formatBrandVoiceForPrompt, getDesignWorkspace } from '@/lib/server/design-workspace';
import { scaffoldArgsForComponent } from '@/lib/server/scaffold-args';

/**
 * The playground's "generate with AI": a conversation that assembles a page from **existing** blocks.
 *
 * Nothing here generates imagery. Layout comes from the component catalog, copy from the model under
 * the workspace's brand voice, and pictures from the asset store. That is the whole scope, and it is why
 * this is a tool-calling chat rather than a pipeline — no cron, no stages, answers in seconds.
 *
 * Replaces `components/Playground/Wizard/llm-client.ts`, which called OpenAI **directly from the
 * browser** with a user-pasted key: no cost tracking, no shared key, a secret in localStorage, and none
 * of the workspace context every other generation path inherits. Running it here fixes all four.
 *
 * **The chat proposes; the client applies.** `propose_page` is terminal and returns blocks — it never
 * writes a pattern. The caller hands them to `bulkAddComponents`, the user watches the page assemble in
 * the preview they already have, and every existing edit affordance stays meaningful. A bad proposal
 * costs a click, not a saved artifact.
 */

export interface ProposedBlock {
  componentId: string;
  args: Record<string, unknown>;
}

export interface PlaygroundChatTurn {
  /** Assistant prose — a question, a summary, or an explanation of the proposal. */
  reply: string;
  /** Present only when the model called `propose_page`. The client renders an apply card. */
  proposal?: { blocks: ProposedBlock[]; rationale: string };
  /** Tool names invoked this turn, in order. Surfaced for the UI to show its working. */
  toolsUsed: string[];
}

export interface PlaygroundChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Ceiling on the tool loop. Generous enough to scaffold several blocks, low enough to bound a runaway. */
const MAX_TOOL_ROUNDS = 12;

const TOOLS: OpenAiTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_components',
      description:
        'Search the block catalog by keyword, group, or tag. Returns id/title/group only — light. ' +
        'Use this first to find what blocks are available before proposing anything.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keyword, e.g. "hero", "pricing", "logo".' },
          group: { type: 'string', description: 'Restrict to one group.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scaffold_args',
      description:
        'Get a correctly-shaped `args` template for a component, seeded from a real preview and ' +
        'annotated with each field\'s editorType and expected shape. CALL THIS FOR EVERY BLOCK before ' +
        'proposing it. Guessing prop shapes produces blocks that render empty — a richtext field needs ' +
        'an HTML string, an image field needs { src, alt }, not a bare URL.',
      parameters: {
        type: 'object',
        properties: { componentId: { type: 'string' } },
        required: ['componentId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_assets',
      description:
        'Search the image asset store. Returns { id, name, src }. This is the ONLY source of imagery — ' +
        'put a returned `src` into an image-typed arg. Never invent an image path: a fabricated src ' +
        'renders as a broken image and looks like a bug in the page rather than a gap in the library. ' +
        'If nothing suitable exists, say so and leave the image arg empty.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What the image should depict.' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_page',
      description:
        'Propose the finished composition. Terminal — call it once, when you have scaffolded every ' +
        'block and filled its args. The user reviews and applies it; this does not save anything.',
      parameters: {
        type: 'object',
        properties: {
          blocks: {
            type: 'array',
            description: 'Ordered blocks, top of page first.',
            items: {
              type: 'object',
              properties: {
                componentId: { type: 'string' },
                args: { type: 'object', description: 'Filled args, shaped as scaffold_args described.' },
              },
              required: ['componentId', 'args'],
            },
          },
          rationale: { type: 'string', description: 'One or two sentences on why this composition.' },
        },
        required: ['blocks', 'rationale'],
      },
    },
  },
];

async function runTool(name: string, args: Record<string, unknown>, preferredAssetIds: string[]): Promise<unknown> {
  const provider = getDataProvider();

  if (name === 'search_components') {
    const q = typeof args.query === 'string' ? args.query.toLowerCase().trim() : '';
    const group = typeof args.group === 'string' ? args.group.toLowerCase().trim() : '';
    let list = await provider.getComponents();
    if (q) {
      list = list.filter(
        (c) =>
          c.id.toLowerCase().includes(q) ||
          (c.title || '').toLowerCase().includes(q) ||
          (c.group || '').toLowerCase().includes(q)
      );
    }
    if (group) list = list.filter((c) => (c.group || '').toLowerCase() === group);
    return list.slice(0, 40).map((c) => ({ id: c.id, title: c.title, group: c.group }));
  }

  if (name === 'scaffold_args') {
    return scaffoldArgsForComponent(String(args.componentId ?? ''));
  }

  if (name === 'search_assets') {
    const { listAssets } = await import('@/lib/db/queries');
    const q = typeof args.query === 'string' ? args.query.trim() : '';
    // Two queries rather than one: the search narrows by title, but anything the user attached must
    // surface regardless of what they called it — they uploaded it FOR this page.
    const [matches, all] = await Promise.all([
      listAssets({ assetType: 'image', status: 'active', limit: 60, ...(q ? { search: q } : {}) }),
      preferredAssetIds.length ? listAssets({ assetType: 'image', status: 'active', limit: 200 }) : Promise.resolve([]),
    ]);
    const attachedRows = all.filter((r) => preferredAssetIds.includes(String(r.id)));

    const seen = new Set<string>();
    const out: { id: string; name: string; src: string; alt: string; attached: boolean }[] = [];
    for (const r of [...attachedRows, ...matches]) {
      const id = String(r.id ?? '');
      // `storageUrl` and `title` are the real column names — `url`/`name` do not exist on this table,
      // and getting them wrong returns rows whose src is empty, which renders as a broken image.
      const src = String(r.storageUrl ?? '');
      if (!id || !src || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: String(r.title ?? ''), src, alt: String(r.altText ?? ''), attached: preferredAssetIds.includes(id) });
    }
    return out.slice(0, 25);
  }

  return { error: `Unknown tool "${name}".` };
}

function systemPrompt(brandVoice: string, designMd: string, attachedCount: number): string {
  return `You compose landing pages in a design-system playground by assembling EXISTING blocks.

You do not generate images or write CSS. You choose blocks from the catalog, write their copy, and fill
their props with values shaped exactly as the scaffold tells you.

## How to work
1. Ask ONE round of clarifying questions if the request is vague — audience, tone, how many sections,
   whether a form or pricing is needed. One round only; then get on with it.
2. \`search_components\` to see what exists. Prefer composing from what is there over asking for
   something that isn't.
3. \`scaffold_args\` for EVERY block you intend to use. Never guess a prop shape.
4. \`search_assets\` for any imagery. Use a real \`src\` from the store, or leave it empty and say so.
5. \`propose_page\` once, with every block filled in.
${attachedCount > 0 ? `\nThe user attached ${attachedCount} image(s) to this conversation. They are in the asset store and marked \`attached: true\` in search_assets results — prefer them.\n` : ''}
## Copy
Write real copy, not placeholders. It must obey the brand voice below.
${brandVoice ? `\n### Brand voice\n${brandVoice.slice(0, 4000)}\n` : ''}${designMd ? `\n### Design guidelines\n${designMd.slice(0, 2000)}\n` : ''}
Keep replies short. The user is watching a page get built, not reading an essay.`;
}

export async function runPlaygroundChatTurn(args: {
  messages: PlaygroundChatMessage[];
  attachedAssetIds?: string[];
  actorUserId?: string | null;
}): Promise<PlaygroundChatTurn> {
  const attached = args.attachedAssetIds ?? [];
  const workspace = await getDesignWorkspace().catch(() => null);
  const brandVoice = workspace ? formatBrandVoiceForPrompt(workspace.brandVoice).trim() : '';

  const convo: unknown[] = [
    { role: 'system', content: systemPrompt(brandVoice, workspace?.designMd ?? '', attached.length) },
    ...args.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const toolsUsed: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const { content, toolCalls } = await openAiChatTools(convo, TOOLS, {
      actorUserId: args.actorUserId ?? null,
      route: '/api/handoff/ai/playground-chat',
      eventType: 'ai.playground_chat',
    });

    if (!toolCalls.length) {
      return { reply: content ?? '', toolsUsed };
    }

    convo.push({
      role: 'assistant',
      content,
      tool_calls: toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })),
    });

    for (const call of toolCalls) {
      toolsUsed.push(call.name);
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(call.arguments) as Record<string, unknown>;
      } catch {
        /* a malformed argument object is reported back to the model rather than thrown */
      }

      // Terminal: stop the loop and hand the composition to the client.
      if (call.name === 'propose_page') {
        const blocks = Array.isArray(parsed.blocks)
          ? (parsed.blocks as ProposedBlock[]).filter((b) => b && typeof b.componentId === 'string')
          : [];
        return {
          reply: content ?? String(parsed.rationale ?? 'Here is the page.'),
          proposal: { blocks, rationale: String(parsed.rationale ?? '') },
          toolsUsed,
        };
      }

      let result: unknown;
      try {
        result = await runTool(call.name, parsed, attached);
      } catch (e) {
        // Feed the failure back rather than aborting the turn — the model can pick another block or
        // explain itself, which is far more useful than a dead conversation.
        result = { error: e instanceof Error ? e.message : 'Tool failed.' };
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 24_000) });
    }
  }

  return {
    reply: 'I looked at a lot of blocks without settling on a composition. Tell me more specifically what the page should contain.',
    toolsUsed,
  };
}
