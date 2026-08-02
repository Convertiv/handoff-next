/**
 * Run the eval cases against the real model and report pass rates.
 *
 * Stage 3 of `docs/AGENT-TESTING.md`. A loop over Stage 1's single turn with assertions attached —
 * which is all an eval runner is.
 *
 *   npm run eval:smoke              three cases, three runs each — before a prompt change
 *   npm run eval                    every case
 *   npm run eval -- --runs 5        more samples where a rate is contested
 *   npm run eval -- --case fill-the-images
 *   npm run eval -- --baseline .evals/before.json    compare against a saved run
 *
 * Costs real money per run, which is a feature: it keeps the suite small and the cases meaningful.
 *
 * Cases run one at a time on purpose. They share a registry and an image queue, and a parallel run
 * would have them generating into each other's asset library — the measurement would be of the runner,
 * not the agent.
 */

// Default import: `@next/env` is CJS and Node's ESM lexer does not surface its named exports.
import nextEnv from '@next/env';
import fs from 'fs-extra';
import path from 'path';

nextEnv.loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const { runPlaygroundChatTurn } = await import('../src/app/lib/server/playground-chat');
const { EVAL_CASES, SMOKE_CASES, judge, observeSignals, summarize } = await import('../src/app/lib/evals/cases');
type EvalCase = import('../src/app/lib/evals/cases').EvalCase;
type CaseResult = import('../src/app/lib/evals/cases').CaseResult;

const BOLD = '\x1b[1m';
const GREY = '\x1b[90m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const OFF = '\x1b[0m';

interface Options {
  runs: number;
  cases: EvalCase[];
  baseline: string | null;
  save: string | null;
}

function parseArgs(argv: string[]): Options {
  const out: Options = { runs: 3, cases: SMOKE_CASES, baseline: null, save: null };
  let all = false;
  const only: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a === '--runs') out.runs = Number(argv[++i]) || 3;
    else if (a === '--all') all = true;
    else if (a === '--case') only.push(argv[++i] ?? '');
    else if (a === '--baseline') out.baseline = argv[++i] ?? null;
    else if (a === '--save') out.save = argv[++i] ?? null;
  }

  if (only.length) out.cases = EVAL_CASES.filter((c) => only.includes(c.id));
  else if (all) out.cases = EVAL_CASES;

  return out;
}

/** A rate, coloured by how much it should worry you. Anything below 4-of-5 is not working. */
function rate(passed: number, runs: number): string {
  const fraction = passed / runs;
  const colour = fraction >= 0.8 ? GREEN : fraction >= 0.4 ? YELLOW : RED;
  return `${colour}${passed}/${runs}${OFF}`;
}

/**
 * The user id `request_image` is gated on.
 *
 * Resolved rather than required, because forgetting it does not fail loudly — the tool returns "image
 * generation is unavailable", the turn queues nothing, and the imagery cases pass by having nothing to
 * judge. `HANDOFF_TURN_USER_ID` wins; otherwise the git identity is looked up, which is right on a
 * developer's machine and absent in CI, where those cases should be skipped anyway.
 */
async function resolveUserId(): Promise<string | null> {
  const explicit = process.env.HANDOFF_TURN_USER_ID?.trim();
  if (explicit) return explicit;

  const email = process.env.HANDOFF_TURN_USER_EMAIL?.trim() || (await gitEmail());
  if (!email) return null;
  try {
    const [{ getDb }, { sql }] = await Promise.all([import('../src/app/lib/db/index'), import('drizzle-orm')]);
    // Parameterised, not interpolated. The value comes from `git config`, which is not attacker-supplied
    // in any realistic sense — but a script that builds SQL by concatenation is a pattern that gets
    // copied to somewhere it matters.
    const rows = (await (getDb() as unknown as {
      execute: (q: unknown) => Promise<{ rows?: { id: string }[] } | { id: string }[]>;
    }).execute(sql`select id from "user" where lower(email) = lower(${email}) limit 1`)) as
      | { rows?: { id: string }[] }
      | { id: string }[];
    const list = Array.isArray(rows) ? rows : (rows.rows ?? []);
    return list[0]?.id ?? null;
  } catch {
    return null;
  }
}

async function gitEmail(): Promise<string | null> {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) =>
    execFile('git', ['config', 'user.email'], (err, out) => resolve(err ? null : out.trim() || null))
  );
}

