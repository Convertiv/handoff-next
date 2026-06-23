import { spawn, type ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

// Resolve sibling CJS files relative to this module's location at runtime.
// Using import.meta.url (not repoRoot) ensures Turbopack traces these files into
// the Lambda bundle and the paths are correct at both build time and runtime.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Spawns a `.ts` worker in a separate Node process (preload + tsx).
 *
 * Key design decisions:
 *
 * 1. Uses `/bin/sh -c 'node "$@"'` rather than spawning node directly.
 *    On Vercel Node 22+, `process.execPath` is `/var/lang/bin/node` (ENOENT).
 *    The shell resolves `node` from PATH correctly. `/bin/sh` as an absolute path
 *    also avoids Turbopack treating the first spawn() arg as a module to bundle.
 *
 * 2. No `cwd` option — omitting it defaults to `process.cwd()` which is always
 *    valid at Lambda runtime. Setting `cwd: repoRoot` caused every spawn to fail
 *    with ENOENT (reported on the binary) because `/vercel/path0` doesn't exist
 *    at Lambda runtime — only at build time.
 *
 * 3. Launcher and preload paths are resolved from `__dirname` (this module's
 *    directory) so Turbopack traces them into the deployment bundle.
 */
export function spawnTsxWorker(params: {
  workerScript: string;
  workerArgs: string[];
  /** Merged on top of `process.env` for the child process */
  env: Record<string, string>;
}): ChildProcess {
  const { workerScript, workerArgs, env } = params;
  const preload = path.join(__dirname, 'component-build-preload.cjs');
  const launcher = path.join(__dirname, 'node-tsx-worker-launcher.cjs');
  return spawn('/bin/sh', ['-c', 'node "$@"', '--', launcher], {
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
