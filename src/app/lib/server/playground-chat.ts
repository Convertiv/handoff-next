import 'server-only';

import { getDataProvider } from '@/lib/data';
import { openAiChatTools, type OpenAiTool } from '@/lib/server/ai-client';
import { formatBrandVoiceForPrompt, getDesignWorkspace } from '@/lib/server/design-workspace';
import { scaffoldArgsForComponent } from '@/lib/server/scaffold-args';
import { blankContentValues, mergeBlockValues, summarizeFields } from '@/lib/merge-block-values';
import { formatExemplars } from '@/lib/page-exemplars';
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
    case 'list_blocks':
      return 'Reading your block catalog…';
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

/**
 * Ceiling on the tool loop.
 *
 * A real run exhausted 16 rounds on 17 tool calls without ever proposing: it searched section by
 * section and inspected each block in turn. Serving the whole catalog in one call removed the need for
 * either, so a page should now take two or three calls and this ceiling should be unreachable.
 * Rounds are superlinear in cost — the whole transcript replays each time — so hitting it means
 * something is wrong rather than that the page was complicated.
 */
const MAX_TOOL_ROUNDS = 16;

const TOOLS: OpenAiTool[] = [
  {
    type: 'function',
    function: {
      name: 'list_blocks',
      description:
        'The block catalog: every block, with its group and its editable fields. Call this ONCE, with ' +
        'no arguments, and choose from the result. Do not search section by section — the whole ' +
        'catalog is small enough to read in one go, and searching per section is how you run out of ' +
        'steps before proposing anything.',
      parameters: {
        type: 'object',
        properties: {
          group: { type: 'string', description: 'Optional. Omit to see everything, which is usually right.' },
        },
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
                values: {
                  type: 'object',
                  description:
                    'CONTENT ONLY, keyed by the field names from list_blocks — e.g. ' +
                    '{ "headline": "One platform. Every conversation.", "cta": { "label": "Book a demo" } }. ' +
                    'Write real copy. Do not describe structure or repeat field types; the server applies ' +
                    'these to the block\'s real shape. Omit a field to keep its default.',
                },
              },
              required: ['componentId', 'values'],
            },
          },
          rationale: { type: 'string', description: 'One or two sentences on why this composition.' },
        },
        required: ['blocks', 'rationale'],
      },
    },
  },
];

/**
 * Turn the model's content into real block args.
 *
 * Scaffolds each component here rather than making the model do it, then merges the authored values
 * onto that template. The model never sees or restates a shape, which is what removes both the
 * round-trips and the possibility of a block that applies cleanly and renders empty.
 */
