import 'server-only';

import { getDataProvider } from '@/lib/data';
import { openAiChatTools, type OpenAiTool } from '@/lib/server/ai-client';
import { formatBrandVoiceForPrompt, getDesignWorkspace } from '@/lib/server/design-workspace';
import { scaffoldArgsForComponent } from '@/lib/server/scaffold-args';
import { blankContentValues, mergeBlockValues, placeholderImageUrl, summarizeFields } from '@/lib/merge-block-values';
import { formatExemplars } from '@/lib/page-exemplars';
import { buildImagePrompt } from '@/lib/image-generation-request';
import { describeImagePlacement, imageFieldsFor, resolveImageTarget, valueForImageTarget } from '@/lib/image-target';
import {
  describeMissingImagery,
  describeOptionalGaps,
  describeReplacedImages,
  findPlaceholderImages,
  findUnplacedImages,
  imageGapInstruction,
  unplacedImageInstruction,
} from '@/lib/placeholder-audit';
import { summarizeError } from '@/lib/error-summary';
import { packToBudget, purposeLine, truncationNote } from '@/lib/tool-payload';
import { looseMatchNote } from '@/lib/asset-search';
import { readCapabilities } from '@/lib/slot-capabilities';
import { describeTurn, flagsFor, type TurnFacts, type TurnRetry } from '@/lib/turn-log';
import { logAiEvent } from '@/lib/server/event-log';
import { applyOps, parseEditEntries, verifyOps, type EditOp, type PageBlock } from '@/lib/edit-operations';
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
  proposal?: { blocks: ProposedBlock[]; rationale: string; notices?: string[] };
  /** Present when the model called `propose_edits`. Targeted changes to what is already there. */
  changeset?: { ops: EditOp[]; summary: string; rejected: { reason: string }[] };
  /** Tool names invoked this turn, in order. Surfaced for the UI to show its working. */
  toolsUsed: string[];
  /**
   * Images this turn kicked off. Each is already referenced in the page as a placeholder; the client
   * polls these and swaps in the real src as they land.
   */
  queuedImages?: QueuedImage[];
  /**
   * What the turn did, as recorded in the log.
   *
   * Returned rather than only logged so an eval asserts on the *same numbers production reports*. Two
   * definitions of "did it work" drifting apart is the failure this whole line of work keeps hitting;
   * one is cheap to avoid here.
   */
  facts?: TurnFacts;
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
  | {
      type: 'proposal';
      blocks: ProposedBlock[];
      rationale: string;
      /**
       * Values that were refused while building these blocks — a refused image src, most often.
       *
       * The proposal event had no channel for this at all, so on a fresh page a chosen-and-rejected
       * image was invisible: the reply said the slots held placeholders, and never that an image had
       * been picked and thrown away. Named `notices` rather than `rejected` because nothing was dropped
       * from the proposal; a value inside it was substituted.
       */
      notices?: string[];
    }
  | { type: 'changeset'; ops: EditOp[]; summary: string; rejected: { reason: string }[] }
  | { type: 'images'; queued: QueuedImage[] }
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
    case 'request_image': {
      const t = typeof args.title === 'string' ? args.title.trim() : '';
      return t ? `Generating an image: ${t}…` : 'Generating an image…';
    }
    case 'propose_page':
      return 'Putting the page together…';
    case 'propose_edits':
      return 'Working out what to change…';
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
        'The block catalog for CHOOSING: every block, with its group and one line on what it is for. ' +
        'Call this ONCE with no arguments and pick from the result — the whole catalog fits in one ' +
        'response. It does not include field names; call describe_blocks for the blocks you decide to ' +
        'use. Read the `use` line before choosing: several blocks hold copy and they are not ' +
        'interchangeable.',
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
      name: 'describe_blocks',
      description:
        'The editable fields of specific blocks, with the shape each field takes. Call this once for ' +
        'every block you intend to use, in a single call, after choosing from list_blocks and before ' +
        'proposing. Authoring without it means guessing field names, and a guessed field is dropped.',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'The block ids you are going to use, all of them in one call.',
          },
        },
        required: ['ids'],
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
      name: 'request_image',
      description:
        'Generate an image that the asset store does not have, for ONE named slot on ONE block that is ' +
        'already on the canvas. Search first — this is the fallback, not the default, and a real photo ' +
        'from the library beats a generated one. Returns `value`, already in the shape that slot ' +
        'accepts: a labelled placeholder that swaps itself for the real image a minute or two later. ' +
        'You must still write it in with propose_edits — requesting does not place. Say in your reply ' +
        'which images are being generated. Capped per turn.',
      parameters: {
        type: 'object',
        properties: {
          index: {
            type: 'integer',
            description:
              'ZERO-based position of the block on the canvas — the same convention as propose_edits, so ' +
              'block 1 in the listing is index 0. Required: an image with no destination is generated, ' +
              'paid for, and lands nowhere.',
          },
          field: {
            type: 'string',
            description:
              'The exact image field on that block, e.g. "desktopImageSlot". Not "src" and not ' +
              '"image" — those are not field names. Get it wrong and the reply lists the real ones.',
          },
          prompt: {
            type: 'string',
            description:
              'What to depict, as a photography or illustration brief. Describe the subject, setting ' +
              'and mood. No text or logos — generated lettering renders as gibberish.',
          },
          title: { type: 'string', description: 'Short name for the asset library, e.g. "Nurse using a tablet".' },
          altText: { type: 'string', description: 'Alt text for the image.' },
          orientation: {
            type: 'string',
            enum: ['landscape', 'portrait', 'square'],
            description: 'Shape the slot needs. Landscape for heroes and cards; square for avatars and logos.',
          },
        },
        required: ['index', 'field', 'prompt', 'title'],
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
      name: 'propose_edits',
      description:
        'Change specific blocks on the page that already exists. USE THIS, not propose_page, whenever ' +
        'the canvas has blocks and the request is a change rather than a fresh start — "shorten the ' +
        'headline", "swap the hero", "add a pricing section", "drop the FAQ". Re-proposing the whole ' +
        'page to change one field re-rolls copy the user was happy with.',
      parameters: {
        type: 'object',
        properties: {
          edits: {
            type: 'array',
            description: 'Operations against the numbered blocks shown under "Already on the canvas".',
            items: {
              type: 'object',
              properties: {
                op: {
                  type: 'string',
                  enum: ['update', 'replace', 'insert', 'remove'],
                  description:
                    'Which change to make. `update` keeps the block and changes its field values — copy, ' +
                    'images, links, theme. `replace` puts a DIFFERENT component in that position: use it ' +
                    'whenever the user asks to change what a block IS ("make this a stats block", "use a ' +
                    'carousel here", "switch this to two columns"), because `update` cannot change a ' +
                    "block's type and will leave it as it was. `insert` adds a new block at a position. " +
                    '`remove` deletes one.',
                },
                index: { type: 'number', description: 'ZERO-based position. Block 1 in the listing is index 0.' },
                expect: {
                  type: 'string',
                  description:
                    'The component id you believe is at that index. Required for update, replace and ' +
                    'remove. If it does not match, the operation is rejected rather than applied to the ' +
                    'wrong block.',
                },
                componentId: { type: 'string', description: 'The NEW component, for replace and insert.' },
                values: {
                  type: 'object',
                  description:
                    'For update: only the fields that change — everything else is kept. For replace and ' +
                    'insert: the full content for the new block.',
                },
              },
              required: ['op', 'index'],
            },
          },
          summary: { type: 'string', description: 'One line describing the change, for the user.' },
        },
        required: ['edits', 'summary'],
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
          replacesExistingPage: {
            type: 'boolean',
            description:
              'Set true ONLY if the user asked to start the page over. Proposing a page while the canvas ' +
              'has blocks discards their copy, imagery and links — for a change to what is there, use ' +
              'propose_edits instead.',
          },
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
): Promise<{
  blocks: ProposedBlock[];
  problems: string[];
  gaps: { componentId: string; fields: string[] }[];
  /** Empty optional fields, for telling the user rather than asking the model. */
  optionalGaps: { componentId: string; fields: string[] }[];
  /**
   * Per-block field names the model used that the component does not have, plus the names it does.
   *
   * Returned rather than only logged because `propose_edits` needs it: an update whose every named
   * field was unknown produces an edit that changes nothing and still reports "Applied", which is how
   * a mistyped field name reads to the user as a silent lie.
   */
  rejectedFields: { componentId: string; unknown: string[]; available: string[] }[];
  /**
   * Values the merge refused — an invented image src, an out-of-enum theme.
   *
   * Returned rather than only logged. A live run invented three image srcs, had all three replaced with
   * placeholders, was asked to try again, and proposed the same three: the retry never told it what had
   * been rejected, so it had no reason to do anything different. Same shape as the unknown-key bug.
   */
  invalidValues: { componentId: string; problems: string[] }[];
  /**
   * Images swapped for a placeholder, flat and per field, for telling the **user**.
   *
   * `invalidValues` above carries the same fact phrased for the model. Both are needed: the model has to
   * be told to use a verbatim asset src, and the person has to be told their hero is a stand-in. Only
   * the first existed, which is why an edit could report success with no image and no explanation.
   */
  replacedImages: { componentId: string; field: string }[];
  /**
   * The fields the model named, per built block, **after** name correction.
   *
   * Returned so `propose_edits` does not re-derive them from the raw input. It did, and the two
   * disagreed: `mergeBlockValues` corrected `buttonSlot` to `buttonSlots` and wrote it into the args,
   * while the caller filtered by the original spelling, found nothing, and rejected the whole update as
   * naming no fields. The correction worked and the edit was still lost.
   *
   * Two callers deriving one value is the most expensive recurring bug in this codebase. The fix is not
   * to correct the second derivation; it is to have only one.
   */
  namedKeys: string[][];
}> {
  const blocks: ProposedBlock[] = [];
  const problems: string[] = [];
  const gaps: { componentId: string; fields: string[] }[] = [];
  const optionalGaps: { componentId: string; fields: string[] }[] = [];
  const rejectedFields: { componentId: string; unknown: string[]; available: string[] }[] = [];
  const invalidValues: { componentId: string; problems: string[] }[] = [];
  const replacedImages: { componentId: string; field: string }[] = [];
  const namedKeys: string[][] = [];

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
    const {
      args,
      unknownKeys,
      invalidValues: invalid,
      replacedImages: replaced,
      correctedFields,
      unfilled,
      unfilledOptional,
    } = mergeBlockValues(template, values, scaffold.fields, knownAssetSrcs);
    if (unknownKeys.length) {
      // Surfaced rather than swallowed: a model that keeps inventing the same field name is a prompt
      // problem, and silently dropping it is how that goes unnoticed for weeks.
      console.warn('[playground-chat] unknown fields on', componentId, unknownKeys.join(', '));
      rejectedFields.push({ componentId, unknown: unknownKeys, available: Object.keys(template) });
    }
    if (invalid.length) {
      console.warn('[playground-chat] rejected values on', componentId, invalid.join('; '));
      invalidValues.push({ componentId, problems: invalid });
    }
    for (const { field } of replaced) replacedImages.push({ componentId, field });
    if (correctedFields.length) {
      // An acceptance, not a rejection — the change landed. Logged because a model repeatedly needing the
      // same correction is a prompt problem, and this is where that becomes visible.
      console.log(
        '[playground-chat] corrected field names on',
        componentId,
        correctedFields.map((c) => `${c.from}→${c.to}`).join(', ')
      );
    }
    if (unfilled.length) gaps.push({ componentId, fields: unfilled });
    // Reported to the user, never retried on. See `MergeResult.unfilledOptional`.
    if (unfilledOptional.length) optionalGaps.push({ componentId, fields: unfilledOptional });

    // What the model asked to set, in the component's own spelling. `correctedFields` maps each slip to
    // the real name; everything else it named is already real.
    const corrections = new Map(correctedFields.map((c) => [c.from, c.to]));
    const unknown = new Set(unknownKeys);
    namedKeys.push(
      Object.keys(values)
        .filter((k) => !unknown.has(k))
        .map((k) => corrections.get(k) ?? k)
    );

    blocks.push({ componentId, args });
  }

  return { blocks, problems, gaps, optionalGaps, rejectedFields, invalidValues, replacedImages, namedKeys };
}

