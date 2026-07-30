import 'server-only';

import { getDataProvider } from '@/lib/data';
import { openAiChatTools, type OpenAiTool } from '@/lib/server/ai-client';
import { formatBrandVoiceForPrompt, getDesignWorkspace } from '@/lib/server/design-workspace';
import { scaffoldArgsForComponent } from '@/lib/server/scaffold-args';
import { summarizeComposition } from '@/lib/composition-summary';

export { summarizeComposition };

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

/**
 * Progress emitted while the loop runs.
 *
 * Deliberately *events*, not tokens. A turn spends 10–30s doing real work — searching the catalog,
 * scaffolding props, looking for imagery — and a spinner cannot distinguish that from being stuck.
 * Streaming the model's prose would show characters appearing while the interesting part happened
 * invisibly between them; streaming what it is *doing* is the thing worth watching.
 *
 * The loop takes a callback rather than being a generator so it stays transport-agnostic: the route
 * turns these into SSE, and a test can collect them into an array.
 */
export type PlaygroundChatEvent =
  | { type: 'status'; text: string }
  | { type: 'reply'; content: string }
  | { type: 'proposal'; blocks: ProposedBlock[]; rationale: string }
  | { type: 'error'; message: string };

/** Human-readable narration for a tool call. Named for what the user cares about, not the function. */
function narrate(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'search_components': {
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      return q ? `Looking for ${q} blocks…` : 'Looking through your blocks…';
    }
    case 'scaffold_args':
      return `Checking how ${String(args.componentId ?? 'that block')} is configured…`;
    case 'search_assets': {
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      return q ? `Searching your assets for ${q}…` : 'Searching your asset library…';
    }
    case 'search_icons': {
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      return q ? `Finding a ${q} icon…` : 'Looking through the icon library…';
    }
    case 'propose_page':
      return 'Putting the page together…';
    default:
      return 'Working…';
  }
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
      name: 'search_icons',
      description:
        'Search the design system icon library. Returns { name, category, tags }. Use a returned NAME ' +
        'in any icon-typed field. Like imagery, icons come from the system — never invent an icon name, ' +
        'because an unrecognised one renders as nothing and reads as a broken block.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'What the icon should depict, e.g. "shield", "chat".' } },
        required: ['query'],
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

  if (name === 'search_icons') {
    const q = typeof args.query === 'string' ? args.query.toLowerCase().trim() : '';
    const catalog = await provider.getIconCatalog();
    const hits = q
      ? catalog.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            (e.description ?? '').toLowerCase().includes(q) ||
            (e.tags ?? []).some((t) => t.toLowerCase().includes(q))
        )
      : catalog;
    // Names and tags only. Icon SVG bodies are large and get re-sent on every subsequent round of the
    // loop, so the full catalog entry is exactly the wrong thing to put in a tool result.
    return hits.slice(0, 30).map((e) => ({ name: e.name, category: e.category, tags: (e.tags ?? []).slice(0, 6) }));
  }

  return { error: `Unknown tool "${name}".` };
}

