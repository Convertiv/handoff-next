/**
 * The user id the local runners act as.
 *
 * Shared by `run-turn.ts` and `run-evals.ts` because they had drifted: the eval runner resolved a user
 * and the single-turn runner passed `null`, so `request_image` returned "image generation is unavailable
 * in this session" and every imagery diagnosis through `npm run turn` was measuring a runner limitation
 * rather than the agent. That cost a wrong diagnosis of a real eval failure.
 *
 * Two callers disagreeing about one value is the most expensive recurring bug in this codebase —
 * capabilities not reaching the row, MCP running a duplicate scaffold, the editor and the scaffold
 * showing different shapes. One function, both callers.
 */

/**
 * `HANDOFF_TURN_USER_ID` wins; otherwise look up `HANDOFF_TURN_USER_EMAIL` or the git identity.
 *
 * Resolved rather than required, because forgetting it does not fail loudly — the tool reports
 * generation unavailable, the turn queues nothing, and imagery checks pass by having nothing to judge.
 * Returns null in CI, where imagery cases should be skipped rather than silently vacuous.
 */
export async function resolveUserId(): Promise<string | null> {
  const explicit = process.env.HANDOFF_TURN_USER_ID?.trim();
  if (explicit) return explicit;

  const email = process.env.HANDOFF_TURN_USER_EMAIL?.trim() || (await gitEmail());
  if (!email) return null;

  try {
    const [{ getDb }, { sql }] = await Promise.all([import('../../src/app/lib/db/index'), import('drizzle-orm')]);
    // Parameterised, not interpolated. The value comes from `git config`, which is not attacker-supplied
    // in any realistic sense — but a script that builds SQL by concatenation is a pattern that gets
    // copied somewhere it matters.
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