async function buildBlocks(
  raw: { componentId?: unknown; values?: unknown }[],
  knownAssetSrcs?: Set<string>
): Promise<{ blocks: ProposedBlock[]; problems: string[]; gaps: { componentId: string; fields: string[] }[] }> {
  const blocks: ProposedBlock[] = [];
  const problems: string[] = [];
  const gaps: { componentId: string; fields: string[] }[] = [];

  for (const entry of raw) {
    const componentId = String(entry?.componentId ?? '').trim();
    if (!componentId) continue;

    const scaffold = await scaffoldArgsForComponent(componentId);
    if ('error' in scaffold) {
      problems.push(`${componentId}: ${scaffold.error}`);
      continue;
    }

    // Shape from the preview, content blanked. Leaving the preview's own copy in place made an
    // unfilled field render as somebody else's sample rather than as a gap, which is how a page ships
    // looking finished and isn't.
    const template = blankContentValues(scaffold.args, scaffold.fields);
    const values = (entry?.values ?? {}) as Record<string, unknown>;
    const { args, unknownKeys, invalidValues, unfilled } = mergeBlockValues(template, values, scaffold.fields, knownAssetSrcs);
    if (unknownKeys.length) {
      // Surfaced rather than swallowed: a model that keeps inventing the same field name is a prompt
      // problem, and silently dropping it is how that goes unnoticed for weeks.
      console.warn('[playground-chat] unknown fields on', componentId, unknownKeys.join(', '));
    }
    if (invalidValues.length) console.warn('[playground-chat] rejected values on', componentId, invalidValues.join('; '));
    if (unfilled.length) gaps.push({ componentId, fields: unfilled });
    blocks.push({ componentId, args });
  }

  return { blocks, problems, gaps };
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  preferredAssetIds: string[],
  /** Collects every src the store returned, so an invented URL can be told from a real one. */
  seenAssetSrcs?: Set<string>
): Promise<unknown> {
  const provider = getDataProvider();

  if (name === 'list_blocks') {
    const group = typeof args.group === 'string' ? args.group.toLowerCase().trim() : '';
    let list = await provider.getComponents();
    if (group) list = list.filter((c) => (c.group || '').toLowerCase() === group);
    // The whole catalog with field summaries, in one response. Roughly a line per block — cheap enough
    // that the model never needs to search section by section, which is what exhausted the loop before.
    return list.map((c) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const comp = c as any;
      // Shapes come from a real preview's values, so `buttonSlots` is described as whatever this
      // component actually uses rather than a guess from its declared type. List rows already carry
      // previews, so this costs no extra query.
      const previews = (comp?.previews ?? {}) as Record<string, { values?: Record<string, unknown> }>;
      const key = 'generic' in previews ? 'generic' : Object.keys(previews)[0];
      const values = key ? (previews[key]?.values ?? (previews[key] as Record<string, unknown>)) : null;
      return {
        id: c.id,
        title: c.title,
        group: c.group,
        fields: summarizeFields(comp?.properties ?? null, values as Record<string, unknown> | null),
      };
    });
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
    for (const a of out) seenAssetSrcs?.add(a.src);
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
  const exemplars = formatExemplars();
  return `You compose landing pages in a design-system playground by assembling EXISTING blocks.

You do not generate images or write CSS. You choose blocks from the catalog, write their copy, and fill
their props with values shaped exactly as the scaffold tells you.

## How to work — this should take two or three tool calls, not ten
1. Ask ONE round of clarifying questions if the request is genuinely vague. One round only.
2. \`list_blocks\` ONCE, with no arguments. That is the entire catalog with every block's fields. Read
   it and choose. Do NOT call it repeatedly for different sections.
3. \`search_assets\` / \`search_icons\` only if the page needs imagery or icons.
4. \`propose_page\` with all the blocks and your copy.

You do not need to inspect a block before using it — the fields listed by \`list_blocks\` are all you
need, and the server applies your values to the block's real shape. Write copy, not structure.

## Filling blocks
- **Write every content field.** Nothing is filled in for you; a field you skip ships empty. This is
  the most common way a generated page looks unfinished.
- **Arrays need every item.** Four stats means four entries, each with its own copy — not one.
- **Match the shape \`list_blocks\` shows for each field, exactly.** It is taken from what the block
  really renders. \`plain text\` means no markup — wrapping it in \`<p>\` puts visible tags on the page.
  \`HTML, e.g. <h1>…\` means write that markup. \`{ url, text }\` means those keys, not \`label\`.
- **\`array of { … } — write EVERY item\`** means every item, fully filled. Four stats means four
  entries each with its own numbers and copy. An array of empty objects is worse than no array.
- Image fields already hold a correctly-proportioned placeholder. Replace \`src\` only with a real
  asset from \`search_assets\`; otherwise leave the placeholder, which shows the intended size.
- A full page normally opens with the \`header\` block and closes with \`footer\`, both with empty
  values — they are site chrome with nothing to author. Omit them when asked for a single section.
${attachedCount > 0 ? `\nThe user attached ${attachedCount} image(s) to this conversation. They are in the asset store and marked \`attached: true\` in search_assets results — prefer them.\n` : ''}${composition ? `\n## Already on the canvas\n${composition}\n\nA follow-up almost certainly refers to one of these. When the user asks for a change, propose the WHOLE page again with that change made — the proposal replaces what is there.\n` : ''}
## What a finished page looks like here
Real pages on this site run to a dozen sections or more, and they alternate background treatment —
a coloured band every third or fourth section, never one flat colour throughout. A four-section page
reads as a fragment. Follow whichever shape fits, adapting the sections to the brief:

${exemplars}