function systemPrompt(brandVoice: string, designMd: string, attachedCount: number, composition: string): string {
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
${attachedCount > 0 ? `\nThe user attached ${attachedCount} image(s) to this conversation. They are in the asset store and marked \`attached: true\` in search_assets results — prefer them.\n` : ''}${composition ? `\n## Already on the canvas\n${composition}\n\nA follow-up almost certainly refers to one of these. When the user asks for a change, propose the WHOLE page again with that change made — the proposal replaces what is there.\n` : ''}
## Copy
Write real copy, not placeholders. It must obey the brand voice below.
${brandVoice ? `\n### Brand voice\n${brandVoice.slice(0, 4000)}\n` : ''}${designMd ? `\n### Design guidelines\n${designMd.slice(0, 2000)}\n` : ''}
Keep replies short. The user is watching a page get built, not reading an essay.`;
}

export async function runPlaygroundChatTurn(args: {
  messages: PlaygroundChatMessage[];
  attachedAssetIds?: string[];
  actorUserId?: string | null;
  /** Progress sink. Omit for a plain awaited turn — the loop behaves identically either way. */
  onEvent?: (event: PlaygroundChatEvent) => void;
  /** Aborts between rounds. Without it, a closed tab leaves the loop running and burning tokens. */
  signal?: AbortSignal;
  /** What is currently on the canvas, so a follow-up can refer to it. Summarised, never sent whole. */
  currentBlocks?: { componentId: string; args?: Record<string, unknown> }[];
}): Promise<PlaygroundChatTurn> {
  const emit = args.onEvent ?? (() => {});
  const attached = args.attachedAssetIds ?? [];
  const workspace = await getDesignWorkspace().catch(() => null);
  const brandVoice = workspace ? formatBrandVoiceForPrompt(workspace.brandVoice).trim() : '';

  const composition = summarizeComposition(args.currentBlocks ?? []);
  const convo: unknown[] = [
    { role: 'system', content: systemPrompt(brandVoice, workspace?.designMd ?? '', attached.length, composition) },
    ...args.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const toolsUsed: string[] = [];
  // Which components the model has actually scaffolded this turn. `propose_page` is checked against
  // this rather than trusting the prompt's instruction to scaffold first.
  const scaffolded = new Set<string>();

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    // Checked between rounds rather than mid-call: the in-flight request finishes either way, but we
    // stop paying for the next one.
    if (args.signal?.aborted) return { reply: '', toolsUsed };

    const { content, toolCalls } = await openAiChatTools(convo, TOOLS, {
      actorUserId: args.actorUserId ?? null,
      route: '/api/handoff/ai/playground-chat',
      eventType: 'ai.playground_chat',
    });

    if (!toolCalls.length) {
      const reply = content ?? '';
      emit({ type: 'reply', content: reply });
      return { reply, toolsUsed };
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
      emit({ type: 'status', text: narrate(call.name, parsed) });

      // Terminal — but only once every block has actually been scaffolded.
      //
      // Whether a model follows "call scaffold_args for every block" is probabilistic, and the cost of
      // it not doing so is invisible: unscaffolded args are guesses at prop shape, so the block applies
      // cleanly and renders empty. That reads as a broken component rather than a skipped step. So the
      // rule is enforced here instead of asserted in the prompt — the server knows exactly what was
      // scaffolded.
      //
      // Handed back as a tool result rather than raised as an error: the model can scaffold the missing
      // ones and re-propose within the same turn, which is invisible to the user and costs one round.
      if (call.name === 'propose_page') {
        const blocks = Array.isArray(parsed.blocks)
          ? (parsed.blocks as ProposedBlock[]).filter((b) => b && typeof b.componentId === 'string')
          : [];
        const missing = [...new Set(blocks.map((b) => b.componentId).filter((id) => !scaffolded.has(id)))];

        if (missing.length) {
          console.log('[playground-chat] rejected proposal, unscaffolded:', missing.join(', '));
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              rejected: true,
              reason:
                'These blocks were never scaffolded, so their args are guesses and would render empty. ' +
                'Call scaffold_args for each, fill the args it returns, then propose again.',
              unscaffolded: missing,
            }),
          });
          continue;
        }

        const rationale = String(parsed.rationale ?? '');
        const reply = content ?? rationale ?? 'Here is the page.';
        emit({ type: 'reply', content: reply });
        emit({ type: 'proposal', blocks, rationale });
        return { reply, proposal: { blocks, rationale }, toolsUsed };
      }

      let result: unknown;
      try {
        result = await runTool(call.name, parsed, attached);
        if (call.name === 'scaffold_args' && typeof parsed.componentId === 'string') {
          const id = parsed.componentId.trim();
          // Only count a scaffold that actually resolved. Scaffolding a component that does not exist
          // teaches the model nothing about its props, so it must not satisfy the check below.
          if (id && !(result && typeof result === 'object' && 'error' in result)) scaffolded.add(id);
        }
      } catch (e) {
        // Feed the failure back rather than aborting the turn — the model can pick another block or
        // explain itself, which is far more useful than a dead conversation.
        result = { error: e instanceof Error ? e.message : 'Tool failed.' };
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 24_000) });
    }
  }

  const exhausted =
    'I looked at a lot of blocks without settling on a composition. Tell me more specifically what the page should contain.';
  emit({ type: 'reply', content: exhausted });
  return { reply: exhausted, toolsUsed };
}

// ── Single-block refinement ───────────────────────────────────────────────────

/**
 * Reconsider one block in a proposal without touching the rest.
 *
 * The all-or-nothing problem: the only way to change a suggested hero was to regenerate everything and
 * hope the parts you liked survived. This scopes the request to one slot — the model sees the whole
 * composition for context but can only return a single block, so "I don't like the bubble hero" cannot
 * quietly reword the pricing section.
 *
 * Scoping also sidesteps the reason full conversational editing looked expensive: the model never has
 * to resolve "before the footer" when there are two candidate footers, because the caller already said
 * which index it means.
 */
export interface BlockRefinementResult {
  ok: boolean;
  block?: ProposedBlock;
  note?: string;
  error?: string;
}

const REFINE_TOOLS: OpenAiTool[] = [
  ...TOOLS.filter((t) => t.function.name !== 'propose_page'),
  {
    type: 'function',
    function: {
      name: 'propose_block',
      description:
        'Return the single replacement block. Terminal — call once, after scaffolding whichever ' +
        'component you settled on.',
      parameters: {
        type: 'object',
        properties: {
          componentId: { type: 'string' },
          args: { type: 'object', description: 'Filled args, shaped as scaffold_args described.' },
          note: { type: 'string', description: 'One short sentence on what changed and why.' },
        },
        required: ['componentId', 'args'],
      },
    },
  },
];

export async function refineProposalBlock(args: {
  blocks: ProposedBlock[];
  index: number;
  /** What the user wants: "something other than a bubble hero", "shorter copy", … */
  instruction: string;
  actorUserId?: string | null;
  onEvent?: (event: PlaygroundChatEvent) => void;
  signal?: AbortSignal;
}): Promise<BlockRefinementResult> {
  const emit = args.onEvent ?? (() => {});
  const target = args.blocks[args.index];
  if (!target) return { ok: false, error: 'That block is no longer in the proposal.' };

  const workspace = await getDesignWorkspace().catch(() => null);
  const brandVoice = workspace ? formatBrandVoiceForPrompt(workspace.brandVoice).trim() : '';

  const convo: unknown[] = [
    {
      role: 'system',
      content: `You are changing ONE block of an already-composed page. Do not redesign the page.

## The page as it stands
${summarizeComposition(args.blocks)}

## The block to change
Position ${args.index + 1}: ${target.componentId}

## What the user wants
${args.instruction}

Search for a suitable component, call scaffold_args on whatever you settle on, fill its args with real
copy carrying over anything worth keeping from the current block, then call propose_block ONCE.
Returning the same componentId is fine when the request is about the copy rather than the layout.
${brandVoice ? `\n## Brand voice — any copy you write must obey this\n${brandVoice.slice(0, 3000)}\n` : ''}`,
    },
    { role: 'user', content: args.instruction },
  ];

  const scaffolded = new Set<string>();

  for (let round = 0; round < 8; round += 1) {
    if (args.signal?.aborted) return { ok: false, error: 'Cancelled.' };

    const { content, toolCalls } = await openAiChatTools(convo, REFINE_TOOLS, {
      actorUserId: args.actorUserId ?? null,
      route: '/api/handoff/ai/playground-chat/refine',
      eventType: 'ai.playground_refine',
    });

    if (!toolCalls.length) {
      // No tool call means it answered in prose — usually a question or a refusal. Pass it through
      // rather than reporting a failure, so the user reads the actual reason.
      return { ok: false, error: content ?? 'No replacement was proposed.' };
    }

    convo.push({
      role: 'assistant',
      content,
      tool_calls: toolCalls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.arguments } })),
    });

    for (const call of toolCalls) {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(call.arguments) as Record<string, unknown>;
      } catch {
        /* reported back to the model rather than thrown */
      }
      emit({ type: 'status', text: narrate(call.name, parsed) });

      if (call.name === 'propose_block') {
        const componentId = String(parsed.componentId ?? '').trim();
        // Same enforcement as the full proposal: unscaffolded args are guesses at prop shape, and the
        // block would apply cleanly and render empty.
        if (!componentId || !scaffolded.has(componentId)) {
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              rejected: true,
              reason: `Call scaffold_args for "${componentId}" first, fill the args it returns, then propose again.`,
            }),
          });
          continue;
        }
        return {
          ok: true,
          block: { componentId, args: (parsed.args ?? {}) as Record<string, unknown> },
          note: typeof parsed.note === 'string' ? parsed.note : undefined,
        };
      }

      let result: unknown;
      try {
        result = await runTool(call.name, parsed, []);
        if (call.name === 'scaffold_args' && typeof parsed.componentId === 'string') {
          const id = parsed.componentId.trim();
          if (id && !(result && typeof result === 'object' && 'error' in result)) scaffolded.add(id);
        }
      } catch (e) {
        result = { error: e instanceof Error ? e.message : 'Tool failed.' };
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 24_000) });
    }
  }

  return { ok: false, error: 'Could not settle on a replacement. Try describing what you want instead.' };
}
