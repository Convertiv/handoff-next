import { spawnTsxWorker } from './spawn-tsx-worker';
import { eq } from 'drizzle-orm';
import fs from 'fs-extra';
import path from 'path';
import { getDb } from '../db';
import { componentBuildJobs } from '../db/schema';
import { resolveHandoffRepoRoot } from './handoff-config-load';

export { resolveHandoffRepoRoot };

export async function insertBuildJob(componentId: string): Promise<number> {
  const db = getDb();
  const [row] = await db.insert(componentBuildJobs).values({ componentId, status: 'queued' }).returning({ id: componentBuildJobs.id });
  return row.id;
}

export async function getBuildJob(jobId: number) {
  const db = getDb();
  const [row] = await db.select().from(componentBuildJobs).where(eq(componentBuildJobs.id, jobId));
  return row ?? null;
}

const WORKER_ENV_ALLOWLIST = [
  'DATABASE_URL',
  'HANDOFF_WORKING_PATH',
  'NODE_ENV',
  'PATH',
  'HOME',
  'USER',
  'HANDOFF_APP_BASE_PATH',
  'HANDOFF_COMPONENT_BUILD_REPO_ROOT',
  /** Single `handoff.component()` call can exceed 30s on cold Vite + Sass. */
  'HANDOFF_COMPONENT_WORKER_TIMEOUT_MS',
  'TZ',
  'LANG',
  'LC_ALL',
  // Windows: Node / native tooling often need these
  'SYSTEMROOT',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
] as const;

/**
 * Next.js compile-time env (next.config.mjs `env`) uses DefinePlugin to inline
 * `process.env.VAR_NAME` as string literals, but this only works for static
 * property access — `process.env[dynamicKey]` bypasses it. We read these values
 * with static access so webpack can inline them, then merge into the allowlist.
 */
const NEXT_INLINED_ENV: Record<string, string | undefined> = {
  HANDOFF_WORKING_PATH: process.env.HANDOFF_WORKING_PATH,
  HANDOFF_APP_BASE_PATH: process.env.HANDOFF_APP_BASE_PATH,
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

/**
 * Runs the build worker in a separate Node process so a bad template cannot take down the Next server.
 * Uses `node --require` to load a polyfill (for esbuild's __name helper) before tsx registers,
 * avoiding conflicts between tsx's module transforms and Vite/sass internals.
 */
export function spawnComponentBuildWorker(jobId: number): void {
  const repoRoot = resolveHandoffRepoRoot();
  const worker = path.join(repoRoot, 'src/app/lib/server/component-build-worker.ts');
  const child = spawnTsxWorker({
    repoRoot,
    workerScript: worker,
    workerArgs: [String(jobId)],
    env: buildWorkerEnv(),
  });
  child.stderr?.on('data', (chunk) => {
    console.error(`[component-build ${jobId}]`, chunk.toString());
  });
  child.stdout?.on('data', (chunk) => {
    console.log(`[component-build ${jobId}]`, chunk.toString());
  });
  child.on('error', (err) => {
    console.error(`[component-build ${jobId}] spawn error`, err);
  });
}
