import { spawnTsxWorker } from './spawn-tsx-worker';
import path from 'path';
import { resolveHandoffRepoRoot } from './component-builder';

const WORKER_ENV_ALLOWLIST = [
  'DATABASE_URL',
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

const NEXT_INLINED_ENV: Record<string, string | undefined> = {
  HANDOFF_WORKING_PATH: process.env.HANDOFF_WORKING_PATH,
  HANDOFF_EXPORT_PATH: process.env.HANDOFF_EXPORT_PATH,
};

function buildWorkerEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of WORKER_ENV_ALLOWLIST) {
    const v = process.env[key];
    if (v !== undefined) out[key] = v;
  }
  for (const [key, v] of Object.entries(NEXT_INLINED_ENV)) {
    if (v !== undefined && !out[key]) out[key] = v;
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
  const child = spawnTsxWorker({
    repoRoot,
    workerScript: worker,
    workerArgs: [String(jobId)],
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
