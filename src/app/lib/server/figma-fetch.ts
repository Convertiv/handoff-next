import { spawn } from 'child_process';
import path from 'path';
import { resolveHandoffRepoRoot } from './component-builder';

const WORKER_ENV_ALLOWLIST = [
  'DATABASE_URL',
  'HANDOFF_MODE',
  'NODE_ENV',
  'PATH',
  'HOME',
  'USER',
  'HANDOFF_APP_BASE_PATH',
  'HANDOFF_COMPONENT_BUILD_REPO_ROOT',
  'HANDOFF_FIGMA_PROJECT_ID',
  'HANDOFF_DEV_ACCESS_TOKEN',
  'HANDOFF_OUTPUT_DIR',
  'TZ',
  'LANG',
  'LC_ALL',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'AUTH_FIGMA_ID',
  'AUTH_FIGMA_SECRET',
] as const;

function buildWorkerEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of WORKER_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) out[key] = v;
  }
  if (!out.NODE_ENV) {
    out.NODE_ENV = process.env.NODE_ENV ?? 'development';
  }
  return out;
}

/** Spawn background Figma fetch worker for one DB job id. */
export function spawnFigmaFetchWorker(jobId: number): void {
  const repoRoot = resolveHandoffRepoRoot();
  const worker = path.join(repoRoot, 'src/app/lib/server/figma-fetch-worker.ts');
  const preload = path.join(repoRoot, 'src/app/lib/server/component-build-preload.cjs');
  const child = spawn('node', ['--require', preload, '--import', 'tsx', worker, String(jobId)], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildWorkerEnv(),
  });
  child.stderr?.on('data', (chunk) => {
    console.error(`[figma-fetch ${jobId}]`, chunk.toString());
  });
  child.stdout?.on('data', (chunk) => {
    console.log(`[figma-fetch ${jobId}]`, chunk.toString());
  });
  child.on('error', (err) => {
    console.error(`[figma-fetch ${jobId}] spawn error`, err);
  });
}