Backgrounds: pick real values from the field's own \`one of …\` list. The hero and the final CTA
usually carry a brand colour; light and white alternate between them; a dark section breaks up the
middle. Never set the same background on every block.

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
  const seenAssetSrcs = new Set<string>();
  // One retry only; see the gap handler below.
  let askedForGaps = false;

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

      // Terminal. No scaffolding check any more: the server scaffolds every block itself while
      // building the args, so there is no step the model can skip. The enforcement existed only to
      // catch that, and removing the possibility is better than policing it.
      if (call.name === 'propose_page') {
        const raw = Array.isArray(parsed.blocks) ? (parsed.blocks as { componentId?: unknown; values?: unknown }[]) : [];
        const { blocks, problems, gaps } = await buildBlocks(raw, seenAssetSrcs);

        // Ask once for the content it skipped. Templates are seeded from real previews, so an
        // unfilled field is not empty — it is somebody's sample copy, and shipping that produces a
        // page that looks finished and is not. Once only: a second ask rarely helps and the honest
        // fallback is a visibly incomplete page rather than a plausible fake one.
        if (gaps.length && !askedForGaps) {
          askedForGaps = true;
          console.log('[playground-chat] asking for unfilled content', JSON.stringify(gaps));
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              incomplete: true,
              reason:
                'These content fields are empty. Nothing fills them for you — an unwritten field ships ' +
                'blank. Write real values (arrays need EVERY item authored, not one) and call ' +
                'propose_page again with the complete set of blocks.',
              missing: gaps,
            }),
          });
          continue;
        }

        if (!blocks.length) {
          // Every block failed to resolve — usually invented component ids. Hand it back so the model
          // can pick real ones from the catalog rather than ending the turn on a dead proposal.
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              rejected: true,
              reason: 'None of those blocks resolved. Use ids exactly as returned by list_blocks.',
              problems,
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
        result = await runTool(call.name, parsed, attached, seenAssetSrcs);
      } catch (e) {
        // Feed the failure back rather than aborting the turn — the model can pick another block or
        // explain itself, which is far more useful than a dead conversation.
        result = { error: e instanceof Error ? e.message : 'Tool failed.' };
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 24_000) });
    }
  }

  // Say what actually happened rather than blaming the user for a limit they cannot see. With the
  // catalog available in one call this should now be close to unreachable — reaching it means
  // something is genuinely wrong, so it reads as our problem, not theirs.
  const exhausted =
    `I got stuck working out the page — I made ${toolsUsed.length} attempts without settling on one. ` +
    'That is a bug on our side rather than something wrong with your request. Try again, or describe the page in fewer sections.';
  emit({ type: 'reply', content: exhausted });
  console.warn('[playground-chat] round cap hit', { rounds: MAX_TOOL_ROUNDS, tools: toolsUsed });
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
      description: 'Return the single replacement block. Terminal — call once.',
      parameters: {
        type: 'object',
        properties: {
          componentId: { type: 'string' },
          values: { type: 'object', description: 'CONTENT ONLY, keyed by the field names from list_blocks.' },
          note: { type: 'string', description: 'One short sentence on what changed and why.' },
        },
        required: ['componentId', 'values'],
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

Call list_blocks once to see what is available, then call propose_block ONCE with the component id and
your content. Carry over anything worth keeping from the current block. Returning the same componentId
is fine when the request is about the copy rather than the layout.
${brandVoice ? `\n## Brand voice — any copy you write must obey this\n${brandVoice.slice(0, 3000)}\n` : ''}`,
    },
    { role: 'user', content: args.instruction },
  ];

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
        const { blocks, problems } = await buildBlocks([{ componentId: parsed.componentId, values: parsed.values }]);
        if (!blocks.length) {
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              rejected: true,
              reason: 'That block did not resolve. Use an id exactly as returned by list_blocks.',
              problems,
            }),
          });
          continue;
        }
        return { ok: true, block: blocks[0], note: typeof parsed.note === 'string' ? parsed.note : undefined };
      }

      let result: unknown;
      try {
        result = await runTool(call.name, parsed, []);
      } catch (e) {
        result = { error: e instanceof Error ? e.message : 'Tool failed.' };
      }
      convo.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 24_000) });
    }
  }

  return { ok: false, error: 'Could not settle on a replacement. Try describing what you want instead.' };
}