/**
 * Ceiling on generated images per turn.
 *
 * An image is the most expensive thing in this loop by an order of magnitude, and "build me a product
 * page" could plausibly justify one per section. Three covers a hero plus a couple of supporting
 * shots; beyond that the honest answer is that the library is missing imagery, which is a thing to fix
 * in the library rather than paper over per page.
 */
const MAX_GENERATED_IMAGES_PER_TURN = 3;

/**
 * Budgets for the two catalog tools, both comfortably under the 24,000-character tool-result cap.
 *
 * Headroom on purpose: the cap is applied by slicing the serialized JSON, so a payload that reaches it
 * is not merely trimmed but malformed. Staying clear of it means the slice never fires.
 */
const LIST_BLOCKS_BUDGET = 20_000;
const DESCRIBE_BLOCKS_BUDGET = 18_000;
/** Enough for a whole page's worth of blocks in one call, not the whole catalog. */
const MAX_DESCRIBED_BLOCKS = 12;

/** The tools that actually change the page. Requesting an image is not one of them. */
function isPlacementTool(name: string): boolean {
  return name === 'propose_edits' || name === 'propose_page';
}

/** A generation the turn kicked off. Carried back so the client knows what to poll for and swap. */
export interface QueuedImage {
  jobId: number;
  title: string;
  placeholderSrc: string;
  /**
   * Set when the request could not even be enqueued. Carried back rather than swallowed: a failure
   * that only the model sees is a failure the user experiences as nothing happening at all, which is
   * exactly how the first live run presented.
   */
  error?: string;
}