async function runCase(kase: EvalCase, runs: number, userId: string | null): Promise<CaseResult> {
  if (kase.requiresUser && !userId) {
    // Skipped, never passed. A case that cannot exercise its behaviour must not contribute a green.
    console.log(`${BOLD}${kase.id}${OFF} ${YELLOW}skipped${OFF} ${GREY}needs a user id — set HANDOFF_TURN_USER_ID${OFF}`);
    return { caseId: kase.id, runs: 0, passed: 0, failures: {}, signals: {}, skipped: true };
  }

  process.stdout.write(`${BOLD}${kase.id}${OFF} ${GREY}${kase.prompt.slice(0, 58)}…${OFF}\n`);
  const observations: { failures: string[]; seconds: number }[] = [];

  for (let i = 0; i < runs; i += 1) {
    const startedAt = Date.now();
    process.stdout.write(`  run ${i + 1}/${runs} `);
    try {
      const turn = await runPlaygroundChatTurn({
        messages: [{ role: 'user', content: kase.prompt }],
        currentBlocks: kase.canvas,
        actorUserId: userId,
      });
      const seconds = (Date.now() - startedAt) / 1000;

      // `facts` comes back from the turn itself, so these assertions read the same numbers the
      // production log prints. Two definitions of "did it work" is a bug we have already had.
      if (!turn.facts) throw new Error('turn returned no facts — the runner cannot judge it');

      const observation = {
        facts: turn.facts,
        blocks: turn.proposal?.blocks ?? [],
        ops: (turn.changeset?.ops ?? []) as { op: string; blockId?: string; values?: Record<string, unknown> }[],
        rejected: turn.changeset?.rejected ?? [],
        // The placeholder each generation is filling, not a final URL — the real src arrives later by
        // polling. An image whose placeholder is nowhere in the result is one nothing will ever collect.
        // Ones that failed to enqueue are excluded: they are a queue failure, not a placement failure.
        queuedImageSrcs: (turn.queuedImages ?? []).filter((q) => !q.error).map((q) => q.placeholderSrc).filter(Boolean),
        reply: turn.reply,
      };
      const failures = judge(kase, observation);

      observations.push({ failures, signals: observeSignals(observation), seconds });
      process.stdout.write(
        failures.length ? `${RED}✖${OFF} ${GREY}${failures.join('; ').slice(0, 90)}${OFF}\n` : `${GREEN}✔${OFF}\n`
      );
    } catch (error) {
      // A thrown turn is a failed run, not a failed suite. One case erroring must not hide the rates
      // of the others — that is the whole reason for sampling.
      const message = error instanceof Error ? error.message : String(error);
      observations.push({ failures: [`threw: ${message.slice(0, 120)}`], seconds: (Date.now() - startedAt) / 1000 });
      process.stdout.write(`${RED}✖ threw${OFF} ${GREY}${message.slice(0, 90)}${OFF}\n`);
    }
  }

  return summarize(kase.id, observations);
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  if (!process.env.HANDOFF_AI_API_KEY?.trim()) {
    console.error('HANDOFF_AI_API_KEY is not set — this runs against the real model.');
    process.exit(2);
  }
  if (!options.cases.length) {
    console.error('No cases matched.');
    process.exit(2);
  }

  const totalRuns = options.cases.length * options.runs;
  console.log(
    `${BOLD}${options.cases.length} case(s) × ${options.runs} run(s) = ${totalRuns} model turns${OFF}` +
      ` ${GREY}(real money, roughly ${Math.ceil((totalRuns * 25) / 60)} min)${OFF}\n`
  );

  const results: CaseResult[] = [];
  const userId = await resolveUserId();
  console.log(
    userId
      ? `${GREY}acting as user ${userId}${OFF}\n`
      : `${YELLOW}no user id — image cases will be skipped (set HANDOFF_TURN_USER_ID)${OFF}\n`
  );

  for (const kase of options.cases) results.push(await runCase(kase, options.runs, userId));

  const baseline: Record<string, CaseResult> = options.baseline
    ? Object.fromEntries(
        ((await fs.readJson(path.resolve(options.baseline)).catch(() => [])) as CaseResult[]).map((r) => [r.caseId, r])
      )
    : {};

  console.log(`\n${BOLD}rates${OFF}`);
  for (const r of results) {
    const before = baseline[r.caseId];
    // A prompt change that lifts one case and drops another is the normal shape. Without the delta
    // beside the rate you see the lift and miss the drop.
    const delta = before
      ? (() => {
          const d = r.passed / r.runs - before.passed / before.runs;
          if (Math.abs(d) < 0.01) return ` ${GREY}(unchanged)${OFF}`;
          return d > 0 ? ` ${GREEN}(+${Math.round(d * 100)}%)${OFF}` : ` ${RED}(${Math.round(d * 100)}%)${OFF}`;
        })()
      : '';
    if (r.skipped) {
      console.log(`  ${YELLOW}skip${OFF}  ${r.caseId.padEnd(26)} ${GREY}not run — needs a user id${OFF}`);
      continue;
    }
    console.log(`  ${rate(r.passed, r.runs)}  ${r.caseId.padEnd(26)} ${GREY}${r.medianSeconds.toFixed(0)}s${OFF}${delta}`);
    for (const [failure, count] of Object.entries(r.failures).sort((a, b) => b[1] - a[1])) {
      console.log(`        ${GREY}${count}×${OFF} ${failure}`);
    }
    // Signals are watched, not judged — a rate that moves here is a quality change no red run shows.
    for (const [signal, count] of Object.entries(r.signals).sort((a, b) => b[1] - a[1])) {
      console.log(`        ${GREY}${count}/${r.runs} ${signal}${OFF}`);
    }
  }

  const ran = results.filter((r) => !r.skipped);
  const passed = ran.reduce((n, r) => n + r.passed, 0);
  const attempted = ran.reduce((n, r) => n + r.runs, 0);
  const skipped = results.length - ran.length;
  console.log(
    `\n${BOLD}overall${OFF} ${rate(passed, attempted)}` +
      (skipped ? `  ${YELLOW}${skipped} case(s) skipped${OFF}` : '') +
      '\n'
  );

  if (options.save) {
    await fs.outputJson(path.resolve(options.save), results, { spaces: 2 });
    console.log(`${GREY}saved to ${options.save} — pass it as --baseline next time${OFF}\n`);
  }

  // Never non-zero on a rate. A stochastic measurement does not belong in a CI gate: the first red run
  // would be treated as a break, and the response would be to loosen the assertion until it went green.
  // Read the numbers.
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
