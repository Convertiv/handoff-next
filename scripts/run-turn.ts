/**
 * Run one playground chat turn locally, against the real model, and print what it actually did.
 *
 * This exists because a turn could previously only be exercised by deploying. Every iteration cost a
 * push, a Vercel build, a manual run in the browser, and then a paragraph of assistant prose to infer
 * the cause from — which is how one behaviour took four attempts and three regressions in an evening.
 * Prose is precisely what goes wrong, so inferring from it is inferring from the symptom.
 *
 *   npm run turn -- "sell our phone systems to university clients"
 *   npm run turn -- "fill the images" --canvas fixtures/university-page.json
 *   npm run turn -- "make the hero headline shorter" --canvas fixtures/university-page.json --json
 *
 * Needs `DATABASE_URL` and `HANDOFF_AI_API_KEY` in the environment — it talks to the real registry and
 * the real model, and costs real money per run. See `docs/AGENT-TESTING.md`; this is Stage 1, and the
 * eval runner is a loop over it with assertions attached.
 */

// Default import: `@next/env` is CJS, and Node's ESM lexer does not surface its named exports — the
// same trap that blocked lodash in the data layer.
import nextEnv from '@next/env';
import fs from 'fs-extra';
import path from 'path';

// Load `.env` the way Next does — same files, same precedence — before anything reads `process.env`.
// A plain tsx script gets none of that for free, which is why the key "being set" and the script seeing
// it are two different things. Must run before the imports below touch config at module scope.
nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const { runPlaygroundChatTurn } = await import('../src/app/lib/server/playground-chat');
const { resolveUserId } = await import('./lib/resolve-user.mjs');
type PlaygroundChatEvent = Parameters<NonNullable<Parameters<typeof runPlaygroundChatTurn>[0]['onEvent']>>[0];

interface Args {
  prompt: string;
  canvas: { componentId: string; args?: Record<string, unknown> }[];
  json: boolean;
  userId: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { prompt: '', canvas: [], json: false, userId: null };
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--json') out.json = true;
    else if (a === '--canvas') {
      const file = argv[++i];
      if (!file) throw new Error('--canvas needs a path');
      const raw = fs.readJsonSync(path.resolve(file));
      // Accept either a bare array of blocks or a saved pattern shape.
      out.canvas = Array.isArray(raw) ? raw : (raw.components ?? raw.blocks ?? []);
    } else if (a === '--user') out.userId = argv[++i] ?? null;
    else rest.push(a);
  }

  out.prompt = rest.join(' ').trim();
  return out;
}

const GREY = '\x1b[90m';
const BOLD = '\x1b[1m';
const OFF = '\x1b[0m';

(async () => {
  const args = parseArgs(process.argv.slice(2));
  // Resolved the same way the eval runner resolves it. This script passed `null` until a real eval
  // failure was misdiagnosed through it: `request_image` is gated on a user, so every imagery run here
  // reported "generation unavailable" and was measuring the runner rather than the agent.
  if (!args.userId) args.userId = await resolveUserId();
  if (!args.prompt) {
    console.error('Usage: npm run turn -- "your prompt" [--canvas file.json] [--user <id>] [--json]');
    process.exit(2);
  }
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    console.error('HANDOFF_AI_API_KEY is not set — this runs against the real model.');
    process.exit(2);
  }

  if (!args.json) {
    console.log(`${BOLD}prompt${OFF}  ${args.prompt}`);
    console.log(`${BOLD}canvas${OFF}  ${args.canvas.length ? `${args.canvas.length} block(s)` : 'empty (composing a new page)'}\n`);
  }

  // The narration the user would see, as it happens — a turn that stalls is obvious here and invisible
  // in the final reply.
  const events: PlaygroundChatEvent[] = [];
  const onEvent = (event: PlaygroundChatEvent) => {
    events.push(event);
    if (args.json) return;
    if (event.type === 'status') console.log(`${GREY}  · ${event.text}${OFF}`);
    else if (event.type === 'images') console.log(`${GREY}  · queued ${event.queued.length} image(s)${OFF}`);
    else if (event.type === 'error') console.log(`  ✖ ${event.message}`);
  };

  const startedAt = Date.now();
  const turn = await runPlaygroundChatTurn({
    messages: [{ role: 'user', content: args.prompt }],
    currentBlocks: args.canvas,
    actorUserId: args.userId,
    onEvent,
  });
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  const outcome = turn.proposal ? 'proposal' : turn.changeset ? 'changeset' : 'reply-only';
  const result = {
    outcome,
    elapsedSeconds: Number(elapsed),
    toolsUsed: turn.toolsUsed,
    blocks: turn.proposal?.blocks.length ?? 0,
    ops: turn.changeset?.ops.length ?? 0,
    rejected: turn.changeset?.rejected ?? [],
    // What the user is actually told about refused values. Absent from this script until a fix for
    // exactly that gap could not be observed through it — a runner that cannot see the user-facing
    // half of a turn is only half a runner.
    notices: turn.proposal?.notices ?? [],
    queuedImages: turn.queuedImages?.length ?? 0,
    reply: turn.reply,
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`\n${BOLD}outcome${OFF} ${outcome}  ${GREY}(${elapsed}s)${OFF}`);
    console.log(`${BOLD}tools${OFF}   ${turn.toolsUsed.join(' → ') || '(none)'}`);
    if (turn.proposal) console.log(`${BOLD}blocks${OFF}  ${turn.proposal.blocks.map((b) => b.componentId).join(', ')}`);
    if (turn.changeset) {
      console.log(`${BOLD}ops${OFF}     ${turn.changeset.ops.length}`);
      for (const r of turn.changeset.rejected) console.log(`  ${GREY}rejected: ${r.reason}${OFF}`);
    }
    if (result.queuedImages) console.log(`${BOLD}images${OFF}  ${result.queuedImages} queued`);
    for (const notice of result.notices) console.log(`  ${GREY}notice: ${notice}${OFF}`);
    console.log(`\n${BOLD}reply${OFF}\n${turn.reply}\n`);
    // The server logs a one-line turn record with its computed flags; point at it rather than
    // recomputing here, so the script and the production log can never disagree.
    console.log(`${GREY}(the [playground-chat] line above carries the flags — see docs/AGENT-TESTING.md)${OFF}`);
  }

  // Non-zero when the turn produced nothing to apply, so this is usable as an assertion straight away.
  process.exit(outcome === 'reply-only' && turn.toolsUsed.includes('list_blocks') ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
