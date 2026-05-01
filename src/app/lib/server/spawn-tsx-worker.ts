import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

/**
 * Spawns a `.ts` worker in a separate Node process (preload + tsx), without putting
 * `['--require', ...]` in the parent `spawn` argv — Turbopack mis-parses that as a module graph.
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
  return spawn(process.execPath, [launcher], {
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
