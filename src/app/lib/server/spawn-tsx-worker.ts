import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

/**
 * Spawns a `.ts` worker in a separate Node process (preload + tsx), without putting
 * `['--require', ...]` in the parent `spawn` argv — Turbopack mis-parses that as a module graph.
 *
 * Uses `/bin/sh -c 'node "$@"'` rather than spawning node directly. Two reasons:
 *
 * 1. On Vercel Node 22+, `process.execPath` is `/var/lang/bin/node` which does not exist
 *    as a spawnable file (ENOENT). The shell resolves `node` from PATH which always works.
 *
 * 2. Turbopack's static analyser treats any string literal first arg to spawn() as a
 *    potential module to bundle, causing "Can't resolve <dynamic>" build errors for
 *    `spawn('node', ...)` or `spawn(computedVar, ...)`. An absolute path starting with
 *    `/` is unambiguously a binary, not a module name, so Turbopack ignores it.
 *
 * The shell wrapper is: `sh -c 'node "$@"' -- <launcher>`, which sets $1=launcher and
 * executes `node <launcher>` — equivalent to the original direct spawn but PATH-resolved.
 */
export function spawnTsxWorker(params: {
  repoRoot: string;
  workerScript: string;
  workerArgs: string[];
  /** Merged on top of `process.env` for the child process */
  env: Record<string, string>;
}): ChildProcess {
  const { repoRoot, workerScript, workerArgs, env } = params;
  const preload = path.join(repoRoot, 'src/app/lib/server/component-build-preload.cjs');
  const launcher = path.join(repoRoot, 'src/app/lib/server/node-tsx-worker-launcher.cjs');
  return spawn('/bin/sh', ['-c', 'node "$@"', '--', launcher], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...env,
      HANDOFF_WORKER_PRELOAD: preload,
      HANDOFF_WORKER_SCRIPT: workerScript,
      HANDOFF_WORKER_ARGS: JSON.stringify(workerArgs),
    },
  });
}
