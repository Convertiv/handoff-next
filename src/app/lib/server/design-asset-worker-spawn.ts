import { spawnTsxWorker } from './spawn-tsx-worker';
import path from 'path';
import { resolveHandoffRepoRoot } from './component-builder';

const WORKER_ENV_KEYS = [
  'DATABASE_URL',
  'NODE_ENV',
  'PATH',
  'HOME',
  'USER',
  'HANDOFF_APP_BASE_PATH',
  'HANDOFF_AI_API_KEY',
  'TZ',
  'LANG',
  'LC_ALL',
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
] as const;

const NEXT_INLINED_ENV: Record<string, string | undefined> = {
  HANDOFF_WORKING_PATH: process.env.HANDOFF_WORKING_PATH,
};

function buildDesignAssetWorkerEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of WORKER_ENV_KEYS) {
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

/**
 * Runs design asset extraction in a separate Node process so slow OpenAI calls do not block the Next request.
 */
export function spawnDesignAssetWorker(artifactId: string): void {
  const repoRoot = resolveHandoffRepoRoot();
  const worker = path.join(repoRoot, 'src/app/lib/server/design-asset-worker.ts');
  const child = spawnTsxWorker({
    repoRoot,
    workerScript: worker,
    workerArgs: [artifactId],
    env: buildDesignAssetWorkerEnv(),
  });
  child.stderr?.on('data', (chunk) => {
    console.error(`[design-asset ${artifactId}]`, chunk.toString());
  });
  child.stdout?.on('data', (chunk) => {
    console.log(`[design-asset ${artifactId}]`, chunk.toString());
  });
  child.on('error', (err) => {
    console.error(`[design-asset ${artifactId}] spawn error`, err);
  });
}