interface ImageRequestContext {
  /** FK to `user.id` — the job table requires it, so a turn with no user cannot generate. */
  actorUserId: string | null;
  /** Whether blocks are already on the canvas. Generation needs a slot that exists to swap into. */
  hasCanvas: boolean;
  /**
   * The canvas itself, so `request_image` can check where the picture is going *before* generating it.
   *
   * Only `hasCanvas` was here, which is why the target could not be validated: the tool knew a page
   * existed but not what was on it, so it could only hand back a src and hope.
   */
  blocks: { componentId: string }[];
  /** The workspace's design guidance, so generated imagery matches the system it is going into. */
  styleGuidance: string;
  queued: QueuedImage[];
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  preferredAssetIds: string[],
  /** Collects every src the store returned, so an invented URL can be told from a real one. */
  seenAssetSrcs?: Set<string>,
  imageCtx?: ImageRequestContext
): Promise<unknown> {
  const provider = getDataProvider();

  if (name === 'list_blocks') {
    const group = typeof args.group === 'string' ? args.group.toLowerCase().trim() : '';
    let list = await provider.getComponents();
    if (group) list = list.filter((c) => (c.group || '').toLowerCase() === group);

    /**
     * Selection, not authoring. Id, title, group and one line on what the block is *for*.
     *
     * This carried a field summary per component and came to 32,270 characters against a 24,000 cap
     * applied by slicing the serialized string — so 16 of 77 components silently never arrived, the last
     * of them alphabetically after `simple-copy`, and the payload was invalid JSON. A ten-section brief
     * came back as six consecutive `simple-copy` blocks because the alternatives were not in the list.
     *
     * The purpose line is the other half. The registry has held an authored description for every block
     * all along and this sent none of it, so the model chose from ids and field names — and
     * `simple-copy`, whose own guidance says "legal pages, terms, and informational text", looks like a
     * safe default for any text at all.
     *
     * Field shapes come from `describe_blocks` for the handful actually chosen. Cheaper as well as
     * complete: this result is replayed on every subsequent round of the loop, so the full catalog's
     * field summaries were being paid for repeatedly.
     */
    const rows = list.map((c) => ({
      id: c.id,
      title: c.title,
      group: c.group,
      /**
       * Authored guidance first, description second.
       *
       * `should_do[0]` is written as an instruction — "Use for simple copy blocks such as legal pages,
       * terms, and informational text" — and it is the line that discriminates. The description says
       * "a component for simple rich-text copy blocks with optional CTA buttons", which sounds ideal for
       * any copy section and is why five of them ended up on a marketing page. It is also *shorter*:
       * 10.5k for the whole catalog against 11.9k.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      use: purposeLine((c as any).should_do?.[0] ?? (c as any).shouldDo?.[0] ?? (c as any).description),
    }));

    const packed = packToBudget(rows, LIST_BLOCKS_BUDGET);
    const note = truncationNote(
      packed.dropped,
      rows.length,
      'Call list_blocks again with a `group` to see the rest.'
    );
    return note ? { blocks: packed.items, note } : packed.items;
  }

  if (name === 'describe_blocks') {
    const ids = Array.isArray(args.ids) ? args.ids.map((i) => String(i).trim()).filter(Boolean) : [];
    if (!ids.length) return { error: 'Pass the ids of the blocks you intend to use.' };

    const list = await provider.getComponents();
    const byId = new Map(list.map((c) => [String(c.id), c]));
    const missing = ids.filter((id) => !byId.has(id));

    const rows = ids
      .slice(0, MAX_DESCRIBED_BLOCKS)
      .map((id) => byId.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const comp = c as any;
        // Shapes from a real preview's values, so `buttonSlots` is described as whatever this component
        // actually uses rather than guessed from its declared type.
        const previews = (comp?.previews ?? {}) as Record<string, { values?: Record<string, unknown> }>;
        const key = 'generic' in previews ? 'generic' : Object.keys(previews)[0];
        const values = key ? (previews[key]?.values ?? (previews[key] as Record<string, unknown>)) : null;
        return {
          id: c.id,
          title: c.title,
          fields: summarizeFields(
            comp?.properties ?? null,
            values as Record<string, unknown> | null,
            undefined,
            readCapabilities(comp)
          ),
        };
      });

    const packed = packToBudget(rows, DESCRIBE_BLOCKS_BUDGET);
    return {
      blocks: packed.items,
      ...(missing.length ? { unknownIds: missing } : {}),
      ...(ids.length > MAX_DESCRIBED_BLOCKS
        ? { note: `Only the first ${MAX_DESCRIBED_BLOCKS} ids were described; ask again for the rest.` }
        : {}),
      ...(packed.dropped
        ? { note: truncationNote(packed.dropped, rows.length, 'Ask for fewer blocks at a time.') }
        : {}),
    };
  }

  if (name === 'search_assets') {
    const { listAssets } = await import('@/lib/db/queries');
    const { findAssets } = await import('@/lib/server/find-assets');
    const q = typeof args.query === 'string' ? args.query.trim() : '';
    // Two queries rather than one: the search narrows by the asset's text, but anything the user attached
    // must surface regardless of what they called it — they uploaded it FOR this page.
    //
    // `findAssets` owns the precise-then-loose policy so MCP's search behaves the same way. It lived here
    // inline, which is exactly how MCP ended up with the term matching and none of the fallback.
    const [found, all] = await Promise.all([
      findAssets({ assetType: 'image', status: 'active', limit: 60, ...(q ? { search: q } : {}) }),
      preferredAssetIds.length ? listAssets({ assetType: 'image', status: 'active', limit: 200 }) : Promise.resolve([]),
    ]);
    const matches = found.rows;
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

    const results = out.slice(0, 25);
    // A loose match is weaker evidence and the model should be able to tell: "students" returned for
    // "lecture hall" may be the right picture or merely the nearest one.
    return found.loose ? { results, note: looseMatchNote(q) } : results;
  }

  if (name === 'request_image') {
    if (!imageCtx?.actorUserId) {
      return { error: 'Image generation is unavailable in this session. Leave the image empty.' };
    }
    // **No canvas, no generation.** A picture made while composing a page that has not been applied has
    // nowhere to land: the slot does not exist yet, so the swap finds nothing and the image waits
    // forever. Two live runs died exactly there. Propose the page with placeholders, let the user apply
    // it, then fill — by which point every slot is real and the swap always has a target.
    if (!imageCtx.hasCanvas) {
      return {
        error:
          'No page is on the canvas yet, so a generated image would have nowhere to go. Propose the page ' +
          'with placeholders in the image fields, tell the user which slots are unfilled, and offer to ' +
          'fill them once they apply it.',
      };
    }
    if (imageCtx.queued.length >= MAX_GENERATED_IMAGES_PER_TURN) {
      return {
        error: `Already generating ${MAX_GENERATED_IMAGES_PER_TURN} images this turn, which is the cap. Use a library asset or leave the image empty.`,
      };
    }

    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'Generated image';
    if (!prompt) return { error: 'A prompt is required.' };

    // **Resolve the destination before spending anything.** Generation costs real money and a minute of
    // compute; a target that turns out not to exist afterwards is a paid-for image with nowhere to go,
    // which is precisely what shipped. Rejecting here is free, and the error names the real fields so
    // the retry is informed rather than a second guess.
    const scaffold = await scaffoldArgsForComponent(
      imageCtx.blocks[Number(args.index)]?.componentId ?? ''
    ).catch(() => null);
    const target = resolveImageTarget({
      blocks: imageCtx.blocks,
      index: args.index,
      field: args.field,
      fields: scaffold && !('error' in scaffold) ? scaffold.fields : undefined,
    });
    // `'error' in target`, not `!target.ok`. The app compiles with `strictNullChecks: false`, and under
    // that setting TypeScript does not narrow a union on a boolean discriminant — `!target.ok` leaves
    // the type unnarrowed and `target.error` fails to compile. The `in` operator narrows under both
    // settings, and is the idiom the scaffold check above already uses.
    if ('error' in target) {
      // Logged, because a run that burns nine `request_image` calls to queue three images is invisible
      // otherwise — the tool result goes to the model and nowhere else, so the loop looks like the model
      // being indecisive rather than a target it keeps getting wrong.
      console.warn('[playground-chat] image target refused', { index: args.index, field: args.field, reason: target.error });
      return { error: target.error };
    }

    const orientation = typeof args.orientation === 'string' ? args.orientation : 'landscape';
    const [w, h] = orientation === 'portrait' ? [1024, 1536] : orientation === 'square' ? [1024, 1024] : [1536, 1024];

    // The placeholder is returned *now* so the proposal is complete and applicable immediately. It is
    // also registered as a known src, or `mergeBlockValues` would strip it as fabricated — the same
    // guard that stops the model inventing asset URLs.
    const placeholderSrc = placeholderImageUrl(w, h, title);
    seenAssetSrcs?.add(placeholderSrc);

    const { insertDesignGenerationJob } = await import('@/lib/db/queries');
    let jobId: number;
    try {
      jobId = await insertDesignGenerationJob({
        artifactId: null,
        userId: imageCtx.actorUserId,
        requestParams: {
          intent: 'asset',
          // Same composition the block editor's Generate uses — the no-text rule and the house style
          // matter identically from either entry point, and generated lettering is the failure most
          // likely to be mistaken for a real word on a marketing page.
          prompt: buildImagePrompt(prompt, imageCtx.styleGuidance),
          title,
          altText: typeof args.altText === 'string' ? args.altText : title,
          size: `${w}x${h}`,
          quality: 'medium',
          tags: ['playground'],
          brief: prompt,
          placeholderSrc,
        },
      });
    } catch (err) {
      // Logged, and reported to the user via the images card — not just handed back to the model,
      // which may narrate success regardless.
      const message = summarizeError(err);
      console.error('[playground-chat] could not enqueue image generation', message);
      imageCtx.queued.push({ jobId: 0, title, placeholderSrc, error: message });
      return { error: `Could not start image generation: ${message}. Use the placeholder src anyway.`, src: placeholderSrc };
    }

    console.log('[playground-chat] queued image generation', { jobId, title, target: `${target.position}.${target.field}` });
    imageCtx.queued.push({ jobId, title, placeholderSrc });
    // The value, already in the encoding this slot was measured to accept — not a src for the model to
    // wrap however it guesses. `array-of-image-object` needs a one-item array, and an object there is
    // the same silent no-op in a different costume.
    return {
      value: valueForImageTarget(target.encoding, {
        src: placeholderSrc,
        alt: typeof args.altText === 'string' ? args.altText : title,
      }),
      status: 'generating',
      note: describeImagePlacement(target),
    };
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

You do not write CSS. You choose blocks from the catalog, write their copy, and fill their props with
values shaped exactly as the scaffold tells you.

## How to work — this should take two or three tool calls, not ten
1. Ask ONE round of clarifying questions if the request is genuinely vague. One round only.
2. \`list_blocks\` ONCE, with no arguments. That is the entire catalog with every block's fields. Read
   it and choose. Do NOT call it repeatedly for different sections.
3. **Decide the whole page** — every block, in order, with its copy written.
4. \`search_assets\` for the image fields, and \`search_icons\` if the page needs icons. Use whatever the
   store already has.
5. \`propose_page\` with all the blocks, your copy, and any srcs those searches returned.

**The turn is not finished until \`propose_page\` runs.** A page the user can apply is the deliverable.

## Imagery comes after the page, not during it
Building a page and generating pictures are two turns, deliberately:

- **Composing a new page:** leave image fields on their placeholders. \`request_image\` is unavailable —
  a picture generated now has nowhere to land, because the slot does not exist until the page is
  applied. Propose the page, name the slots you left empty, and offer to fill them once it is applied.
- **A page already on the canvas:** \`request_image\` works normally, and generated pictures swap into
  their slots as they finish.

This also means the user sees the page before paying for images, and can say which ones they actually
want.

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
- Image fields already hold a correctly-proportioned placeholder. Replace \`src\` only with a src a
  tool gave you — \`search_assets\` or \`request_image\`. Never write an image path yourself.
- **Search before you generate.** A real photo from the library beats a generated one, and generation
  costs real money. Use \`request_image\` only where the page genuinely needs a picture the library
  does not have — a hero, a main feature shot. Leave decorative slots on their placeholder. It is only
  available once a page is on the canvas; see above.
- **\`request_image\` does not put anything on the page.** It returns a src; you must still write that
  src into the block with \`propose_edits\` (or \`propose_page\`) in the same turn. Requesting an image
  and then only describing it leaves the page unchanged — this is the most common way to get this
  wrong. Mention the generation in your reply *as well as* making the edit, never instead of it.
- Choosing then authoring is two calls: \`list_blocks\` once to see every block and what each is for,
  then one \`describe_blocks\` call naming every block you decided on, which gives you their field
  names and shapes. Several blocks hold copy and they are not interchangeable — \`simple-copy\` is for
  legal and informational text, not for a marketing section that wants media beside it.
- A full page normally opens with the \`header\` block and closes with \`footer\`, both with empty
  values — they are site chrome with nothing to author. Omit them when asked for a single section.
${attachedCount > 0 ? `\nThe user attached ${attachedCount} image(s) to this conversation. They are in the asset store and marked \`attached: true\` in search_assets results — prefer them.\n` : ''}${composition ? `\n## Already on the canvas\n${composition}\n\nA follow-up almost certainly refers to one of these. Use \`propose_edits\` to change them — the numbering above is 1-based for reading, so block 1 is index 0. Only use \`propose_page\` if the user wants to start over.\n` : ''}
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
Keep replies short. The user is watching a page get built, not reading an essay.

**Describe only what you actually did.** If image slots are still on placeholders, say so — "I left the
gallery images empty, ask me to generate them" is useful. Claiming imagery you did not add is worse than
leaving an obvious gap, because the gap is visible and the claim is not.`;
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

  // Annotated with each block's image fields, resolved from its measured capabilities. One scaffold
  // lookup per block, once per turn — cheap against the alternative, which was the model guessing a
  // field name and stranding an image it had already paid for.
  const canvas = args.currentBlocks ?? [];
  const composition = summarizeComposition(
    await Promise.all(
      canvas.map(async (b) => {
        const scaffold = await scaffoldArgsForComponent(b.componentId).catch(() => null);
        return {
          ...b,
          imageFields: scaffold && !('error' in scaffold) ? imageFieldsFor(scaffold.fields) : [],
        };
      })
    )
  );
  const convo: unknown[] = [
    { role: 'system', content: systemPrompt(brandVoice, workspace?.designMd ?? '', attached.length, composition) },
    ...args.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const toolsUsed: string[] = [];
  const seenAssetSrcs = new Set<string>();
  const imageCtx: ImageRequestContext = {
    actorUserId: args.actorUserId ?? null,
    hasCanvas: (args.currentBlocks ?? []).length > 0,
    blocks: (args.currentBlocks ?? []).map((b) => ({ componentId: b.componentId })),
    styleGuidance: workspace?.designMd ?? '',
    queued: [],
  };
  /**
   * Announce any generations this turn started, immediately before the turn ends.
   *
   * Every terminal path calls this rather than each remembering to: the images were enqueued during
   * the tool loop and are already running, so a return that forgets to report them leaves the user
   * with placeholders that silently become real, or never do.
   */
  const finish = <T extends PlaygroundChatTurn>(turn: T): T => {
    if (imageCtx.queued.length) emit({ type: 'images', queued: imageCtx.queued });

    // Record what the turn *did*, not what it said. Prose is exactly what goes wrong — a page was
    // narrated in detail that had never been proposed — so the tool sequence and every retry reason go
    // to the log where one run can be diagnosed instead of inferred.
    const proposedBlocks = turn.proposal?.blocks ?? [];
    /**
     * Where a generated image could have landed — a proposed block, or an edit op's values.
     *
     * `unplacedImages` counted only proposal blocks, so **every changeset that generated an image was
     * logged as stranding it**, however correctly it was placed. Caught by the eval suite: after the
     * placement fix `gallery-four-images` went green while `fill-the-images` stayed red on the
     * invariant alone, with its own placement check passing — the two disagreeing is what exposed it.
     * A metric that cries wolf on a working path is worse than no metric; this was in production logs.
     */
    const placedIn = proposedBlocks.length
      ? proposedBlocks
      : (turn.changeset?.ops ?? []).map((op) => ({
          args: ('values' in op ? op.values : {}) as Record<string, unknown>,
        }));
    const facts: TurnFacts = {
      prompt: (args.messages.filter((m) => m.role === 'user').pop()?.content ?? '').slice(0, 500),
      rounds: roundsUsed,
      toolsUsed,
      retries,
      outcome: turn.proposal ? 'proposal' : turn.changeset ? 'changeset' : exhaustedTurn ? 'exhausted' : 'reply-only',
      hasCanvas: imageCtx.hasCanvas,
      blocks: proposedBlocks.length,
      queuedImages: imageCtx.queued.length,
      placeholderImages: findPlaceholderImages(proposedBlocks).length,
      unplacedImages: findUnplacedImages(placedIn, imageCtx.queued).length,
      durationMs: Date.now() - startedAt,
    };
    console.log('[playground-chat]', describeTurn(facts));
    void logAiEvent({
      eventType: 'ai.playground_turn',
      // Not a model call — a summary of the whole turn, which may span several. The model column is
      // required, so it names the loop rather than pretending to be one request.
      model: 'playground-chat-turn',
      actorUserId: args.actorUserId ?? undefined,
      route: '/api/handoff/ai/playground-chat',
      durationMs: facts.durationMs,
      status: Object.values(flagsFor(facts)).some(Boolean) ? 'error' : 'success',
      metadata: { ...facts, flags: flagsFor(facts) },
    }).catch(() => {});

    return { ...turn, facts, ...(imageCtx.queued.length ? { queuedImages: imageCtx.queued } : {}) };
  };
  // One retry only; see the gap handler below.
  const startedAt = Date.now();
  const retries: TurnRetry[] = [];
  /** Every guard that fired, so a failed turn can be read from the log instead of inferred from prose. */
  const noteRetry = (kind: string, detail?: string) => retries.push({ kind, ...(detail ? { detail } : {}) });

  /** One-shot: the whole-page-rebuild refusal fires once, then the model's second choice stands. */
  let refusedWholePageRebuild = false;
  let askedForGaps = false;
  // Likewise one-shot: ask once for imagery the composition left on placeholders.
  let askedForImages = false;
  // Likewise: nudge once if images were requested but never written into a block.
  let askedToPlaceImages = false;

  /**
   * The last page we actually built, kept so a retry can never destroy it.
   *
   * Every guard that asks the model to try again is a chance for it to answer with prose instead, and
   * then the turn ends with nothing to apply — a page that existed, was set aside to ask for one
   * improvement, and never came back. That is not a hypothetical: reporting three rejected image srcs
   * turned a working eight-block proposal into a reply claiming "no placeholders or broken links" and
   * zero blocks.
   *
   * An imperfect page beats no page, so the fallback is unconditional.
   */
  let lastBuiltProposal: { blocks: ProposedBlock[]; rationale: string; notices?: string[] } | null = null;

  let roundsUsed = 0;
  let exhaustedTurn = false;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    roundsUsed = round + 1;
    // Checked between rounds rather than mid-call: the in-flight request finishes either way, but we
    // stop paying for the next one.
    if (args.signal?.aborted) return { reply: '', toolsUsed };

    const { content, toolCalls } = await openAiChatTools(convo, TOOLS, {
      actorUserId: args.actorUserId ?? null,
      route: '/api/handoff/ai/playground-chat',
      eventType: 'ai.playground_chat',
    });

    if (!toolCalls.length) {
      // Requesting an image and then only describing it leaves the page untouched — which is exactly
      // how the first live run failed. The prompt says so; this is the check that the prompt worked.
      // Once only, matching the unfilled-content gap: a model that ignores the second ask will ignore
      // a third, and an honest reply beats a loop.
      // Ending with prose and no proposal is a dead turn: the user gets a paragraph and nothing to
      // apply. Fires when images were generated but nothing was composed, and also when the catalog was
      // read and nothing came of it — both are "you did the setup and stopped".
      const composedNothing = !toolsUsed.some(isPlacementTool) && (imageCtx.queued.length > 0 || toolsUsed.includes('list_blocks'));
      if (composedNothing && !askedToPlaceImages) {
        askedToPlaceImages = true;
        noteRetry('no-proposal');
        console.warn('[playground-chat] images requested but never placed; asking once', {
          queued: imageCtx.queued.map((q) => q.jobId),
        });
        convo.push({
          role: 'user',
          content:
            'You have not proposed a page or an edit, so there is nothing for me to apply — the turn is ' +
            'incomplete. Call `propose_page` (or `propose_edits` if changing an existing page) now, with ' +
            'every block and its copy.' +
            (imageCtx.queued.length
              ? ' Reuse these exact placeholder srcs in the image fields they were meant for; do NOT ' +
                `request them again, they are already generating: ${imageCtx.queued.map((q) => q.placeholderSrc).join(' , ')}`
              : ''),
        });
        continue;
      }
      // A turn that ends with prose and no proposal produced nothing the user can apply — and the model
      // will happily narrate the page it intended ("Hero section uses a strong image…") as though it
      // exists. Same principle as the imagery note: state the truth alongside the claim rather than try
      // to police the wording.
      // A page was built and a retry lost it. Return it rather than the prose that replaced it.
      if (lastBuiltProposal) {
        const salvaged = describeMissingImagery(findPlaceholderImages(lastBuiltProposal.blocks));
        const salvagedReply = [content ?? '', salvaged].filter(Boolean).join('\n\n');
        console.warn('[playground-chat] retry ended without a proposal; returning the page already built');
        emit({ type: 'reply', content: salvagedReply });
        emit({ type: 'proposal', ...lastBuiltProposal });
        return finish({ reply: salvagedReply, proposal: lastBuiltProposal, toolsUsed });
      }

      const nothingProposed = !toolsUsed.some(isPlacementTool) && toolsUsed.includes('list_blocks');
      const reply = [
        content ?? '',
        nothingProposed
          ? '⚠️ Nothing was actually proposed — there are no blocks to apply. Ask me to try again.'
          : null,
      ]
        .filter(Boolean)
        .join('\n\n');
      emit({ type: 'reply', content: reply });
      return finish({ reply, toolsUsed });
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

      // Terminal: targeted changes to the page that exists.
      if (call.name === 'propose_edits') {
        const current: PageBlock[] = (args.currentBlocks ?? []).map((b) => ({
          componentId: b.componentId,
          args: (b.args ?? {}) as Record<string, unknown>,
        }));
        // Validated, not cast. A `null` in this array threw `Cannot read properties of null` on the
        // first `e.op` and killed the turn outright — no changeset, no reply.
        const { entries: raw, discarded } = parseEditEntries(parsed.edits);

        // Build real args for anything carrying content, so an edit gets the same shape guarantees a
        // fresh proposal does — correct prop shapes, no invented images, no sample content.
        const ops: EditOp[] = [];
        /** Edits dropped before verification — a bad field name, an unknown component. */
        const preRejected: { reason: string }[] = [];
        if (discarded) {
          preRejected.push({
            reason: `${discarded} edit${discarded === 1 ? '' : 's'} could not be read and were skipped.`,
          });
        }
        for (const e of raw) {
          const op = String(e.op ?? '');
          const index = Number(e.index);
          const expect = String(e.expect ?? '');
          if (op === 'remove') {
            ops.push({ op: 'remove', index, expect });
            continue;
          }
          const componentId = op === 'update' ? expect : String(e.componentId ?? '');
          const built = await buildBlocks([{ componentId, values: e.values }], seenAssetSrcs);
          const block = built.blocks[0];
          if (!block) {
            preRejected.push({ reason: built.problems[0] ?? `Could not build ${componentId || 'that block'}.` });
            continue;
          }
          // Shown to the user, not only fed back to the model. A silently-swapped image is the exact
          // shape of "it listed components as edited and there were no images": the op is valid, it
          // applies, the card says Applied, and nothing anywhere says the picture was refused.
          for (const message of describeReplacedImages(built.replacedImages)) {
            preRejected.push({ reason: message });
          }

          if (op === 'update') {
            // Only the fields the model actually named — merging the whole rebuilt block would drag
            // blanked placeholders over content the user already has. Taken from `buildBlocks` rather
            // than re-derived from `e.values`: re-deriving used the model's original spelling, so a name
            // corrected during the merge (`buttonSlot` → `buttonSlots`) was filtered straight back out
            // and the update was rejected as naming no fields.
            const named = built.namedKeys[0] ?? [];
            const values = Object.fromEntries(named.filter((k) => k in block.args).map((k) => [k, block.args[k]]));
            // An update with nothing left in it is not an update. Every named field was unknown to the
            // component — a mistyped or guessed field name — and emitting it anyway produced a
            // changeset that said "Update block 2 — no fields" and then "Applied", having changed
            // nothing at all. Rejecting it says so, and gives the model the real field names to retry
            // with instead of leaving it to guess a second time.
            if (!Object.keys(values).length) {
              const detail = built.rejectedFields[0];
              // Every named field being unknown usually means the wrong *component*, not the wrong field
              // names: the model wrote another block's fields onto this one. Measured at 2 of 5 runs on
              // "change this section to a stats block", where it reached for `update` and the block kept
              // its old type — "I wanted to change a component type and it didn't swap it out". Naming
              // the alternative costs nothing and a rejection that only complains gets guessed at again.
              const swapHint =
                ' If you meant to change this block to a different component, use `op: "replace"` with ' +
                'the new `componentId` — `update` only changes fields on the block that is already there.';
              preRejected.push({
                reason:
                  (detail
                    ? `${componentId}: no such field${detail.unknown.length === 1 ? '' : 's'} ${detail.unknown.join(', ')}. Its fields are: ${detail.available.join(', ')}`
                    : `${componentId}: that edit named no fields the block has.`) + swapHint,
              });
              continue;
            }
            ops.push({ op: 'update', index, expect, values });
          } else if (op === 'replace') {
            ops.push({ op: 'replace', index, expect, componentId, values: block.args });
          } else if (op === 'insert') {
            ops.push({ op: 'insert', index, componentId, values: block.args });
          }
        }

        // Verified here so the model can be told it mis-indexed; the client verifies again at apply
        // time, where the canvas is the actual truth.
        // Same placement check for a targeted edit — an op that does not carry the generated src leaves
        // the image with nowhere to land.
        const editBlocks = ops.map((o) => ({
          componentId: 'expect' in o && o.expect ? o.expect : 'componentId' in o ? o.componentId : 'block',
          args: ('values' in o ? o.values : {}) as Record<string, unknown>,
        }));
        const unplacedEdits = findUnplacedImages(editBlocks, imageCtx.queued);
        if (unplacedEdits.length && !askedToPlaceImages) {
          askedToPlaceImages = true;
          noteRetry('unplaced-edits');
          console.warn('[playground-chat] generated images not placed in edits', unplacedEdits.map((u) => u.placeholderSrc));
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ incomplete: true, reason: unplacedImageInstruction(unplacedEdits) }),
          });
          continue;
        }

        const { valid, rejected } = verifyOps(ops, current);
        const allRejected = [...preRejected, ...rejected.map((r) => ({ reason: r.reason }))];
        if (allRejected.length) console.warn('[playground-chat] rejected edits', allRejected.map((r) => r.reason).join('; '));

        if (!valid.length) {
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              rejected: true,
              reason:
                'None of those edits could be applied. Fix them using the field names below and call ' +
                'propose_edits again.',
              problems: allRejected.map((r) => r.reason),
            }),
          });
          continue;
        }

        const summary = String(parsed.summary ?? '');
        // The same deterministic note the proposal path gets. It existed only there, so an *edit* turn
        // could claim imagery it had not added with nothing to contradict it — which is precisely how
        // "it listed these as edited" read to somebody looking at a page with no images on it.
        const editImagery = describeMissingImagery(findPlaceholderImages(editBlocks));
        const reply = [content ?? summary, editImagery].filter(Boolean).join('\n\n');
        emit({ type: 'reply', content: reply });
        emit({ type: 'changeset', ops: valid, summary, rejected: allRejected });
        return finish({ reply, changeset: { ops: valid, summary, rejected: allRejected }, toolsUsed });
      }

      // Terminal. No scaffolding check any more: the server scaffolds every block itself while
      // building the args, so there is no step the model can skip. The enforcement existed only to
      // catch that, and removing the possibility is better than policing it.
      if (call.name === 'propose_page') {
        /**
         * A change to an existing page must not come back as a whole new page.
         *
         * The tool description has said "USE THIS, not propose_page, whenever the canvas has blocks and
         * the request is a change" since the edits path existed. Measured: asking to change every link
         * and CTA label on a six-block page re-proposed the whole page in **3 of 3 runs**. A prompt
         * instruction is not a constraint, and this is the one failure where being wrong is worse than
         * being unhelpful — accepting the proposal discards every earlier decision, and the user cannot
         * tell until they look. Monica: "this eliminates all of your changes upstream and starts you from
         * scratch again."
         *
         * So the model has to *say* it means to replace the page, and gets told once that it probably
         * does not. The escape hatch is real — "start over" is a legitimate request — but it now costs a
         * deliberate second call rather than being the path of least resistance.
         */
        const replacesPage = parsed.replacesExistingPage === true;
        if (imageCtx.hasCanvas && !replacesPage && !refusedWholePageRebuild) {
          refusedWholePageRebuild = true;
          noteRetry('whole-page-rebuild');
          console.warn('[playground-chat] refused a whole-page rebuild over a canvas', {
            canvasBlocks: imageCtx.blocks.length,
          });
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              rejected: true,
              reason:
                `The canvas already has ${imageCtx.blocks.length} blocks with the user's own copy, ` +
                'imagery and links in them. Proposing a new page throws all of that away, including ' +
                'decisions made in earlier turns. Use `propose_edits` with one `update` op per block ' +
                'you actually need to change — that is what "change every CTA label" or "add a section" ' +
                'means. Only if the user explicitly asked to start the page over, call propose_page ' +
                'again with `replacesExistingPage: true`.',
              canvas: imageCtx.blocks.map((b, i) => ({ block: i + 1, componentId: b.componentId })),
            }),
          });
          continue;
        }

        const raw = Array.isArray(parsed.blocks) ? (parsed.blocks as { componentId?: unknown; values?: unknown }[]) : [];
        const { blocks, problems, gaps, optionalGaps, invalidValues, replacedImages } = await buildBlocks(raw, seenAssetSrcs);
        const notices = describeReplacedImages(replacedImages);
        if (blocks.length) lastBuiltProposal = { blocks, rationale: String(parsed.rationale ?? ''), notices };

        // Ask once for the content it skipped. Templates are seeded from real previews, so an
        // unfilled field is not empty — it is somebody's sample copy, and shipping that produces a
        // page that looks finished and is not. Once only: a second ask rarely helps and the honest
        // fallback is a visibly incomplete page rather than a plausible fake one.
        // Images this turn generated that never made it into a block. The other placement guard only
        // fires when a turn ends without a placement tool, so a `propose_page` that omits the returned
        // srcs walks straight past it — which is how three generated images ended up waiting forever
        // for a placeholder that was never on the canvas.
        const unplaced = findUnplacedImages(blocks, imageCtx.queued);
        if (unplaced.length && !askedToPlaceImages) {
          askedToPlaceImages = true;
          noteRetry('unplaced-images');
          console.warn('[playground-chat] generated images not placed', unplaced.map((u) => u.placeholderSrc));
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ incomplete: true, reason: unplacedImageInstruction(unplaced) }),
          });
          continue;
        }

        // Imagery first, and phrased for imagery. The generic gap retry says "write real values", which
        // is not a thing you can do for an image — so a page asking for "good images of students" came
        // back with none, and the model reported "real student imagery" anyway.
        const placeholders = findPlaceholderImages(blocks);
        // Only chase imagery on a page that already exists. Composing a fresh one, placeholders are the
        // *intended* outcome — and this retry told the model to call `request_image`, which is gated off
        // in that case. It read the contradiction, burned rounds on it, and ended the turn with prose
        // and no proposal at all.
        if (imageCtx.hasCanvas && placeholders.length && !askedForImages) {
          askedForImages = true;
          noteRetry('imagery');
          console.log('[playground-chat] asking for imagery', JSON.stringify(placeholders));
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ incomplete: true, reason: imageGapInstruction(placeholders) }),
          });
          continue;
        }

        // Values the merge threw away — almost always an invented image src. Reported before the gap
        // check because it is the more actionable failure: a model told only "these fields are empty"
        // re-proposed the same three fabricated srcs and had them rejected again.
        if (invalidValues.length && !askedForGaps) {
          askedForGaps = true;
          noteRetry('rejected-values');
          console.log('[playground-chat] reporting rejected values', JSON.stringify(invalidValues));
          convo.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({
              incomplete: true,
              reason:
                'Some values were rejected and replaced with placeholders. An image src must come from a ' +
                '`search_assets` result — you cannot invent a path, and a made-up one renders as a broken ' +
                'image. Either use a src a search actually returned, or leave the placeholder and say so ' +
                'in your reply. Then call propose_page again.',
              rejected: invalidValues,
              ...(gaps.length ? { alsoEmpty: gaps } : {}),
            }),
          });
          continue;
        }

        if (gaps.length && !askedForGaps) {
          askedForGaps = true;
          noteRetry('content-gaps');
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
        // Appended, not substituted. The model's prose may be accurate, vague, or an outright claim of
        // imagery it never added — this makes the real state visible without trying to police wording.
        const missingImagery = describeMissingImagery(findPlaceholderImages(blocks));
        // Optional fields left blank. Deterministic, and deliberately not a retry: this is worth knowing
        // and not worth a round of invented copy.
        const optionalNote = describeOptionalGaps(optionalGaps);
        const reply = [content ?? rationale ?? 'Here is the page.', missingImagery, optionalNote]
          .filter(Boolean)
          .join('\n\n');
        emit({ type: 'reply', content: reply });
        emit({ type: 'proposal', blocks, rationale, notices });
        return finish({ reply, proposal: { blocks, rationale, notices }, toolsUsed });
      }

      let result: unknown;
      try {
        result = await runTool(call.name, parsed, attached, seenAssetSrcs, imageCtx);
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
  exhaustedTurn = true;
  emit({ type: 'reply', content: exhausted });
  console.warn('[playground-chat] round cap hit', { rounds: MAX_TOOL_ROUNDS, tools: toolsUsed });
  return finish({ reply: exhausted, toolsUsed });
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
