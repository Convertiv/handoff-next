/**
 * Launches a TS worker under Node with preload + tsx. Lives as plain CJS so the
 * Next.js Turbopack bundler does not parse `spawn(..., ['--require', ...])` as a module graph.
 *
 * Env: HANDOFF_WORKER_PRELOAD, HANDOFF_WORKER_SCRIPT, HANDOFF_WORKER_ARGS (JSON array of strings)
 */
'use strict';

const { spawn } = require('node:child_process');

const preload = process.env.HANDOFF_WORKER_PRELOAD;
const worker = process.env.HANDOFF_WORKER_SCRIPT;
let workerArgs = [];
try {
  workerArgs = JSON.parse(process.env.HANDOFF_WORKER_ARGS || '[]');
} catch {
  workerArgs = [];
}
if (!preload || !worker) {
  console.error('[node-tsx-worker-launcher] HANDOFF_WORKER_PRELOAD and HANDOFF_WORKER_SCRIPT are required');
  process.exit(1);
}

const child = spawn(process.execPath, ['--require', preload, '--import', 'tsx', worker, ...workerArgs], {
  stdio: 'inherit',
  cwd: process.cwd(),
  env: process.env,
});

child.on('exit', (code, signal) => {
  process.exit(code != null ? code : signal ? 1 : 0);
});
